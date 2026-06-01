---
title: Transport-agnostic provider seam
date: 2026-06-01
revised: 2026-06-01
status: proposed (revised after design review)
scope: src/core/providers, src/core/runtime, src/providers/*, src/features (boundary)
supersedes: none
method: 3 parallel codebase review passes (core seam, coupling-leak audit, adaptor comparison) + external pattern research (ACP, LSP/MCP capability negotiation, Vercel AI SDK, Cline, continue.dev), then a 4-pass design review (claim verification, design red-team, external-pattern fact-check, migration feasibility)
---

# ADR 0001 — Transport-agnostic provider seam

## Status

Proposed, **revised after a four-pass design review** (see [§ Revision history](#revision-history)).
No production code has changed. The review found the original diagnosis sound but the
prescription over-built for a 4-provider, in-process plugin; this revision keeps the high-yield
moves, drops the cargo-culted ones, and corrects several inflated figures.

## Context

Claudian drives four **providers** (Claude, Codex, Opencode, Cursor) behind a provider-neutral
**Runtime** (`ChatRuntime`). The review set out to test a suspicion that the plugin is "not
provider-agnostic" and lacks "a unified interface."

The suspicion is **half right**. A unified seam already exists and is mostly healthy:

- `ChatRuntime` (`src/core/runtime/ChatRuntime.ts`) is the single interface every **provider
  adaptor** implements; the orchestration layer consumes only provider-neutral `StreamChunk`
  values out of `query()`.
- `ProviderCapabilities` (`src/core/providers/types.ts:24`) is first-class; feature code gates
  on `runtime.getCapabilities()` rather than provider id (≈12 files / ≈30 gate sites). There are
  **zero** `as ClaudeProviderState`-style casts in `features/`, and **zero** `providerId === 'x'`
  branches in `features/` or `core/` — the abstraction is already working.
- `ProviderRegistry` + `ProviderWorkspaceRegistry` route runtime, auxiliary, and workspace
  services by provider id, and already expose `getRegisteredProviderIds()`,
  `getProviderDisplayName()`, `getEnabledProviderIds()`, `getCapabilities()`, and
  `getSettingsReconciler()`.

The real problems are narrower than "no abstraction": **duplicated transport plumbing across the
CLI providers, a wider-than-necessary runtime interface, and a handful of static cross-boundary
imports** — plus an initial mis-framing (below) that we explicitly reject.

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

Figures below are post-review counts (verified against the tree).

| # | Problem | Evidence |
|---|---------|----------|
| P1 | `ChatRuntime` is a wide interface (**38 members**) mixing turn lifecycle, session/fork/rewind, command discovery, subagent hooks, and **6** callback-wiring setters. A provider must implement the whole surface even for unsupported capabilities (`supportsRewind: false` still ships a `rewind()` stub). *Caveat: the feature layer already capability-gates these calls, so this is interface width, not a live hazard.* | `src/core/runtime/ChatRuntime.ts:20-66` |
| P2 | The CLI providers duplicate subprocess plumbing — spawn, JSON-RPC/NDJSON framing, bounded-stderr buffering, SIGTERM→SIGKILL cancellation. `CodexRpcTransport` is a near-clone of `AcpJsonRpcTransport`; `CodexAppServerProcess` and `AcpSubprocess` are ~80% identical. Only Opencode currently reuses `src/providers/acp/`. | `CodexAppServerProcess`, `CodexRpcTransport`, `CursorChatRuntime` query loop, `AcpSubprocess`, `AcpJsonRpcTransport` |
| P3 | Static cross-boundary imports and hardcoded provider lists: **5+** hardcoded `['claude','codex','opencode','cursor']` arrays / label maps, plus three outside-provider imports from `src/providers/<id>/`. `DEFAULT_CHAT_PROVIDER_ID='claude'` is threaded through **42** sites. | `src/features/tasks/defaultProviderResolver.ts:4`; `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts:4`; `src/features/settings/registry/fields/agentBoard.ts:14,16-21`; `src/features/.../SearchResultsView.ts:40`; `featureFlag.ts`; leak inventory in [Move 4](#move-4--close-the-leaks-lock-the-boundary) |
| P4 | Tool *naming* differs per provider: each adaptor maps native tool names to a shared vocabulary inside its `*ToolNormalization` module. The **name tables** are data; the surrounding **reshaping is logic** (see Move 5 scope note). | `codexToolNormalization`, `cursorToolNormalization`, `opencodeToolNormalization` |

### External patterns — what genuinely transfers

Primary-source research (cited below) surfaced patterns from LSP, MCP, ACP, Vercel AI SDK, Cline,
and continue.dev. The fact-check pass flagged which ones apply to an **in-process** plugin and
which are wire-protocol mechanisms that do not:

- **One narrow interface the core touches; everything else is an adaptor.** *Transfers.* The
  cleanest analogy is **Cline's `ApiHandler`** (a single in-process seam the task engine touches).
  Vercel's `doGenerate/doStream` is *not* a peer pattern — it is a stateless completion codec
  explicitly not meant for direct use, at the wrong altitude for a stateful session runtime.
- **Declarative capabilities, presence-gates-feature, missing-means-off, unknown-keys-ignored.**
  *Transfers as config typing* (LSP 3.17, MCP, ACP all do this). **Version *negotiation* does
  not transfer** — it exists to bridge independently-deployed peers over a wire; here core and
  adaptor are one bundled artifact, so there is nothing to negotiate.
- **A shared, optional tool-call reassembler** (Vercel's real, exported `StreamingToolCallTracker`
  in `@ai-sdk/provider-utils`) and **line-delimited-JSON parsing**. *Transfers*, scoped to the CLI
  providers. Note: "NDJSON-over-stdio is the lingua franca" holds for only ~2 of 4 transports
  (Cursor stream-json; Claude headless-style) — ACP is RPC-framed and Claude ships in-process — so
  the shared helper is *opt-in*, not universal.
- **First `init`/`system` event as session-metadata source of truth.** *Transfers* to the
  Cursor/Codex/Opencode stream adaptors.
- **Cancellation as cooperative-then-kill.** Cooperative in-band cancel is real for ACP/Codex;
  for Cursor/Claude-headless, process-kill is effectively primary. A shared helper should *try*
  cooperative cancel then fall back to kill — not assume in-band cancel everywhere.
- **MCP for tools, namespaced by prefixing on merge.** Standardizing on MCP is reasonable;
  prefix-on-merge is a sound *client-side convention* filling a gap the MCP spec leaves open — it
  is not an MCP recommendation, so we adopt it as our own engineering choice.

(Sources: agentclientprotocol.com; modelcontextprotocol.io; LSP 3.17 spec; Vercel AI SDK
provider docs + `StreamingToolCallTracker` source; Cline/continue.dev provider docs; Claude Code
headless + Cursor CLI output-format docs.)

## Decision

Keep the four native transports. Tighten the seam *above* them so that **adding a provider means
declaring what it supports and writing a stream mapper — in whatever protocol the vendor
recommends**, with shared plumbing available but never mandatory.

The review's central correction: the existing `ProviderRegistry` + `ProviderCapabilities` +
capability-gated call sites already implement most of what a capability-negotiation playbook is
for. So we **extend what exists** rather than introduce parallel machinery, and we deliver the
value in the cheapest order.

### Boundary rule

The rule is narrowly scoped to provider imports: **nothing outside `src/providers/<id>/` may
import from `src/providers/<id>/`** (a provider's internals are reachable only through
`ProviderRegistry` / `ProviderWorkspaceRegistry`). It does **not** restrict the existing,
legitimate `features/` dependencies on `i18n`, `shared`, `utils`, `core/`, or `main`, and it must
**not** fire on legitimate *intra-provider* imports (e.g. Opencode importing its own `../modes`) —
scope it precisely to "imported from outside the owning `src/providers/<id>/` directory."

Enforced by extending the existing ESLint `no-restricted-imports` config (`eslint.config.mjs`).
That config currently has **stale globs pointing at deleted files** (`src/ClaudianService.ts`,
`src/sdk/**`) — prune them when adding the boundary rule.

```
features/  ── reads declared data (registration: capabilities, tools, UI) ─┐
                                                                          ▼
core/providers/   ProviderRegistry · ProviderRegistration · capabilities
core/runtime/     slimmer ChatRuntime + RuntimeHost (callbacks)
core/transport/   OPTIONAL: shared spawn helper + shared JSON-RPC-over-stdio client
core/tools/       canonical tool-name table on the registration
                                                                          ▲
providers/<id>/   one registration + one stream mapper ───────────────────┘
   claude (sdk) · codex (cli-jsonrpc) · cursor (cli-ndjson) · opencode (acp)
```

### Move 1 — Close the leaks, lock the boundary *(cheapest, highest yield — do first)*

Replace the hardcoded provider arrays and the duplicate `PROVIDER_LABELS` map with
`getRegisteredProviderIds()` + `getProviderDisplayName()` (both already on `ProviderRegistry`),
and route the three outside-provider imports behind the registry. Then add the scoped ESLint
boundary rule. **Enable the rule only once all three imports are closed** — otherwise lint fails
on day one.

| Import site | Provider internal | Clean home (already exists) |
|-------------|-------------------|------------------------------|
| `src/features/settings/providerEnableUpdaters.ts:2-5` | `providers/{claude,codex,cursor,opencode}/settings` | a `setEnabled()` method on `ProviderSettingsReconciler`, routed via `getSettingsReconciler(id)` |
| `src/features/settings/registry/fields/opencode.ts:2` | `providers/opencode/settings` (`getOpencodeProviderSettings`) | a mode-options accessor (the registration's `chatUIConfig.getModeSelector` already exists) |
| `src/main.ts:64` / `:706` | `providers/opencode/modes` (`OPENCODE_PLAN_MODE_ID`, `OPENCODE_SAFE_MODE_ID`) | the reconciler's existing `normalizeOnLoad?()` hook (already wired through `ProviderSettingsCoordinator`) |

This needs **no new type**. It captures the "no `providerId` branch, no hardcoded provider list"
half of the goal immediately and guards it against regression.

### Move 2 — Extract the shared transport plumbing *(the most concretely justified de-dup)*

The review refuted the assumption that `AcpJsonRpcTransport` is ACP-coupled: it takes generic Node
streams, and `CodexRpcTransport` is a near-clone. Extract two helpers into `core/transport/`, with
**named beneficiaries** rather than a vague "optional helper":

- **`spawnAgentProcess()`** — spawn + bounded-stderr drain + SIGTERM→SIGKILL cancellation +
  Windows `.cmd` quoting. Beneficiaries: **Codex, Cursor, Opencode** (Claude's SDK adaptor does
  not spawn).
- **`JsonRpcStdioClient`** — JSON-RPC 2.0 framing over a readline stream, pending-request map,
  notification + server-request handlers, timeouts. Beneficiaries: **Codex + Opencode**. Cursor's
  NDJSON stream-json loop is *not* request/response and will **not** adopt this — it reuses only
  the spawn helper. Say so plainly; do not pretend it folds in.

Prerequisite: land the open subprocess-lifecycle fixes (the `docs/reviews/2026-05-31` plan's
CON-1/2/3: Cursor SIGTERM-only, hang-forever shutdown) **before** extraction, so the shared helper
encodes the corrected cancellation behavior once.

### Move 3 — Slim the runtime: a single `RuntimeHost` *(endorsed)*; mixins are a minor tidy

Replace the **6** callback setters (`setApprovalCallback`, `setAskUserQuestionCallback`,
`setExitPlanModeCallback`, `setPermissionModeSyncCallback`, `setSubagentHookProvider`,
`setAutoTurnCallback`) with a single `RuntimeHost` object passed at construction. This is safe:
the setters are wired at exactly one site (`features/chat/tabs/tabControllers.ts:471-528`),
**set once per runtime, never reset to null**, with closures reading live state.

```ts
interface RuntimeHost {
  approval: ApprovalCallback;
  askUser: AskUserQuestionCallback;
  exitPlanMode: ExitPlanModeCallback;
  permissionModeSync(mode: string): void;
  autoTurn: AutoTurnCallback;
  subagentState(): SubagentRuntimeState;
}
```

The original "split into core + capability mixins" idea is **demoted to a same-PR type tidy**: the
feature layer *already* capability-gates optional methods (`supportsRewind` before `rewind()`,
`steer` double-guarded by `supportsTurnSteer` + `typeof`, `loadSubagentToolCalls?.`). Optional
members on the interface can simply be marked optional (`rewind?`, `steer?`) and the three trivial
stubs deleted — no parallel mixin hierarchy is needed for a 4-provider plugin.

### Move 4 — Extend `ProviderRegistration`; keep capabilities flat; lift the tool-name table

Do **not** introduce a parallel `ProviderDescriptor` — it duplicates the existing
`ProviderRegistration` (`types.ts:55`, which already carries `displayName`, `blankTabOrder`,
`isEnabled`, `capabilities`, `chatUIConfig`, `settingsReconciler`, and the factories) and creates a
two-headed "which struct owns `capabilities`?" problem. Extend `ProviderRegistration` instead:

- **Keep `ProviderCapabilities` flat.** The nested-object reshape forces a rewrite of ~30 gate
  sites for zero functional gain; presence-gating buys forward-compat for third-party capability
  producers that do not exist here. Revisit only if a second consumer appears.
- **Drop `protocolVersion`.** It is meaningless for three of four providers (Claude = npm dep,
  Cursor/Codex = installed binary) and already lives where it is real (the ACP handshake,
  `AcpClientConnection.ts:139`). If cross-version `providerState` ever needs migrating, model that
  as an explicit *schema-migration marker*, not "negotiation."
- **Lift only the canonical tool-name table** onto the registration so the UI can enumerate a
  provider's tool names. **Normalization stays code:** `cursorToolNormalization.ts` resolves one
  native name to *different* canonical tools by argument shape (`'oldString' in args` → replace vs
  `'content' in args` → edit) and reshapes inputs/results per kind — that cannot be static data,
  and the UI already consumes normalized `StreamChunk`s (it never infers from the raw stream), so a
  full "tool manifest the UI reads" delivers no benefit. This is the original Move 4 rescoped from
  "manifest as data" to "name table as data, logic stays."

## Consequences

**Positive**

- "Add a provider" reduces to: extend `ProviderRegistration` + write a stream mapper, in the
  vendor's recommended protocol; reuse `core/transport/` helpers where they fit.
- Provider-native integrations are preserved (no transport homogenization).
- The boundary leak class is made structurally impossible (lint-enforced).
- Net new code is small: two transport helpers + one `RuntimeHost` type; no parallel registration
  struct, no nested-capability migration, no tool-manifest framework.

**Negative / risks**

- Move 3's `RuntimeHost` reworks how features wire approval/askUser/plan-mode callbacks (one site).
- Move 2 must be sequenced **after** the open subprocess-lifecycle fixes and **coordinated with**
  the `docs/reviews/2026-05-31` god-file splits (ARCH-3/5/6 touch `Tab.ts`, `tabControllers.ts`,
  `StreamController.ts` — the same files and the sole `RuntimeHost` wiring site).
- Test mocks are `as any` partial runtimes, so **typecheck will not catch interface drift**. Add a
  typed `createMockRuntime()` helper as part of Move 3.

**Neutral**

- `Conversation.providerState` stays opaque and unchanged (this revision drops the `protocolVersion`
  write that would have violated that promise).

## Migration

Each phase is independently mergeable and leaves the plugin green
(`typecheck && lint && test && build`). The order below is the cheapest-value-first resequencing
recommended by the review.

1. **Phase 0 — Leak cleanup + boundary lint (Move 1).** No new type, no behavior change; proves
   the seam holds. Size: **S**.
2. **Phase 1 — Extend `ProviderRegistration` + lift tool-name table + flat-capability accessors
   (Move 4).** Mechanical; no nested-capability migration. Size: **S–M**.
3. **Phase 2 — `RuntimeHost` + mark optional members optional (Move 3).** One wiring site; add the
   typed runtime mock. **Coordinate with the 2026-05-31 god-file splits.** Size: **M**.
4. **Phase 3 — Extract `core/transport/` helpers; migrate Codex + Opencode onto the JSON-RPC
   client; all CLI providers onto the spawn helper (Move 2).** Land **after** the CON-1/2/3
   lifecycle fixes. Size: **M–L**.

The previously-proposed "Claude-on-CLI" phase is **dropped** — it existed only to chase a
transport uniformity this ADR explicitly rejects. The previously-proposed nested-capability
descriptor, `protocolVersion`, and "tool manifest as data" are also dropped (see Revision history).

## Success test

> Adding a provider = extend `ProviderRegistration` + a stream mapper, in whatever protocol the
> vendor recommends, reusing shared subprocess/JSON-RPC helpers only if they fit — with no
> `providerId === 'x'` branch and no edit to a hardcoded provider list anywhere in `core/` or
> `features/`.

## Revision history

**2026-06-01 — revised after a four-pass design review.** Changes from the first version, with
rationale:

| Change | Why |
|--------|-----|
| Corrected figures: ~40→**38** members, "seven"→**6** setters, "~40"→**≈12 files/≈30** gate sites, "54"→**42** `DEFAULT_CHAT_PROVIDER_ID`, "3"→**5+** hardcoded arrays | Claim-verification pass found the originals inflated/imprecise; the corrected counts still support the thesis. |
| **Dropped `protocolVersion`** (was on the descriptor + stored in `providerState`) | Three reviewers independently flagged it as cargo-culting: nothing to negotiate in an in-process bundle, and it contradicted the "providerState unchanged" promise. |
| **Dropped the parallel `ProviderDescriptor`; extend `ProviderRegistration` instead; keep capabilities flat** | The descriptor duplicated the existing registration; nested capabilities would churn ~30 gate sites for no functional gain. |
| **Rescoped the tool manifest** from "data the UI reads" to "lift the name table; normalization stays code" | The `*ToolNormalization` modules are argument-shape-dependent logic, not static maps, and the UI consumes already-normalized chunks. |
| **Demoted the capability-mixin split** to marking optional members optional | The feature layer already capability-gates these calls at runtime; a mixin hierarchy is unjustified for 4 providers. |
| **Reordered phases** to value-first (leaks → registration → RuntimeHost → transport) and **renamed Move 1's beneficiaries** (spawn helper: all CLI; JSON-RPC client: Codex+Opencode only; Cursor: spawn-only) | The "optional helper nobody must use" framing risks a half-migrated abstraction; Cursor's NDJSON loop won't adopt the JSON-RPC client. |
| **Added cross-plan sequencing** vs `docs/reviews/2026-05-31` and a **CON-1/2/3 prerequisite** for the transport extraction; added the **typed `createMockRuntime()`** requirement and the **stale-ESLint-glob** cleanup | Migration-feasibility pass surfaced file collisions, buggy cancellation code that should be fixed before extraction, and mocks that hide interface drift. |
| **Softened external-pattern framing** (`doGenerate/doStream` altitude; "NDJSON lingua franca"; MCP prefix-on-merge as convention; cancellation cooperative-then-kill) | External-pattern fact-check found these accurate as facts but overstated as universal/spec-mandated. |
