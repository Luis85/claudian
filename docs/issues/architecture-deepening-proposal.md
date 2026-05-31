---
type: prd
id: issue-20260530-architecture-deepening-proposal
title: Architecture Deepening Proposal — Chat tab composition, stream projection, conversation store, provider contracts, and auxiliary query reuse
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-05-30
updated: 2026-05-30
owner: Claudian
source: "Architecture review 2026-05-30"
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
  - "[[Chat]]"
  - "[[Infrastructure]]"
---

# Architecture Deepening Proposal — Chat tab composition, stream projection, conversation store, provider contracts, and auxiliary query reuse

## Problem Statement

Claudian is now a multi-provider product with Claude, Codex, Opencode, and Cursor sharing the same **Conversation** model through `providerId` and opaque `providerState`. The documented architecture is sound: chat features should depend on provider-neutral **Runtime** and provider workspace seams, while provider adaptors own prompt encoding, stream transforms, settings reconciliation, history hydration, CLI resolution, MCP integration, command catalogs, **Skills**, **Subagents**, and provider settings UI.

The codebase has grown faster than several seams have deepened. The result is not a single broken invariant; it is architectural friction that will compound as provider parity improves:

- The Chat tab module has become a broad composition point where provider selection, **Runtime** lifecycle, UI wiring, controller wiring, fork handling, and auto-turn rendering meet.
- The stream controller combines provider-neutral stream projection with DOM rendering, tool rendering, **Subagent** lifecycle, usage filtering, and vault file-change side effects.
- The plugin shell owns too much **Conversation** and **Session** behavior, including metadata mapping, provider **Transcript** hydration, deletion, preview/title logic, and view repair.
- Provider contracts are concentrated in one broad type module, so callers import a larger **Interface** than they need.
- Shared auxiliary query modules exist, but Claude and Cursor still duplicate title generation, instruction refinement, inline edit continuation, cancellation, parsing, and callback-safety logic.
- Provider-owned settings normalization leaks into the app shell for Opencode plan-mode cleanup.

This PRD proposes a staged architecture deepening effort. The goal is not cosmetic file splitting. The goal is to create deeper modules whose small interfaces hide more behavior, improving **locality**, **leverage**, testability, and provider onboarding.

## Solution

Deepen the architecture around six candidate modules, ordered by expected leverage:

1. **Chat tab composition module** — one small interface for creating, initializing, and destroying a Chat tab while hiding provider draft policy, UI construction, controller graph setup, fork wiring, and auto-turn hooks.
2. **Stream projection module** — a provider-neutral module that turns `StreamChunk` sequences into message-state operations, with DOM rendering, file effects, usage updates, and provider **Subagent** lifecycle handled through narrower adapters.
3. **Conversation store module** — a dedicated module for listing, creating, loading, hydrating, updating, deleting, and previewing **Conversations** and **Sessions**, leaving the plugin shell as an Obsidian lifecycle adapter.
4. **Provider contract split** — separate provider chat, workspace, history, auxiliary, and task contracts so each caller imports the seam it actually uses.
5. **Auxiliary query reuse** — fold Claude and Cursor title/refine/inline-edit services onto the existing query-backed auxiliary modules by adding provider-specific query runners and model mapping adapters.
6. **Provider settings load normalization** — move Opencode-specific plan-mode cleanup from the app shell into provider-owned settings reconciliation.

The implementation should be incremental. Each stage should preserve current behavior and be testable through the new deeper interface before the old shallow wiring is removed.

## User Stories

1. As a maintainer, I want Chat tab creation behind one small module interface, so that adding a provider capability does not require editing a 1,800-line tab file.
2. As a maintainer, I want provider draft model resolution localized, so that model-picker behavior can change without touching controller wiring.
3. As a maintainer, I want Chat tab UI construction separated from **Runtime** creation, so that UI regressions and provider lifecycle bugs are tested independently.
4. As a maintainer, I want controller graph setup in a deep module, so that the ordering constraints between controllers are visible and testable.
5. As a maintainer, I want fork wiring isolated behind the Chat tab composition interface, so that provider-specific fork rules do not leak across unrelated tab setup code.
6. As a maintainer, I want auto-triggered turn rendering isolated from tab construction, so that **Work order** execution can reuse the same rendering behavior without coupling to all tab initialization details.
7. As a maintainer, I want stream projection tested without DOM, so that stream correctness can be verified with simple chunk sequences.
8. As a maintainer, I want provider stream chunks normalized into message-state operations, so that DOM rendering is not the primary test surface for provider behavior.
9. As a maintainer, I want thinking/text/tool transitions represented as projection state, so that bugs in block finalization are fixed in one place.
10. As a maintainer, I want **Subagent** lifecycle stream events behind an adapter seam, so that Claude, Codex, Opencode, and Cursor differences do not spread through generic stream handling.
11. As a maintainer, I want usage updates filtered by the projection layer, so that cumulative provider usage and active-session usage do not intermix in render logic.
12. As a maintainer, I want file-change effects emitted as explicit operations, so that stream tests do not need an Obsidian vault.
13. As a maintainer, I want pending text/thinking render scheduling to be an implementation detail of a DOM adapter, so that projection tests are deterministic.
14. As a maintainer, I want a **Conversation** store interface, so that metadata persistence, provider **Transcript** hydration, and preview logic have one owner.
15. As a maintainer, I want **Conversation.providerState** to stay opaque outside provider history helpers, so that provider-owned state does not leak into chat feature code.
16. As a maintainer, I want **Session** metadata mapping tested through the store interface, so that provider-specific persisted state behavior is verified once.
17. As a maintainer, I want deletion to coordinate **Session** metadata, provider-native **Transcript** cleanup, and open-tab repair through one module, so that conversation deletion remains safe.
18. As a maintainer, I want title preview and title generation status owned by the store, so that UI code does not duplicate conversation summary rules.
19. As a maintainer, I want provider contracts split by seam, so that changes to MCP workspace services do not force chat runtime callers to import unrelated types.
20. As a provider adaptor author, I want a small provider chat contract, so that onboarding a new provider starts with the minimum **Runtime**, capability, history, and auxiliary requirements.
21. As a provider adaptor author, I want workspace service contracts separate from chat contracts, so that settings tabs, CLI resolution, command catalogs, and agent mention providers can evolve independently.
22. As a provider adaptor author, I want auxiliary services backed by a shared query module, so that title generation, instruction refinement, and inline edit have consistent continuation and cancellation semantics.
23. As a provider adaptor author, I want Claude auxiliary behavior expressed as a query runner adapter, so that Claude keeps provider-specific cold-start details while sharing common auxiliary behavior.
24. As a provider adaptor author, I want Cursor auxiliary behavior expressed as a query runner adapter, so that Cursor does not duplicate parsing and callback-safety behavior.
25. As a provider adaptor author, I want provider settings load normalization owned by provider settings code, so that the app shell does not import provider-specific mode constants.
26. As a reviewer, I want each deepening stage to include focused tests at the new interface, so that behavior preservation is obvious from the diff.
27. As a reviewer, I want old shallow functions deleted only after equivalent tests exist at the new seam, so that refactors do not hide behavior changes.
28. As a user, I want provider switching, model selection, streaming, **Subagents**, **Sessions**, and inline edit to behave exactly as before, so that architecture work does not regress product behavior.
29. As a user, I want future provider improvements to arrive with fewer regressions, so that multi-provider support feels coherent rather than provider-by-provider.
30. As an agent working in the codebase, I want modules with smaller interfaces and stronger locality, so that code navigation and automated changes are safer.

## Implementation Decisions

### Decision 1 — Start with Chat tab composition

The first implementation stage should deepen the Chat tab composition module. It has the highest leverage because the Chat tab sits at the seam between provider selection, **Runtime** lifecycle, user input, rendering, navigation, fork behavior, model selection, and **Work order** execution.

Build or modify these modules conceptually:

- A Chat tab composition module that owns tab creation, initialization, and teardown.
- A provider draft policy module that resolves provider/model defaults for blank and bound tabs.
- A UI assembly module that creates toolbar, context managers, navigation sidebar, and status panel.
- A controller graph module that wires selection, browser/canvas context, stream, conversation, input, and navigation controllers in a deterministic order.

The Chat tab composition interface should be intentionally small. Callers should not need to know the ordering constraints between UI construction, **Runtime** creation, controller setup, and cleanup callbacks.

### Decision 2 — Preserve compatibility during extraction

Existing call sites should continue to work while the deeper modules are introduced. Temporary compatibility shims are acceptable during a staged refactor, but they should be deleted within the same stage once all call sites move to the new interface.

Do not preserve stale overloads indefinitely. If an overload exists only for old test or call-site compatibility, it should have a clear deletion point in the same PR or follow-up PR.

### Decision 3 — Stream projection should be provider-neutral

The stream projection module should accept provider-neutral stream chunks and return message-state operations. It should not own DOM elements, Obsidian vault mutation, or provider process state.

Provider-specific stream differences should enter before projection, through provider runtime normalization, or through a narrow **Subagent** lifecycle adapter. Projection owns the assistant-message invariants: block ordering, tool-call state, thinking/text finalization, compact boundaries, errors, notices, and usage semantics.

### Decision 4 — DOM rendering becomes an adapter

DOM rendering should consume projection output. It should own scheduling, animation frames, scroll behavior, and renderer-specific state. It should not decide core message semantics.

This preserves the existing visible behavior while making stream correctness testable without a browser-like environment.

### Decision 5 — ConversationStore owns live conversation state

The **Conversation** store should own the in-memory conversation list, **Session** metadata mapping, provider **Transcript** hydration, deletion coordination, conversation preview, title status persistence, and provider-state persistence handoff.

The plugin shell should delegate to the store and react to store events when open views need repair or refresh. The plugin shell remains responsible for Obsidian lifecycle, command registration, view registration, and settings tab registration.

### Decision 6 — Keep providerState opaque

Provider-specific state must remain behind provider-owned helpers. The **Conversation** store may pass `providerState` through provider history interfaces, but it should not inspect provider-specific fields.

### Decision 7 — Split provider contracts by seam

Provider contracts should be split into separate modules by interface surface:

- Provider chat registration and capabilities.
- Provider workspace services.
- Provider history and **Session** metadata helpers.
- Provider auxiliary services.
- Provider task and **Subagent** lifecycle adapters.

This is a module-depth change, not a behavior change. Each split should preserve public names where practical, while reducing import width for callers.

### Decision 8 — Reuse query-backed auxiliary modules across providers

The existing query-backed auxiliary modules should become the default implementation for title generation, instruction refinement, and inline edit wherever a provider can expose a simple auxiliary query runner.

Claude should provide a cold-start auxiliary query runner adapter. Cursor should use its existing auxiliary CLI runner through the shared modules. Provider-specific classes should shrink to runner construction, model resolution, and provider-specific tool/read-only configuration.

### Decision 9 — Provider settings normalization belongs to providers

Provider-specific settings cleanup must not require app-shell imports of provider-specific constants. The settings coordinator should provide a load-normalization hook that providers can implement.

Opencode selected-mode cleanup should move into Opencode settings code. The app shell should call provider settings normalization generically.

### Decision 10 — Do not introduce speculative seams

Apply the deletion test before creating a new seam. If deleting a proposed module would simply remove complexity, it is shallow and should not exist. If deleting it would spread complexity across several callers, it is earning its keep.

A seam is justified when behavior varies across adapters or when it hides meaningful behavior behind a small interface. One adapter is a hypothetical seam; two adapters make it real.

## Testing Decisions

### General test strategy

Tests should target module interfaces, not implementation details. A good test should assert external behavior at the seam:

- Given a sequence of inputs, the module returns the expected state, events, or operations.
- Given provider-specific settings/state, the module preserves provider-owned invariants without leaking provider internals.
- Given lifecycle events, cleanup and cancellation happen exactly once.

Avoid tests that assert private helper calls, constructor ordering, or exact internal file splits.

### Chat tab composition tests

Add tests that exercise:

- Blank tab creation with default provider/model resolution.
- Bound tab initialization with an existing **Conversation**.
- Switching provider/model on an unbound tab.
- Preventing provider switching on a bound **Session**.
- Cleanup of old **Runtime** and event subscriptions during reinitialization.
- Controller graph construction with expected public dependencies available.

Prior art exists in the current Chat tab unit tests and integration tests around tab creation, provider selection, and controller construction.

### Stream projection tests

Add tests that exercise:

- Text and thinking block finalization across chunk transitions.
- Tool-use and tool-result state transitions.
- Error and notice projection.
- Context compacted boundaries.
- Usage events from current vs stale sessions.
- Provider **Subagent** lifecycle projection through an adapter.
- Async **Subagent** result hydration and retry decisions as state operations, not DOM behavior.

These tests should run without Obsidian DOM where possible.

### Conversation store tests

Add tests that exercise:

- Loading metadata into **Conversations** with provider defaults.
- Creating a new **Conversation** and saving **Session** metadata.
- Updating a **Conversation** without mutating `providerId`.
- Hydrating provider **Transcript** data through the provider history interface.
- Deleting a **Conversation**, including provider history cleanup and metadata deletion.
- Persisting provider-owned state through `buildPersistedProviderState`.

Prior art exists in session storage tests, provider history tests, and main integration tests.

### Provider contract split tests

The contract split should be verified primarily by typecheck and existing tests. Add focused tests only when behavior moves with the contracts.

The main verification is that callers import narrower seams and behavior remains unchanged.

### Auxiliary query tests

Add tests that exercise the shared query-backed auxiliary modules with fake query runners:

- Title generation cancellation and callback safety.
- Instruction refinement continuation and progress updates.
- Inline edit read-only prompt behavior and continuation with context files.
- Provider-specific model override behavior where applicable.

Existing query-backed auxiliary tests should be extended if present; otherwise, add unit tests under core auxiliary coverage.

### Provider settings normalization tests

Add tests that exercise:

- Generic settings load normalization calls provider hooks.
- Opencode plan-mode selectedMode resets to safe mode on load.
- App shell no longer imports provider mode constants.

## Out of Scope

- Changing visible chat UI behavior.
- Adding new provider capabilities.
- Changing **Conversation**, **Session**, or provider **Transcript** storage formats except where required for behavior-preserving extraction.
- Rewriting provider runtimes.
- Replacing the existing provider registries wholesale.
- Introducing a public plugin API.
- Moving docs or user manuals outside `docs/issues`.
- Re-litigating the multi-provider architecture documented in `CLAUDE.md`.

## Further Notes

### Architecture review findings

The architecture review identified six concrete deepening candidates:

1. **Strong:** deepen Chat tab composition.
2. **Strong:** split stream projection from DOM rendering.
3. **Strong:** move **Conversation** persistence out of the plugin shell.
4. **Worth exploring:** adopt query-backed auxiliary modules for Claude and Cursor.
5. **Worth exploring:** split provider chat registration from workspace contracts.
6. **Worth exploring:** move provider-specific settings load rules behind provider adapters.

### Recommended implementation order

1. Chat tab composition.
2. Stream projection.
3. Conversation store.
4. Auxiliary query reuse.
5. Provider contract split.
6. Provider settings load normalization.

The order is chosen to reduce risk on the highest-change paths first. Chat tab composition and stream projection are the most active seams and should produce immediate locality gains. Conversation store extraction follows because it touches persistence and deletion behavior. Contract splitting and settings normalization can happen after the bigger behavior-preserving extractions establish better test coverage.

### Success criteria

The work is successful when:

- The largest shallow modules shrink because behavior moved behind deeper interfaces, not because code was mechanically scattered.
- New tests target the new interfaces.
- Provider-specific state remains opaque to feature code.
- The app shell no longer imports provider-specific constants for settings normalization.
- Adding a provider feature requires editing fewer unrelated modules.
- Existing chat, inline edit, **Subagent**, **Session**, **Transcript**, and provider settings behavior remains unchanged.
