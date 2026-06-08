---
type: prd
id: issue-20260530-architecture-deepening-proposal
title: Architecture Deepening Proposal — Chat tab composition, stream projection, conversation store, provider contracts, and auxiliary query reuse
status: done
priority: 1 - high
triage: shipped
created: 2026-05-30
updated: 2026-06-02
owner: Claudian
source: "Architecture review 2026-05-30; consolidated into docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md (PR #9); transport residuals tracked in docs/adr/0001-transport-agnostic-provider-seam.md"
scope: architecture-deepening
related:
  - "[[CLAUDE]]"
  - "[[CONTEXT]]"
tags:
  - architecture
  - refactor
  - provider-boundary
  - chat
  - stream
  - conversations
  - prd
relations:
  - "[[sidepanel-chat]]"
---

# Architecture Deepening Proposal — Chat tab composition, stream projection, conversation store, provider contracts, and auxiliary query reuse

> **Status note (2026-06-02): CLOSED.** All six deepening candidates landed via the consolidated
> 2026-05-31 plan: Chat tab composition (ARCH-5a, `Tab.ts` 1915 → 45-line barrel), Stream
> projection (ARCH-6, `controllers/StreamProjection.ts` extracted), Conversation store (ARCH-3,
> `core/conversations/ConversationStore.ts`), Auxiliary query reuse (ARCH-7, Claude & Cursor
> folded onto `QueryBacked*`, −450 LOC), Provider settings load normalization (ARCH-8, hook
> shipped). Provider contract split (Decision 7) was not adopted as written — ADR-0001 r2
> instead decided to extend `ProviderRegistration` and keep capabilities flat. Remaining
> transport-layer deepening (extract `core/transport/`, narrow `ChatRuntime` via `RuntimeHost`,
> lift tool-name set) is tracked in `docs/adr/0001-transport-agnostic-provider-seam.md`
> Phases 1–3 and gated on CON-3 (Codex transport readline-close watchdog).
>
> Verification: see "Implementation status" section of
> `docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md` and the 2026-06-02 follow-up
> review `docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md`.

## Problem Statement

Claudian is now a multi-provider product with Claude, Codex, Opencode, and Cursor sharing the same **Conversation** model through `providerId` and opaque `providerState`. The documented architecture is sound: chat features should depend on provider-neutral **Runtime** and provider workspace seams, while provider adaptors own prompt encoding, stream transforms, settings reconciliation, history hydration, CLI resolution, MCP integration, command catalogs, **Skills**, **Subagents**, and provider settings UI.

The codebase has grown faster than several seams have deepened. The result is not a single broken invariant; it is architectural friction that will compound as provider parity improves:

- The Chat tab module has become a broad composition point where provider selection, **Runtime** lifecycle, UI wiring, controller wiring, fork handling, and auto-turn rendering meet.
- The stream controller combines provider-neutral stream projection with DOM rendering, tool rendering, **Subagent** lifecycle, usage filtering, and vault file-change side effects.
- The plugin shell owns too much **Conversation** and **Session** behavior, including metadata mapping, provider **Transcript** hydration, deletion, preview/title logic, and view repair.
- Provider contracts are concentrated in one broad type module, so callers import a larger **Interface** than they need.
- Shared auxiliary query modules exist, but Claude and Cursor still duplicate title generation, instruction refinement, inline edit continuation, cancellation, parsing, and callback-safety logic.
- Provider-owned settings normalization leaks into the app shell.

This PRD proposes a staged architecture deepening effort. The goal is not cosmetic file splitting. The goal is to create deeper modules whose small interfaces hide more behavior, improving **locality**, **leverage**, testability, and provider onboarding.

## Solution

Deepen the architecture around six candidate modules, ordered by expected leverage:

1. **Chat tab composition module** — one small interface for creating, initializing, and destroying a Chat tab while hiding provider draft policy, UI construction, controller graph setup, fork wiring, and auto-turn hooks.
2. **Stream projection module** — a provider-neutral module that turns `StreamChunk` sequences into message-state operations, with DOM rendering, file effects, usage updates, and provider **Subagent** lifecycle handled through narrower adapters.
3. **Conversation store module** — a dedicated module for listing, creating, loading, hydrating, updating, deleting, and previewing **Conversations** and **Sessions**, leaving the plugin shell as an Obsidian lifecycle adapter.
4. **Provider contract split** — separate provider chat, workspace, history, auxiliary, and task contracts so each caller imports the seam it actually uses.
5. **Auxiliary query reuse** — fold Claude and Cursor title/refine/inline-edit services onto the existing query-backed auxiliary modules by adding provider-specific query runners and model mapping adapters.
6. **Provider settings load normalization** — move provider-specific settings cleanup from the app shell into provider-owned settings reconciliation.

The implementation should be incremental. Each stage should preserve current behavior and be testable through the new deeper interface before the old shallow wiring is removed.

## Implementation Decisions

### Decision 1 — Start with Chat tab composition

The first implementation stage should deepen the Chat tab composition module. It has the highest leverage because the Chat tab sits at the seam between provider selection, **Runtime** lifecycle, user input, rendering, navigation, fork behavior, model selection, and **Work order** execution.

Conceptual modules:

- A Chat tab composition module that owns tab creation, initialization, and teardown.
- A provider draft policy module that resolves provider/model defaults for blank and bound tabs.
- A UI assembly module that creates toolbar, context managers, navigation sidebar, and status panel.
- A controller graph module that wires selection, browser/canvas context, stream, conversation, input, and navigation controllers in a deterministic order.

The Chat tab composition interface should be intentionally small. Callers should not need to know the ordering constraints between UI construction, **Runtime** creation, controller setup, and cleanup callbacks.

### Decision 2 — Preserve compatibility during extraction

Existing call sites should continue to work while the deeper modules are introduced. Temporary compatibility shims are acceptable during a staged refactor, but they should be deleted within the same stage once all call sites move to the new interface. Do not preserve stale overloads indefinitely.

### Decision 3 — Stream projection should be provider-neutral

The stream projection module should accept provider-neutral stream chunks and return message-state operations. It should not own DOM elements, Obsidian vault mutation, or provider process state. Provider-specific stream differences should enter before projection, through provider runtime normalization, or through a narrow **Subagent** lifecycle adapter. Projection owns the assistant-message invariants: block ordering, tool-call state, thinking/text finalization, compact boundaries, errors, notices, and usage semantics.

### Decision 4 — DOM rendering becomes an adapter

DOM rendering should consume projection output. It should own scheduling, animation frames, scroll behavior, and renderer-specific state. It should not decide core message semantics. This preserves visible behavior while making stream correctness testable without a browser-like environment.

### Decision 5 — ConversationStore owns live conversation state

The **Conversation** store should own the in-memory conversation list, **Session** metadata mapping, provider **Transcript** hydration, deletion coordination, conversation preview, title status persistence, and provider-state persistence handoff. The plugin shell should delegate to the store and react to store events when open views need repair or refresh. The plugin shell remains responsible for Obsidian lifecycle, command registration, view registration, and settings tab registration.

### Decision 6 — Keep providerState opaque

Provider-specific state must remain behind provider-owned helpers. The **Conversation** store may pass `providerState` through provider history interfaces, but it should not inspect provider-specific fields.

### Decision 7 — Split provider contracts by seam

Provider contracts should be split into separate modules by interface surface: provider chat registration and capabilities; provider workspace services; provider history and **Session** metadata helpers; provider auxiliary services; provider task and **Subagent** lifecycle adapters. This is a module-depth change, not a behavior change. Each split should preserve public names where practical, while reducing import width for callers.

### Decision 8 — Reuse query-backed auxiliary modules across providers

The existing query-backed auxiliary modules should become the default implementation for title generation, instruction refinement, and inline edit wherever a provider can expose a simple auxiliary query runner. Claude should provide a cold-start auxiliary query runner adapter. Cursor should use its existing auxiliary CLI runner through the shared modules. Provider-specific classes should shrink to runner construction, model resolution, and provider-specific tool/read-only configuration.

### Decision 9 — Provider settings normalization belongs to providers

Provider-specific settings cleanup must not require app-shell imports of provider-specific constants. The settings coordinator should provide a load-normalization hook that providers can implement. The app shell should call provider settings normalization generically.

### Decision 10 — Do not introduce speculative seams

Apply the deletion test before creating a new seam. If deleting a proposed module would simply remove complexity, it is shallow and should not exist. If deleting it would spread complexity across several callers, it is earning its keep. One adapter is a hypothetical seam; two adapters make it real.

## Testing Decisions

Tests should target module interfaces, not implementation details. Assert external behavior at the seam: given inputs, the module returns the expected state/events/operations; given provider-specific settings/state, it preserves provider-owned invariants without leaking internals; given lifecycle events, cleanup and cancellation happen exactly once. Avoid asserting private helper calls, constructor ordering, or exact internal file splits.

- **Chat tab composition:** blank vs bound tab creation, provider/model switching on unbound tabs, preventing provider switching on a bound **Session**, runtime/subscription cleanup on reinit, controller graph construction.
- **Stream projection (no DOM):** text/thinking finalization across chunk transitions, tool-use/result transitions, error/notice projection, compact boundaries, usage from current vs stale sessions, **Subagent** lifecycle and async result hydration as state operations.
- **Conversation store:** load metadata with provider defaults, create + save **Session** metadata, update without mutating `providerId`, hydrate **Transcript** through provider history, delete (history cleanup + metadata), persist provider state via `buildPersistedProviderState`.
- **Provider contract split:** verified primarily by typecheck + existing tests; add focused tests only when behavior moves with the contracts.
- **Auxiliary query:** title generation cancellation/callback safety, instruction refinement continuation/progress, inline edit read-only and context-file continuation, provider model override.
- **Provider settings normalization:** generic load normalization calls provider hooks; provider mode cleanup resets to safe mode on load; app shell no longer imports provider mode constants.

## Out of Scope

- Changing visible chat UI behavior.
- Adding new provider capabilities.
- Changing **Conversation**/**Session**/**Transcript** storage formats except where required for behavior-preserving extraction.
- Rewriting provider runtimes; replacing the registries wholesale; introducing a public plugin API.
- Re-litigating the multi-provider architecture documented in `CLAUDE.md`.

## Recommended implementation order

1. Chat tab composition.
2. Stream projection.
3. Conversation store.
4. Auxiliary query reuse.
5. Provider contract split.
6. Provider settings load normalization.

The order reduces risk on the highest-change paths first. Chat tab composition and stream projection are the most active seams and produce immediate locality gains. Conversation store extraction follows because it touches persistence and deletion. Contract splitting and settings normalization come after the bigger behavior-preserving extractions establish better test coverage.

## Success criteria

- The largest shallow modules shrink because behavior moved behind deeper interfaces, not because code was mechanically scattered.
- New tests target the new interfaces.
- Provider-specific state remains opaque to feature code.
- The app shell no longer imports provider-specific constants for settings normalization.
- Adding a provider feature requires editing fewer unrelated modules.
- Existing chat, inline edit, **Subagent**, **Session**, **Transcript**, and provider settings behavior remains unchanged.
