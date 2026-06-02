---
title: Transport-agnostic provider seam
date: 2026-06-01
revised: 2026-06-01 (r2)
status: design / approved
scope: src/core/providers, src/core/runtime, src/providers/*, src/features (boundary)
supersedes: none
method: 3 parallel codebase review passes (core seam, coupling-leak audit, adaptor comparison) + external pattern research (ACP, LSP/MCP capability negotiation, Vercel AI SDK, Cline, continue.dev), then a 4-pass design review (claim verification, design red-team, external-pattern fact-check, migration feasibility), then a 6-perspective independent verification pass (architect, Phase-0 implementer, red-team skeptic, external-pattern fact-check, test/maintainability, migration sequencer)
---

# ADR 0001 — Transport-agnostic provider seam

## Status

Proposed, **revised twice** — once after a four-pass design review, and again after a
six-perspective independent verification pass that uncovered residual claim-inflation, two
factual errors about external patterns, several already-landed prerequisites, an unflagged
cross-plan collision, and missing carve-outs for migration-backfill sites (see
[§ Revision history](#revision-history)). No production code has changed. The architectural
direction is unchanged from r1; r2 fixes facts, line cites, scope notes, and missing
test/migration concerns.

## Context

Claudian drives four **providers** (Claude, Codex, Opencode, Cursor) behind a provider-neutral
**Runtime** (`ChatRuntime`). The review set out to test a suspicion that the plugin is "not
provider-agnostic" and lacks "a unified interface."

The suspicion is **half right**. A unified seam already exists and is mostly healthy:

- `ChatRuntime` (`src/core/runtime/ChatRuntime.ts`) is the single interface every **provider
  adaptor** implements; the orchestration layer consumes only provider-neutral `StreamChunk`
  values out of `query()`.
- `ProviderCapabilities` (`src/core/providers/types.ts:24`) is first-class; feature code gates
  on `runtime.getCapabilities()` rather than provider id. There are **zero**
  `as ClaudeProviderState`-style casts in `features/`, and **zero** `providerId === 'x'` branches
  in `features/` or `core/` (the one match, `OpencodeRuntimeCommandLoader.ts:35`, is intra-provider).
  Capability-gating shows up as ~3 `runtime.getCapabilities().supports*` reads at the public
  boundary plus broader `getCapabilities()` destructuring inside provider code; the abstraction is
  working and not the bottleneck.
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
| P1 | `ChatRuntime` is a wide interface (**31 distinct members** — earlier "~40" and "38" counts were inflated by multi-line parameter blocks) mixing turn lifecycle, session/fork/rewind, command discovery, subagent hooks, and **7** callback-wiring setters. A provider must implement the whole surface even for unsupported capabilities (`supportsRewind: false` still ships a `rewind()` stub). *Caveat: the feature layer already capability-gates these calls, so this is interface width, not a live hazard.* | `src/core/runtime/ChatRuntime.ts:20-66` |
| P2 | The CLI providers duplicate subprocess plumbing. **The subprocess pair is the close clone:** `AcpSubprocess` (154 LOC) and `CodexAppServerProcess` (159 LOC) are ~80% identical — spawn, bounded-stderr buffering, SIGTERM→SIGKILL shutdown. **The RPC pair is *not* a near-clone:** `AcpJsonRpcTransport` is **427 LOC** with AbortController-driven close, multi-handler notification sets, signal/timeout cleanup, and stream-event subscriptions; `CodexRpcTransport` is **171 LOC** with single-handler maps, no AbortController, no abort/signal plumbing. They share *concepts* (pending-request map, line splitting, request/notify methods) but ACP is ~2.5× the size and materially more capable. Cursor's NDJSON loop is fire-and-forget streaming, not request/response. Only Opencode currently reuses `src/providers/acp/`. | `CodexAppServerProcess`, `CodexRpcTransport`, `CursorChatRuntime` query loop, `AcpSubprocess`, `AcpJsonRpcTransport` |
| P3 | Static cross-boundary imports and hardcoded provider lists: **7** hardcoded `['claude','codex','opencode','cursor']` arrays / label maps (revised up from "5+" after enumeration), plus three outside-provider imports from `src/providers/<id>/`. `DEFAULT_CHAT_PROVIDER_ID='claude'` is threaded through **42** sites, of which **~6 are migration-backfill** that must remain literal `'claude'` (see Move 1 carve-out). | `src/features/tasks/defaultProviderResolver.ts:4`; `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts:4`; `src/features/settings/firstRunBanner/FirstRunBanner.ts:4-9`; `src/features/settings/registry/fields/agentBoard.ts:14,16-21`; `src/features/settings/registry/fields/general.ts:96-101`; `src/features/settings/search/SearchResultsView.ts:40`; leak inventory in [Move 1](#move-1--close-the-leaks-lock-the-boundary-cheapest-highest-yield--do-first) |
| P4 | Tool *naming* differs per provider: each adaptor maps native tool names to a shared vocabulary inside its `*ToolNormalization` module. The **name tables** are data; the surrounding **reshaping is logic** (see Move 5 scope note). | `codexToolNormalization`, `cursorToolNormalization`, `opencodeToolNormalization` |

### External patterns — what genuinely transfers

Primary-source research (cited below) surfaced patterns from LSP, MCP, ACP, Vercel AI SDK, Cline,
and continue.dev. The fact-check pass flagged which ones apply to an **in-process** plugin and
which are wire-protocol mechanisms that do not:

- **One narrow interface the core touches; everything else is an adaptor.** *Transfers — with a
  width caveat.* The cleanest analogy is **Cline's `ApiHandler`** (a single in-process seam the
  task engine touches), but Cline's seam is **4 members** (`createMessage`, `getModel`,
  `getApiStreamUsage?`, `abort?`) versus our **31** — Cline's is a completion seam, ours is a
  session-lifecycle seam, so the analogy is *shape*, not *width*. Vercel's `doGenerate/doStream`
  is *not* a peer pattern — community guidance (`vercel/ai#2196`) treats it as a stateless
  completion codec effectively not for direct use, at the wrong altitude for a stateful session
  runtime.
- **Declarative capabilities, presence-gates-feature, missing-means-off, unknown-keys-ignored.**
  *Transfers as config typing* (LSP 3.17 + MCP confirmed; ACP is explicit that omitted
  capabilities mean unsupported but does not publish a formal "ignore unknown keys" rule). **For
  *version*: ACP and MCP genuinely negotiate per spec** — clients propose, agents respond with the
  supported version or fail. We still drop version handling from our descriptor because core and
  adaptor are one bundled artifact and there is no independently-deployed peer to negotiate with;
  this is a design judgment about our deployment shape, not a refutation of the upstream pattern.
- **A shared, optional tool-call reassembler** (Vercel's real, exported `StreamingToolCallTracker`
  in `@ai-sdk/provider-utils` — verified to exist and to emit
  `tool-input-start/-delta/-end/tool-call` for OpenAI-shaped delta streams) and
  **line-delimited-JSON parsing**. *Transfers*, scoped to the CLI providers. Note: "NDJSON-over-
  stdio is the lingua franca" holds for **~1 of 4 transports in Claudian** (Cursor stream-json
  only). Codex is JSON-RPC; Opencode is JSON-RPC over ACP; Claude ships **in-process via
  `@anthropic-ai/claude-agent-sdk`** (the earlier "Claude headless-style" phrasing was wrong —
  Claudian does not use Claude's headless NDJSON path). The shared helper is *opt-in*, not
  universal.
- **First `init`/`system` event as session-metadata source of truth.** *Transfers* to the
  Cursor/Codex/Opencode stream adaptors.
- **Cancellation as cooperative-then-kill.** Cooperative in-band cancel is spec'd for ACP
  (`session/cancel`) and Codex (`turn/interrupt`, though `openai/codex#20925` notes practical
  hangs); for Cursor (no documented in-band cancel for `--output-format stream-json`) and Claude
  (in-process SDK uses `AbortSignal`/`child.kill()`, not headless cancel), process-kill is
  effectively primary. A shared helper should *try* cooperative cancel then fall back to kill —
  not assume in-band cancel everywhere.
- **MCP for tools, namespaced by prefixing on merge.** Standardizing on MCP is reasonable;
  prefix-on-merge is a sound *client-side convention* — the MCP spec only requires uniqueness
  within one server and suggests clients implement disambiguation, while the specific
  `mcp__server__tool` form is a **Claude Agent SDK convention** (per `anthropics/claude-code#18763`)
  not an MCP recommendation. We adopt it as our own engineering choice.

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
`ProviderRegistry` / `ProviderWorkspaceRegistry`). Three exemptions keep it from firing on
legitimate code:

1. It does **not** restrict the existing `features/` dependencies on `i18n`, `shared`, `utils`,
   `core/`, or `main`.
2. It must **not** fire on *intra-provider* imports (e.g. Opencode importing its own `../modes`) —
   scope it to "imported from outside the owning `src/providers/<id>/` directory."
3. It must **exempt the bootstrap aggregator(s) that call `ProviderRegistry.register` /
   `ProviderWorkspaceRegistry.register`** (today: `src/providers/index.ts`). Phrasing it this way
   rather than literal-pinning to `src/providers/index.ts` keeps `src/main.ts` *in scope* of the
   rule once Phase 0 closes the three current `main.ts` leaks — `main.ts` is not a permanent
   exemption.

Enforced by extending the existing ESLint `no-restricted-imports` config (`eslint.config.mjs`).
**That config's entire `no-restricted-imports` block (`eslint.config.mjs:117-126`) is dead** —
all 8 globs (`src/ClaudianService.ts`, `src/InlineEditService.ts`,
`src/InstructionRefineService.ts`, `src/images/**`, `src/prompt/**`, `src/sdk/**`,
`src/security/**`, `src/tools/**`) reference files that have moved or been deleted and match zero
files today. Delete the entire stale block when adding the boundary rule; do not surgically prune
two entries.

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

| Import site | Provider internal | Clean home (already exists or marked NEW) |
|-------------|-------------------|------------------------------|
| `src/features/settings/providerEnableUpdaters.ts:2-5` | `providers/{claude,codex,cursor,opencode}/settings` | **NEW** optional `setEnabled?(settings, enabled): void` on `ProviderSettingsReconciler`, routed via `getSettingsReconciler(id)`. Each provider's impl is a one-line wrapper around its existing `update<Provider>ProviderSettings(s, { enabled })`. Pair with a settings round-trip integration test (see [§ Test debt](#test-debt-and-perf)). |
| `src/features/settings/registry/fields/opencode.ts:2` | `providers/opencode/settings` (`getOpencodeProviderSettings`) | **NEW** registration-level `getAvailableModes?(settings)` accessor (on `ProviderChatUIConfig` or the registration). `chatUIConfig.getModeSelector` does **not** cover this — Opencode's impl returns `null` (`OpencodeChatUIConfig.ts:255`) and the settings field reads `availableModes` (`opencode.ts:42-45`), which the selector never exposes. This is the one Phase 0 site that is not pure indirection. |
| `src/main.ts:64` / `:706` | `providers/opencode/modes` (`OPENCODE_PLAN_MODE_ID`, `OPENCODE_SAFE_MODE_ID`) | the reconciler's existing `normalizeOnLoad?()` hook (already wired through `ProviderSettingsCoordinator` at `:108-117`, invoked from `ClaudianSettingsStorage.ts:77`). Note: the *provider-neutral* `permissionMode==='plan'→'normal'` rewrite at `main.ts:687-700` stays in `main.ts` — it touches the shared settings bag and is not provider-internal. |

**Provider-array carve-outs (do not blindly swap):**

- **`src/features/tasks/defaultProviderResolver.ts:4` (`ORDER` constant)** is a *preference order*
  for fallback selection. `getRegisteredProviderIds()` returns insertion order from
  `src/providers/index.ts`, which is not stable as a preference contract — use
  `getEnabledProviderIds()` instead (already sorted by `blankTabOrder`).
- **`src/features/settings/search/SearchResultsView.ts:40`** is *not* a pure provider list — it
  interleaves provider ids with `'general'`, `'agentBoard'`, `'orchestrator'`, `'diagnostics'`
  for tab ordering. Splice `getRegisteredProviderIds()` into the existing structure rather than
  replacing the array wholesale.
- The other five hardcoded sites (`hasAnyProviderEnabled.ts:4`, `FirstRunBanner.ts:4-9`,
  `agentBoard.ts:14`, `general.ts:96-101`, the `PROVIDER_LABELS` map at `agentBoard.ts:16-21`)
  are order-insensitive and swap cleanly.

**`DEFAULT_CHAT_PROVIDER_ID` (42 sites) carve-out:** ~6 sites are *migration backfill* for
legacy session metadata missing `providerId` (`ConversationStore.ts:55,104`,
`SessionStorage.ts:80`, and similar). These must remain literal `'claude'` (the historical
default) or route through `ProviderRegistry.resolveSettingsProviderId` (which already encodes
"prefer claude → first enabled"). The remaining ~36 sites — capability fallback, header seed,
last-resort `??` chains — are safe to swap to "first enabled by `blankTabOrder`."

This needs **no new struct** but does add **two new optional methods on existing interfaces**
(`setEnabled?` on `ProviderSettingsReconciler`; `getAvailableModes?` on `ProviderChatUIConfig` or
the registration). It captures the "no `providerId` branch, no hardcoded provider list" half of
the goal immediately and guards it against regression.

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

Replace the **7** callback setters (`setApprovalCallback`, `setApprovalDismisser`,
`setAskUserQuestionCallback`, `setExitPlanModeCallback`, `setPermissionModeSyncCallback`,
`setSubagentHookProvider`, `setAutoTurnCallback`) with a single `RuntimeHost` object passed at
construction. This is safe: the setters are wired at exactly one site
(`features/chat/tabs/tabControllers.ts:471-528`), **set once per runtime, never reset to null**,
with closures reading live state.

```ts
interface RuntimeHost {
  approval: ApprovalCallback;
  dismissApproval(): void;             // clears pending approval UI on cancel/reset
  askUser: AskUserQuestionCallback;
  exitPlanMode: ExitPlanModeCallback;
  permissionModeSync(mode: string): void;
  autoTurn: AutoTurnCallback;
  getSubagentState(): SubagentRuntimeState;  // lazy accessor; matches today's `getState: () => SubagentRuntimeState`
}
```

`dismissApproval` is load-bearing, not cosmetic. The current `setApprovalDismisser` *setter*
definitions live at `ClaudeChatRuntime.ts:1816` and `CodexChatRuntime.ts:650`, but the
load-bearing *call sites* are `ClaudeChatRuntime.ts:1660` (inside `cancel()`) and
`CodexChatRuntime.ts:752` (inside `dismissApprovalUI()`, invoked from teardown around `:981`).
Omitting it from `RuntimeHost` would leave approval prompts stuck on screen after a cancel.

**Error-surface contract.** Today `set*Callback(null)` is legal even though no production code
calls it; a construction-time `RuntimeHost` removes that escape hatch. The contract must specify:
host methods are *always callable* once the runtime is constructed; if the UI is not yet ready,
the host implementation is responsible for queueing/no-oping. The Phase 2 PR must include a unit
test asserting `host.dismissApproval()` fires on cancel for both Claude and Codex (today's
behavior should be preserved exactly).

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
- **Lift the canonical tool-name set per provider, not a bidirectional table.** Codex
  (`codexToolNormalization.ts:12-23`) and Opencode (`opencodeToolNormalization.ts:19-32`) already
  expose flat `Record<string,string>` native→canonical maps that *could* be lifted as data, but
  the lifted artifact the UI actually needs is **the set of canonical tool names a provider can
  produce** (for enumeration / UI capability surfaces) — not the bidirectional table. **Cursor
  cannot lift its table at all:** `resolveCursorToolKind()` (`cursorToolNormalization.ts:98-106`)
  resolves one native name (`TOOL_WRITE`) to *different* canonical tools by argument shape
  (`'oldString' in args` → `Edit`, `'content' in args` → `Write`) and reshapes inputs/results per
  kind — that is logic, not data. The UI already consumes normalized `StreamChunk`s (it never
  infers from the raw stream), so a "full tool manifest the UI reads" delivers no benefit. This is
  the original Move 4 rescoped from "manifest as data" to "canonical-name set as data,
  normalization logic stays code." `planPathPrefix` (today colocated next to `supportsPlanMode` on
  `ProviderCapabilities`, set for Claude/Cursor, read at three sites) is the live precedent for
  optional config sitting flat — validating the flat-capability choice without nesting.

## Consequences

**Positive**

- "Add a provider" reduces to: extend `ProviderRegistration` + write a stream mapper, in the
  vendor's recommended protocol; reuse `core/transport/` helpers where they fit.
- Provider-native integrations are preserved (no transport homogenization).
- The boundary leak class is made structurally impossible (lint-enforced).
- Net new code is small: two transport helpers + one `RuntimeHost` type; no parallel registration
  struct, no nested-capability migration, no tool-manifest framework.

**Negative / risks**

- Move 3's `RuntimeHost` reworks how features wire approval/askUser/plan-mode callbacks (one
  site: `tabControllers.ts:471-528`, today **636 LOC** after the 2026-05-31 review's god-file
  split landed).
- Move 2 must be sequenced **after CON-3** (Codex transport-close watchdog) from
  `docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md`. **CON-1 (Cursor
  SIGTERM→SIGKILL escalation) and CON-2 (`shutdown()` hang protection) have already landed** —
  verifiable at `CursorChatRuntime.ts:237-244` and the AcpSubprocess/CodexAppServerProcess
  shutdown paths. The earlier "coordinate with ARCH-3/5/6" caveat is largely moot: ARCH-5's
  `Tab.ts` split has already landed (`Tab.ts` is now a 45-line barrel), and `tabControllers.ts`
  is the post-split owner of the `RuntimeHost` wiring.
- **Phase 3 collision risk:**
  `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 touches
  `CursorChatRuntime.query` listener ordering, ACP subprocess kill signal, and ACP transport
  pending-request cleanup + id wrap — exactly the code Phase 3 wants to extract into
  `core/transport/`. **Phase 3 must land *after* that PR2 or the extraction will repeatedly
  rebase-conflict with it.** Coordinate explicitly.
- Test mocks are `as any` partial runtimes, so **typecheck will not catch interface drift**. Add a
  typed `createMockRuntime()` helper as part of Move 3 — with an exhaustive TS structural drift
  guard so the helper stays in sync with `ChatRuntime` automatically (see [§ Test debt](#test-debt-and-perf)).

**Neutral**

- `Conversation.providerState` stays opaque and unchanged (the r1 revision dropped the
  `protocolVersion` write that would have violated that promise).

## Migration

Each phase is independently mergeable and leaves the plugin green
(`typecheck && lint && test && build`). The order below is the cheapest-value-first resequencing
recommended by the review.

1. **Phase 0 — Leak cleanup + boundary lint (Move 1).** No new struct, no behavior change, but
   does add two optional methods on existing interfaces (`setEnabled?`, `getAvailableModes?`) and
   carve out migration-backfill sites for `DEFAULT_CHAT_PROVIDER_ID`. Proves the seam holds.
   Size: **S → S+** (the migration carve-out and `SearchResultsView` splice add a small layer of
   review beyond pure indirection).
2. **Phase 1 — Extend `ProviderRegistration` + lift canonical tool-name set (Move 4).**
   Mechanical; no nested-capability migration; Cursor's normalization stays as logic. Size: **S–M**.
3. **Phase 2 — `RuntimeHost` + mark optional members optional (Move 3).** One wiring site
   (`tabControllers.ts:471-528` post-split); add the typed runtime mock with TS drift guard; add
   the cancel-dismiss invariant test for both Claude and Codex. ARCH-3/5/6 coordination is largely
   moot (those splits already landed). Size: **M**.
4. **Phase 3 — Extract `core/transport/` helpers; migrate Codex + Opencode onto the JSON-RPC
   client; all CLI providers onto the spawn helper (Move 2).** Land **after CON-3 (Codex
   transport-close watchdog) lands** *and* after
   `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 lands — those PRs
   touch the same files as the extraction. Add a `tests/perf/` target for `JsonRpcStdioClient`
   pending-request lookup. Size: **M–L**.

The previously-proposed "Claude-on-CLI" phase is **dropped** — it existed only to chase a
transport uniformity this ADR explicitly rejects. The previously-proposed nested-capability
descriptor, `protocolVersion`, and "tool manifest as data" are also dropped (see Revision history).

## Success test

> Adding a provider = extend `ProviderRegistration` + a stream mapper, in whatever protocol the
> vendor recommends, reusing shared subprocess/JSON-RPC helpers only if they fit — with no
> `providerId === 'x'` branch and no edit to a hardcoded provider list anywhere in `core/` or
> `features/`.

## Test debt and perf

The r2 review surfaced test gaps that the Negative bullet alone undersold. Each move ships with
the tests below; otherwise the seam can rot silently.

- **Boundary-rule synthetic-violation test.** A test (or ESLint-runner test) that creates a
  synthetic `features/x.ts` importing from `providers/claude/internals/...`, runs ESLint, and
  asserts the rule fires. Without it, a future glob refactor that breaks the rule (e.g. mis-scopes
  the `src/providers/index.ts` exemption) goes unnoticed.
- **`createMockRuntime` drift guard.** An exhaustive structural check using TS — e.g.
  `const _check: Record<keyof ChatRuntime, true> = { providerId: true, ... }` — fails compilation
  if a member is added to `ChatRuntime` and not to the helper. Works with optional members.
- **Settings round-trip for `setEnabled()`** (Phase 0). Integration test through
  `ProviderSettingsCoordinator`: toggle → persist → reload preserves the enable flag for all
  four providers. Replaces the existing `tests/unit/features/settings/providerEnableUpdaters.test.ts`
  (which tests the shim being deleted).
- **Mode-options accessor regression test** (Phase 0). Unit test for Opencode's new
  `getAvailableModes?` accessor asserts the returned modes match the read site at
  `registry/fields/opencode.ts:42-45`.
- **RuntimeHost cancel-dismiss invariant** (Phase 2). Test that `host.dismissApproval()` fires on
  cancel/reset for both Claude (today: `ClaudeChatRuntime.ts:1660`) and Codex (today:
  `CodexChatRuntime.ts:752`). Otherwise this load-bearing path can rot silently after the
  setter-to-host migration.
- **Capability-presence contract test** (Phase 2). At least one test asserting feature code does
  not invoke an optional method (`rewind?`, `steer?`, `fork?`) when the corresponding capability
  flag is false.
- **`JsonRpcStdioClient` pending-request lookup perf test** (Phase 3). New target under
  `tests/perf/` asserting per-dispatch lookup stays O(1) as concurrent pending requests grow. The
  existing perf suite covers history, rendering, navigation, and tool-call indexing but has zero
  transport coverage; an extraction without this gate is one regression away from a hidden
  scaling problem.

The seven existing test files most affected by Phase 0 (per the test-impact pass):
`providerEnableUpdaters.test.ts` (rewritten), `defaultProviderResolver.test.ts`,
`defaultModelResolver.test.ts`, `agentBoard.test.ts`, `general.test.ts`, `opencode.test.ts`,
`hasAnyProviderEnabled.test.ts`. Most edits are mechanical; only the providerEnableUpdaters and
opencode tests require non-trivial rework.

## Missing concerns (deferred but called out)

The r2 review flagged these as in-scope-but-not-addressed; they are deferred to the implementing
PR for each phase rather than designed in the ADR.

- **Persisted-settings migration during phase rollouts.** Phase 0's new `setEnabled?()` and
  `getAvailableModes?()` touch persisted settings shape only indirectly (no new keys), so no
  migration script is required — but the Phase 0 PR must explicitly state that, with a smoke
  test for the upgrade path.
- **Telemetry / observability.** Today the seven setters' implementations log through
  `plugin.logger.scope('runtime')` in the runtime classes. Phase 2 must preserve those log scopes
  inside `RuntimeHost` callbacks; otherwise approval/askUser lifecycle logs lose their breadcrumb.
- **Third-party plugin / external consumers of `ChatRuntime`.** `ChatRuntime` is exported from
  `src/core/runtime/`. No audit has confirmed whether external code depends on the seven-setter
  shape. The Phase 2 PR should grep `node_modules` and Obsidian community plugin metadata for
  consumers; if any exist, ship a thin compatibility shim until they migrate.

## Revision history

**2026-06-01 (r1) — revised after a four-pass design review.** Changes from the first version,
with rationale:

| Change | Why |
|--------|-----|
| Corrected figures: ~40→**38** members, "~40"→**≈12 files/≈30** gate sites, "54"→**42** `DEFAULT_CHAT_PROVIDER_ID`, "3"→**5+** hardcoded arrays | Claim-verification pass found these inflated/imprecise; the corrected counts still support the thesis. (The "seven setters" figure was **correct** — an interim "6" was a miscount that dropped `setApprovalDismisser`; restored to 7 and added to `RuntimeHost` after PR review.) |
| **Dropped `protocolVersion`** (was on the descriptor + stored in `providerState`) | Three reviewers independently flagged it as cargo-culting: nothing to negotiate in an in-process bundle, and it contradicted the "providerState unchanged" promise. |
| **Dropped the parallel `ProviderDescriptor`; extend `ProviderRegistration` instead; keep capabilities flat** | The descriptor duplicated the existing registration; nested capabilities would churn ~30 gate sites for no functional gain. |
| **Rescoped the tool manifest** from "data the UI reads" to "lift the name table; normalization stays code" | The `*ToolNormalization` modules are argument-shape-dependent logic, not static maps, and the UI consumes already-normalized chunks. |
| **Demoted the capability-mixin split** to marking optional members optional | The feature layer already capability-gates these calls at runtime; a mixin hierarchy is unjustified for 4 providers. |
| **Reordered phases** to value-first (leaks → registration → RuntimeHost → transport) and **renamed Move 1's beneficiaries** (spawn helper: all CLI; JSON-RPC client: Codex+Opencode only; Cursor: spawn-only) | The "optional helper nobody must use" framing risks a half-migrated abstraction; Cursor's NDJSON loop won't adopt the JSON-RPC client. |
| **Added cross-plan sequencing** vs `docs/reviews/2026-05-31` and a **CON-1/2/3 prerequisite** for the transport extraction; added the **typed `createMockRuntime()`** requirement and the **stale-ESLint-glob** cleanup | Migration-feasibility pass surfaced file collisions, buggy cancellation code that should be fixed before extraction, and mocks that hide interface drift. |
| **Softened external-pattern framing** (`doGenerate/doStream` altitude; "NDJSON lingua franca"; MCP prefix-on-merge as convention; cancellation cooperative-then-kill) | External-pattern fact-check found these accurate as facts but overstated as universal/spec-mandated. |

**2026-06-01 (r2) — revised after a six-perspective independent verification pass** (architect,
Phase-0 implementer, red-team skeptic, external-pattern fact-check, test/maintainability,
migration sequencer). The r1 direction held; r2 fixes residual factual issues, wrong line cites,
scope gaps, and missing concerns. Changes:

| Change | Why |
|--------|-----|
| **Members count: 38 → 31.** "Gate sites ≈12 files/≈30" → "3 capability-supports reads at the public boundary plus broader destructuring inside provider code." "5+ hardcoded arrays" → **7** (added `FirstRunBanner.ts:4-9` and `general.ts:96-101`). | Skeptic counted 31 distinct interface members; the "38" figure double-counted multi-line parameter lines. The ≈30 gate-site figure was inflated by ~10× — actual grep finds 3 public-boundary reads. |
| **Reframed P2 "CodexRpcTransport near-clone of AcpJsonRpcTransport"** — clarified that the *subprocess pair* (~80% identical, 154 vs 159 LOC) holds the claim; the *RPC pair* does not (ACP is 427 LOC, Codex is 171 LOC, materially different capabilities). | Skeptic showed the two RPC implementations are not near-clones. The duplication thesis stands on the subprocess pair. |
| **Fixed external-pattern facts**: ACP **does** version-negotiate per spec (we drop it as a design judgment, not a refutation of upstream); NDJSON lingua franca is ~**1** of 4 transports (not 2 — Claude uses the in-process SDK, not headless NDJSON); replaced "Claude-headless" with "Claude SDK"; noted Cline's `ApiHandler` is 4 members vs our 31 (shape analogy, not width). | External-pattern fact-check found these descriptive claims wrong against the upstream specs and Claudian's own usage. |
| **Migration carve-outs for Phase 0**: ~6 of 42 `DEFAULT_CHAT_PROVIDER_ID` sites are legacy-metadata backfill and must stay literal `'claude'` (or route through `ProviderRegistry.resolveSettingsProviderId`); `defaultProviderResolver.ts:4` uses `getEnabledProviderIds()` (not `getRegisteredProviderIds()`) because it carries preference order; `SearchResultsView.ts:40` interleaves non-provider tab ids and needs splicing, not replacement. Phase 0 size revised **S → S+**. | Phase-0 implementer pass discovered the blanket "first enabled by `blankTabOrder`" sweep would corrupt session migration and that two array sites are not pure provider lists. |
| **ESLint stale-glob cleanup expanded from 2 to 8 paths**; recommend deleting the whole `no-restricted-imports` block. **Boundary-rule exemption (3) rephrased** as "the aggregator(s) that call `ProviderRegistry.register` / `ProviderWorkspaceRegistry.register`" so `main.ts` is in scope after Phase 0. | Architect and implementer both verified all 8 globs match zero files; literal-pinning the exemption to `src/providers/index.ts` would permanently exempt `main.ts`. |
| **Corrected `dismissApproval` line cites** in Move 3 (setter definitions vs load-bearing call sites). **Renamed `RuntimeHost.subagentState` → `getSubagentState()`** to match today's `getState: () => SubagentRuntimeState` accessor pattern. Added an **error-surface contract** subsection. | Skeptic flagged the line cites pointed at setter definitions, not call sites; architect flagged the value/accessor mismatch. |
| **Per-provider scope for Move 4 "name table"**: Codex/Opencode lift as flat data; Cursor stays as logic (argument-shape resolution). The lifted artifact is the **canonical-name set** per provider (for UI enumeration), not a bidirectional table. Added `planPathPrefix` as the live precedent for flat optional config. | Architect/skeptic showed `cursorToolNormalization.resolveCursorToolKind` resolves by `'oldString' in args` vs `'content' in args` — pure logic. |
| **Migration phases rewritten**: CON-1 and CON-2 already landed (verified at `CursorChatRuntime.ts:237-244` and shutdown paths); ARCH-3/5/6 also already landed (`Tab.ts` is now a 45-line barrel; `tabControllers.ts:471-528` is post-split). The CON-1/2 prerequisite is removed; **only CON-3 remains a blocker**. ARCH-coordination caveat removed. | Migration-sequencer pass confirmed against `docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md` and the live tree. |
| **Added Phase 3 collision row** against `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 (touches `CursorChatRuntime.query`, ACP subprocess kill, ACP transport pending-request cleanup — exactly Phase 3's extraction target). | Migration-sequencer pass surfaced the unflagged file collision that would have blocked the extraction with repeated rebases. |
| **Added [§ Test debt and perf](#test-debt-and-perf)** (boundary-rule synthetic test, drift guard, settings round-trip, mode-options accessor, cancel-dismiss invariant, capability-presence contract, `JsonRpcStdioClient` perf target) and **[§ Missing concerns](#missing-concerns-deferred-but-called-out)** (settings migration, telemetry/log scopes, third-party consumers of `ChatRuntime`). | Test/maintainability pass found the single "createMockRuntime" Negative bullet undersold the gap; skeptic flagged the missing concerns. |
