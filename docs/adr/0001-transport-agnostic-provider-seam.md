---
title: Transport-agnostic provider seam
date: 2026-06-01
status: proposed
scope: src/core/providers, src/core/runtime, src/providers/*, src/features (boundary)
supersedes: none
method: 3 parallel codebase review passes (core seam, coupling-leak audit, adaptor comparison) + external pattern research (ACP, LSP/MCP capability negotiation, Vercel AI SDK, Cline, continue.dev)
---

# ADR 0001 — Transport-agnostic provider seam

## Status

Proposed. Captures the agreed direction from the provider-interface review; no production
code has changed. Phased migration in [§ Migration](#migration) is sequenced so each phase is
independently mergeable.

## Context

Claudian drives four **providers** (Claude, Codex, Opencode, Cursor) behind a provider-neutral
**Runtime** (`ChatRuntime`). The review set out to test a suspicion that the plugin is "not
provider-agnostic" and lacks "a unified interface."

The suspicion is **half right**. A unified seam already exists and is mostly healthy:

- `ChatRuntime` (`src/core/runtime/ChatRuntime.ts`) is the single interface every **provider
  adaptor** implements; the orchestration layer consumes only provider-neutral `StreamChunk`
  values out of `query()`.
- `ProviderCapabilities` (`src/core/providers/types.ts:24`) is first-class; feature code gates
  on `runtime.getCapabilities()` rather than provider id in ~40 sites. There are **zero**
  `as ClaudeProviderState`-style casts in `features/`.
- `ProviderRegistry` + `ProviderWorkspaceRegistry` route runtime, auxiliary, and workspace
  services by provider id.

The real problems are not "no abstraction" but **a seam that is too fat, capabilities that are
too coarse, tool availability that is imperative rather than declared, and a handful of
boundary leaks** — plus an initial mis-framing (below) that we explicitly reject.

### Rejected framing: a single CLI transport

An early version of this proposal pushed for a unified CLI-subprocess transport as "the main
integration path." **We reject that.** It contradicts Claudian's own *Provider-native first*
principle: each provider should use the integration its vendor recommends.

- **Claude** — `@anthropic-ai/claude-agent-sdk` (in-process SDK; stateful persistent query).
- **Codex** — `codex app-server` JSON-RPC 2.0 over stdio (bidirectional control).
- **Cursor** — `cursor-agent --output-format stream-json` NDJSON (documented headless path).
- **Opencode** — ACP (JSON-RPC) over stdio (the CLI's native protocol).

Protocol diversity is a **feature**, not debt. Homogenizing transports would destroy
provider-native behavior (e.g. Claude's persistent-query optimization) for no architectural
gain. The goal is therefore **not** a unified transport — it is a unified seam *above* the
transport, so protocol differences are fully contained behind the adaptor boundary and the rest
of the app never knows which protocol a provider speaks.

### Problems found

| # | Problem | Evidence |
|---|---------|----------|
| P1 | `ChatRuntime` is a ~40-member god-interface mixing turn lifecycle, session/fork/rewind, command discovery, subagent hooks, and **seven** `setXxxCallback()` wiring methods. A provider must implement the whole surface even for capabilities it declares unsupported (`supportsRewind: false` still forces a `rewind()` stub). | `src/core/runtime/ChatRuntime.ts:20-66` |
| P2 | Each CLI provider reimplements subprocess spawn, NDJSON/readline framing, stderr draining, id-correlated tool tracking, and cancellation. Only Opencode reuses shared `src/providers/acp/`; Codex and Cursor duplicate the plumbing. | `CodexAppServerProcess`, `CursorChatRuntime` query loop, `AcpSubprocess` |
| P3 | `ProviderCapabilities` is a flat boolean struct, and boundary leaks persist: hardcoded `['claude','codex','opencode','cursor']` arrays in 3 files, `features/settings/providerEnableUpdaters.ts` importing each provider's settings module directly, and `DEFAULT_CHAT_PROVIDER_ID='claude'` threaded through 54 sites. | `src/core/providers/types.ts:24,40`; `src/features/settings/providerEnableUpdaters.ts`; `src/features/tasks/defaultProviderResolver.ts`; `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts`; `src/features/settings/registry/fields/agentBoard.ts` |
| P4 | Tool availability is imperative: each adaptor has a bespoke `*ToolNormalization` mapping native names → a shared string vocabulary, with no per-provider **tool manifest** the UI/core can read. | `codexToolNormalization`, `cursorToolNormalization`, `opencodeToolNormalization` |

### External patterns worth adopting

Primary-source research converged on one design across LSP, MCP, ACP, Vercel AI SDK, Cline, and
continue.dev:

- **One narrow interface the core touches; everything else is an adaptor.** (Vercel
  `doGenerate/doStream`, Cline `ApiHandler`, ACP method set.)
- **Capabilities are declarative, nested data — never `if provider == X`.** Presence of a key
  gates a method family; missing means absent; unknown keys are ignored for forward-compat;
  a version is negotiated alongside. (LSP 3.17 §capabilities, MCP capability negotiation,
  ACP `initialize`.)
- **NDJSON-over-stdio with id-correlated tool start/complete pairs is the lingua franca** —
  worth a shared *optional* parser + a `StreamingToolCallTracker`-style reassembler.
- **Tools standardize on MCP**, namespaced by prefixing on merge.
- **The first `init`/`system` event is the source of truth for session metadata**; cancellation
  is a cooperative in-band terminal event with process-kill as fallback.

(Sources: agentclientprotocol.com; modelcontextprotocol.io; LSP 3.17 spec; Vercel AI SDK
provider docs; Cline/continue.dev provider docs; Claude Code headless + Cursor CLI output-format
docs.)

## Decision

Keep the four native transports. Tighten the seam *above* them so that **adding a provider means
declaring what it supports and writing a stream mapper — in whatever protocol the vendor
recommends**, with shared plumbing available but never mandatory.

### Boundary rule

The rule is narrowly scoped to provider imports: **nothing outside `src/providers/<id>/` may
import from `src/providers/<id>/`** (a provider's internals are reachable only through
`ProviderRegistry` / `ProviderWorkspaceRegistry`). It does **not** restrict the existing,
legitimate `features/` dependencies on `i18n`, `shared`, `utils`, `core/`, or `main` — those
stay as-is. Enforced by an ESLint `no-restricted-imports` (or import-boundaries) rule so the P3
leak class cannot regrow.

```
features/  ── reads declared data (descriptor: capabilities, tools, UI) ──┐
                                                                          ▼
core/providers/   Registry · ProviderDescriptor · capability schema
core/runtime/     slim ChatRuntimeCore + opt-in capability mixins + RuntimeHost
core/transport/   OPTIONAL shared subprocess helpers (spawn/NDJSON/cancel)
core/tools/       tool-manifest contract (MCP-aligned)
                                                                          ▲
providers/<id>/   one descriptor + one stream mapper ─────────────────────┘
   claude (sdk) · codex (cli-jsonrpc) · cursor (cli-ndjson) · opencode (acp)
```

### Move 1 — Optional transport helpers (not a mandate)

Extract the genuinely-shared subprocess plumbing from `src/providers/acp/` into provider-neutral
`core/transport/` helpers: spawn, NDJSON readline framing, stderr draining, id-correlated
tool-call tracking, cooperative-cancel-then-kill, and treating the first `init`/`system` event
as session-metadata truth. Codex/Cursor/Opencode **may** reuse these to delete duplicated
boilerplate; Claude's SDK adaptor ignores them entirely. `transport` on the descriptor is a
free-form, informational label (`'sdk' | 'cli-jsonrpc' | 'cli-ndjson' | 'acp'`). Nobody is forced
onto anything. (`CachedCliResolver` is already shared and stays as-is.)

### Move 2 — Split the god-interface into core + capability mixins

```ts
interface ChatRuntimeCore {
  readonly providerId: ProviderId;
  capabilities(): ProviderDescriptor['capabilities'];
  prepareTurn(req: ChatTurnRequest): PreparedChatTurn;
  query(turn: PreparedChatTurn, history?, opts?): AsyncGenerator<StreamChunk>;
  cancel(): void;
  session: SessionController;        // new / load(replay) / resume(attach) / getId
  cleanup(): void | Promise<void>;
}

// Opt-in, each gated by a declared capability key; absent when unsupported:
interface RewindCapable   { rewind(...): Promise<ChatRewindResult>; }
interface ForkCapable     { resolveSessionIdForFork(...): string | null; }
interface SteerCapable    { steer(turn: PreparedChatTurn): Promise<boolean>; }
interface SubagentCapable { loadSubagentToolCalls(id): ...; loadSubagentFinalResult(id): ...; }
```

Replace the seven `setXxxCallback()` setters with a single `RuntimeHost` passed at construction
(approval, askUser, exitPlanMode, autoTurn, permission-sync) — the editor-services boundary, the
same shape ACP formalizes as client-provided services.

### Move 3 — Declarative, negotiable capability descriptor

Adopt the LSP/MCP/ACP convention: nested capability objects, presence-gates-feature,
missing-means-off, unknown-keys-ignored, version-tagged.

```ts
interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;                 // removes the hardcoded label map
  blankTabOrder: number;
  protocolVersion: number;             // negotiated; stored in providerState
  transport: 'sdk' | 'cli-jsonrpc' | 'cli-ndjson' | 'acp';  // informational
  capabilities: {
    planMode?: { planPathPrefix?: string };
    rewind?: {}; fork?: {}; steer?: {};
    history?: { resume: boolean; load: boolean };
    prompt?: { image?: boolean; instructionMode?: boolean };
    mcp?: { tools: boolean; managed: boolean };
    subagents?: {};
    reasoning?: 'effort' | 'token-budget' | 'none';
  };
  tools: ToolManifest;                 // Move 4
  // existing factories + chatUIConfig + settingsReconciler unchanged
}
```

Registries enumerate descriptors, so the 3 hardcoded provider arrays, the label map, and
`PROVIDER_ENABLE_UPDATERS` collapse into registry queries; `DEFAULT_CHAT_PROVIDER_ID='claude'`
becomes "first enabled descriptor by `blankTabOrder`."

### Move 4 — Declarative tool manifest (MCP-aligned)

Each descriptor carries a `ToolManifest`: the native→canonical name map (today's normalization
tables, expressed as data) plus the canonical tools the provider exposes. The UI reads the
manifest instead of inferring from the stream. Standardize the shared vocabulary on MCP
semantics; prefix MCP tool names by server id on merge so cross-server collisions are a substrate
concern, not per-provider.

### Move 5 — Close the leaks, lock the boundary

Remove the hardcoded provider lists, move provider-settings updaters behind registry-registered
functions (no cross-boundary import), centralize display names on the descriptor, and add the
ESLint boundary rule.

## Consequences

**Positive**

- "Add a provider" reduces to: write a `ProviderDescriptor` + a stream mapper, in the vendor's
  recommended protocol; reuse `core/transport/` helpers only if they fit.
- Provider-native integrations are preserved (no transport homogenization).
- UI surfaces (plan mode, fork, rewind, image attachments, MCP) adapt off declared data; the
  interface and capability flags can no longer disagree about what is optional.
- The boundary leak class is made structurally impossible (lint-enforced).

**Negative / risks**

- Moves 2–4 touch all four adaptors (mechanical, but broad). Sequenced to land incrementally.
- A `RuntimeHost` refactor reworks how features wire approval/askUser/plan-mode callbacks.
- Tool-manifest extraction must preserve current normalization behavior exactly (cover with the
  existing `*ToolNormalization` tests before refactoring).

**Neutral**

- `Conversation.providerState` stays opaque and typed-per-provider; no change.

## Migration

Each phase is independently mergeable and leaves the plugin green
(`typecheck && lint && test && build`).

1. **Phase 0 — Leak cleanup + boundary lint.** Move 5 + the `displayName`/enumeration parts of
   Move 3. Low risk; proves the seam holds. No transport or runtime changes.
2. **Phase 1 — Descriptor + nested capabilities + tool manifest.** Moves 3 + 4 (data-only;
   feature gates read the descriptor).
3. **Phase 2 — Split `ChatRuntime` into core + mixins + `RuntimeHost`.** Move 2.
4. **Phase 3 — `core/transport/` optional helpers; migrate Cursor + Codex onto them where they
   fit; fold ACP plumbing in as one consumer.** Move 1.

The previously-proposed "Claude-on-CLI" phase is **dropped** — it existed only to chase a
transport uniformity this ADR explicitly rejects.

## Success test

> Adding a provider = a descriptor + a stream mapper, in whatever protocol the vendor
> recommends, reusing shared subprocess helpers only if they happen to fit — with no
> `providerId === 'x'` branch and no edit to a hardcoded provider list anywhere in `core/` or
> `features/`.
