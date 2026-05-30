---
status: proposed
parent: "[[Chat]]"
---
# Chat Tab Composition Design

Date: 2026-05-30
Status: proposed for user review
Source issue: [[docs/issues/Architecture Deepening Proposal.md]]
Stage: 1 of 6 (Chat tab composition)

## Summary

Deepen the Chat tab seam by replacing the 1,895-line free-function module `src/features/chat/tabs/Tab.ts` with four cohesive modules in a new `src/features/chat/tabs/composition/` directory. A `ChatTabComposition` class becomes the small public surface that hides provider draft policy, UI assembly, controller graph wiring, runtime creation, fork wiring, and auto-turn dispatch. Behavior is preserved; locality, testability, and provider onboarding improve.

This is stage 1 of the six-stage Architecture Deepening Proposal. Subsequent stages (stream projection, conversation store, contract split, auxiliary query reuse, settings load normalization) are tracked in separate specs.

## Goals

- Replace `Tab.ts` with a `ChatTabComposition` class whose public surface is `create`, `initialize`, `reinitialize`, `destroy`, `getTabData`, `getRuntime`, `setForkContext`, `triggerAutoTurn`.
- Co-locate provider/model resolution rules in a pure `ProviderDraftPolicy` module that can be unit-tested without DOM or Obsidian.
- Move DOM construction behind `TabUIAssembly` returning a `TabUIBundle` that owns its own teardown.
- Move controller wiring behind `TabControllerGraph` returning a `ControllerBundle` that owns subscription disposal.
- Land in a single PR with new tests added before old code is deleted.
- Preserve all current visible chat behavior, provider switching rules, fork handling, and auto-turn semantics.

## Non-goals

- Touching `StreamController` internals (stage 2).
- Touching `ConversationController` persistence or `main.ts` conversation ownership (stage 3).
- Splitting `core/providers/types.ts` (stage 5).
- Reusing query-backed auxiliary modules for Claude/Cursor (stage 4).
- Provider settings load normalization (stage 6).
- Aggressive shrinking of `TabManager.ts` beyond what the new modules naturally absorb (fork wiring and auto-turn move; command cache and warmup stay in TabManager).
- Any user-visible behavior change.

## Decisions

| Question | Decision |
|----------|----------|
| Stage to brainstorm now | Stage 1: Chat tab composition |
| PR scope | Single PR for stage 1; all four sub-modules + caller updates + Tab.ts deletion |
| Decomposition | Four sub-modules per PRD: `ChatTabComposition`, `ProviderDraftPolicy`, `TabUIAssembly`, `TabControllerGraph` |
| Test strategy | Unit tests per new module + existing TabManager/ClaudianView integration tests as regression guard |
| Module shape | `ChatTabComposition` is a class with small public surface; UI/controller modules return bundles with own teardown; draft policy is pure functions |
| TabManager scope | Fork wiring + auto-turn move into composition; provider command cache + warmup stay |
| Compat shims | None survive past final commit in the same PR (per PRD Decision 2) |
| Bundle `reset()` for `reinitialize()` | Defer; ship with `destroy()` only. Add `reset()` if profiling shows DOM thrash on provider switch |
| Callbacks shape | Bundle into single `TabCompositionCallbacks` interface |
| Directory layout | New `composition/` subdirectory under `tabs/` (5 files justify it) |
| `getBlankTabModelOptions` location | Stays in `ProviderDraftPolicy` (settings tab imports from there) |
| Bundle type co-location | Bundle types co-located with the module that returns them; `composition/types.ts` only for cross-module types |

## Architecture

### Module layout

New directory: `src/features/chat/tabs/composition/`

| File | Owns | Public surface |
|------|------|----------------|
| `ChatTabComposition.ts` | Tab record, runtime creation/teardown, fork wiring, auto-turn, lifecycle sequencing | `class ChatTabComposition` |
| `ProviderDraftPolicy.ts` | Provider/model resolution rules for blank vs bound tabs | Pure functions: `resolveBlankTabModel`, `resolveBlankTabDefaultProviderId`, `resolveBoundTabProvider`, `getBlankTabModelOptions` |
| `TabUIAssembly.ts` | DOM construction (toolbar, file/image context, status panel, navigation sidebar, bang-bash, instruction managers) | `assembleTabUI(deps) => TabUIBundle` |
| `TabControllerGraph.ts` | Deterministic controller wiring | `buildControllerGraph(deps) => ControllerBundle` |
| `types.ts` | Cross-module types: `CompositionDeps`, `TabCompositionCallbacks` | Types only |

Files deleted in the same PR:

- `src/features/chat/tabs/Tab.ts` (all 1,895 lines absorbed)
- `src/features/chat/tabs/providerResolution.ts` (folded into `ProviderDraftPolicy`)

Files updated:

- `src/features/chat/tabs/TabManager.ts` — imports `ChatTabComposition` class instead of free functions from `Tab.ts`
- Any other call sites of `Tab.ts` exports (typecheck enforces this)

### ChatTabComposition

```ts
export class ChatTabComposition {
  constructor(deps: CompositionDeps);

  create(opts: CreateTabOptions): TabData;
  initialize(opts: InitializeTabOptions): Promise<void>;
  reinitialize(opts: ReinitializeTabOptions): Promise<void>;
  destroy(): Promise<void>;
  getTabData(): TabData;
  getRuntime(): ChatRuntime | null;

  setForkContext(ctx: ForkContext | null): void;
  triggerAutoTurn(request: AutoTurnRequest): Promise<AutoTurnResult>;
}

export type CompositionDeps = {
  plugin: ClaudianPlugin;
  viewHost: TabManagerViewHost;
  callbacks: TabCompositionCallbacks;
};

export type TabCompositionCallbacks = {
  onTitleChange(tabId: TabId, title: string): void;
  onActiveChange(tabId: TabId, active: boolean): void;
  onConversationChange(tabId: TabId, conversationId: string | null): void;
  // Remaining callback names are discovered during step-5 extraction by
  // enumerating every callback parameter currently passed into Tab.ts free
  // functions (createTab, initializeTabControllers, setupServiceCallbacks,
  // wireTabInputEvents). Each becomes a named field here. No callback stays
  // as a positional argument on ChatTabComposition methods.
};
```

### ProviderDraftPolicy

```ts
export function resolveBlankTabModel(
  plugin: ClaudianPlugin,
  providerId?: ProviderId,
): string;

export function resolveBlankTabDefaultProviderId(
  settings: Record<string, unknown>,
): ProviderId;

export function resolveBoundTabProvider(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): ProviderId;

export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ProviderUIOption[];
```

Pure functions. No DOM, no Obsidian, no async. Trivial to unit-test against fake `ClaudianPlugin`/settings objects.

### TabUIAssembly

```ts
export type TabUIDeps = {
  host: HTMLElement;
  plugin: ClaudianPlugin;
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  uiConfig: ProviderChatUIConfig;
};

export type TabUIBundle = {
  dom: TabDOMElements;
  toolbar: InputToolbar;
  fileContext: FileContextManager;
  imageContext: ImageContextManager;
  statusPanel: StatusPanel;
  navigationSidebar: NavigationSidebar;
  bangBashMode: BangBashModeManager;
  instructionMode: InstructionModeManager;
  destroy(): void;
};

export function assembleTabUI(deps: TabUIDeps): TabUIBundle;
```

Bundle never exposes mutable internals beyond the listed members. `destroy()` is idempotent and unmounts DOM + detaches listeners.

### TabControllerGraph

```ts
export type ControllerGraphDeps = {
  plugin: ClaudianPlugin;
  tabUI: TabUIBundle;
  runtime: ChatRuntime;
  chatState: ChatState;
  subagentManager: SubagentManager;
  // Additional deps are enumerated during step-4 extraction by reading every
  // parameter currently passed to initializeTabControllers + setupServiceCallbacks
  // + wireTabInputEvents in Tab.ts. The list is fixed at extraction time; no
  // dep is added speculatively.
};

export type ControllerBundle = {
  conversation: ConversationController;
  stream: StreamController;
  input: InputController;
  selection: SelectionController;
  browser: BrowserSelectionController;
  canvas: CanvasSelectionController;
  navigation: NavigationController;
  dispose(): void;
};

export function buildControllerGraph(deps: ControllerGraphDeps): ControllerBundle;
```

`dispose()` cancels active streams, unsubscribes ChatState listeners, and disposes per-controller resources. Order is encoded in the implementation and asserted in tests.

### Lifecycle flow

**`create(opts)`** — synchronous, cheap, no runtime:

1. If no `draftModel`, call `resolveBlankTabDefaultProviderId(settings)` for `providerId`.
2. `resolveBlankTabModel(plugin, providerId)` for `model`.
3. `generateTabId()` and build empty `TabData`.
4. Return `TabData` (tab stays "blank").

**`initialize(opts)`** — full assembly, async:

1. Determine `providerId` via `resolveBoundTabProvider()` or stored conversation provider.
2. Build `TabProviderContext`; resolve capabilities + UI config from `ProviderRegistry`.
3. `assembleTabUI(host, deps)` → `tabUI` (DOM mounted).
4. `ProviderRegistry.createRuntime(...)` → `runtime`.
5. If `conversationId` set, hydrate history through provider history service.
6. `buildControllerGraph({tabUI, runtime, ...})` → `controllers`.
7. Wire service callbacks (subset of current `setupServiceCallbacks` that crosses module boundaries; rest lives inside controller graph).
8. Wire input events (current `wireTabInputEvents` behavior).
9. Stash bundles on private fields.

**`reinitialize(opts)`** — provider switch on unbound tab, or resume on bound tab:

1. `await destroy()` of old runtime + controllers + UI.
2. `initialize(opts)` with new providerId.

**`destroy()`** — tab close:

1. `controllers.dispose()` (cancels streams, unsubscribes events).
2. `await runtime?.dispose()` (provider-owned teardown).
3. `tabUI.destroy()` (unmounts DOM, clears refs).
4. Clear private fields.

**Cleanup ordering invariant:** controllers → runtime → UI. Stream cancellation must precede runtime shutdown to avoid orphaned events. UI last so error messages can render during teardown.

**Fork wiring:** `setForkContext()` stores fork target on root; `initialize()` reads it and passes to runtime creation via provider history seam. No direct fork logic lives in UI assembly or controller graph.

**Auto-turn:** `triggerAutoTurn()` invokes `controllers.input.dispatchAutoTurn()` and streams through `controllers.stream`. Hidden behind composition root so work-order execution reuses it without touching tab guts.

## Migration plan (single PR)

| # | Step | Verification |
|---|------|--------------|
| 1 | Create `composition/` dir, empty files, `types.ts` skeleton | `npm run typecheck` |
| 2 | Lift `providerResolution.ts` + blank-tab helpers from `Tab.ts` → `ProviderDraftPolicy.ts`. Add unit tests. Old call sites import via re-export shim. | Unit tests green |
| 3 | Extract DOM building from `Tab.ts`'s `initializeTabUI` → `TabUIAssembly.ts` returning `TabUIBundle`. Add unit tests. `Tab.ts` `initializeTabUI` delegates. | Tests green; integration tests green |
| 4 | Extract controller wiring from `Tab.ts`'s `initializeTabControllers` + `setupServiceCallbacks` + `wireTabInputEvents` → `TabControllerGraph.ts` returning `ControllerBundle`. Add unit tests. `Tab.ts` functions delegate. | Tests green; integration tests green |
| 5 | Build `ChatTabComposition.ts` class wrapping new modules. Move runtime creation, fork wiring, auto-turn into it. Add unit tests. | Tests green; class exists but no caller yet |
| 6 | Switch `TabManager.ts` to use `ChatTabComposition` instead of `Tab.ts` free functions. | Existing TabManager integration tests green |
| 7 | Delete `Tab.ts`, `providerResolution.ts`, all re-export shims. | Build green; no orphan imports |
| 8 | Run full check: `npm run typecheck && npm run lint && npm run test && npm run build` | All green |

No compatibility shims survive past step 7.

## Test plan

New unit tests under `tests/unit/features/chat/tabs/composition/`:

### `ProviderDraftPolicy.test.ts` — pure, no mocks
- `resolveBlankTabDefaultProviderId` returns active settings provider when enabled
- Falls back to first enabled provider when active provider disabled
- `resolveBlankTabModel` returns provider-specific model snapshot, not `settings.model`
- `resolveBoundTabProvider` honors `conversation.providerId` over draft
- `getBlankTabModelOptions` flatMaps across enabled providers with group + icon

### `TabUIAssembly.test.ts` — JSDOM, fake `ClaudianPlugin`
- `assembleTabUI` mounts toolbar, file context, image context, status panel, navigation sidebar
- `destroy()` removes all child nodes and detaches listeners (assert listener count delta returns to zero)
- Idempotent destroy: second call is a no-op

### `TabControllerGraph.test.ts` — fake runtime + fake UI bundle
- `buildControllerGraph` returns all seven controllers wired
- Controllers receive expected deps (assert dep object equality)
- `dispose()` cancels active streams and unsubscribes ChatState listeners
- Disposal order: stream cancellation precedes ConversationController cleanup

### `ChatTabComposition.test.ts` — fake plugin + viewHost + provider registry
- `create()` returns TabData without runtime
- `initialize()` mounts UI, creates runtime, builds controllers, in that order
- `reinitialize()` disposes old runtime/controllers/UI before creating new
- `destroy()` calls dispose in order: controllers → runtime → UI
- Cleanup count: each subscription registered in `initialize` is disposed exactly once
- `setForkContext()` + `initialize()` passes fork target through runtime creation
- `triggerAutoTurn()` dispatches via InputController and streams via StreamController
- Provider switch on bound tab is rejected (preserves existing invariant)

### Existing tests (migrate or keep as regression guard)
- `tests/unit/features/chat/tabs/Tab.test.ts` — current Tab.ts coverage. Migrate relevant cases into the four new test files; delete the file in step 7 alongside `Tab.ts`.
- `tests/unit/features/chat/tabs/TabManager.test.ts` — exercises full tab lifecycle through TabManager. Keep unchanged as regression guard.
- `tests/unit/features/chat/ClaudianView.test.ts` — view-level mount/unmount. Keep unchanged as regression guard.

Coverage target: new composition modules ≥85% line coverage; cleanup paths 100%.

Iteration command: `npm run test -- --selectProjects unit -t "composition"`.

## Risks

| Risk | Mitigation |
|------|-----------|
| DOM tree diverges from current `Tab.ts` output → visible regression | Step-3 UI assembly tests assert DOM structure against snapshot of current `Tab.ts` behavior captured pre-refactor |
| Controller subscription leak → memory growth across tab open/close | `ControllerBundle` dispose tests assert subscription count returns to baseline |
| Cleanup order regression → orphaned stream events after tab close | Composition root dispose order encoded in test; integration test opens/closes 10 tabs and asserts no console warnings |
| `TabManager`'s `ProviderCommandCacheEntry` warmup still calls deleted `Tab.ts` helpers | Step 6 search-and-replace; typecheck catches remaining call sites |
| Fork wiring on bound tab loses fork context across `reinitialize` | Composition test: `setForkContext` → `reinitialize` → assert fork context preserved |
| Auto-turn dispatch race during stream-in-flight | Composition test: trigger auto-turn while stream active asserts queueing through `QueuedTurn` |
| Bundle pattern leaks mutable state and erodes the seam | Code review checklist item; bundle types expose only methods/data the composition root needs |

## Out of scope (deferred to later stages)

- Stream projection split (`StreamController` 1,601 lines) — stage 2 spec
- Conversation store extraction (`main.ts` 1,094 lines) — stage 3 spec
- Auxiliary query reuse for Claude/Cursor — stage 4 spec
- Provider contract split (`core/providers/types.ts` 550 lines) — stage 5 spec
- Provider settings load normalization (Opencode plan-mode cleanup) — stage 6 spec

## Success criteria

- `Tab.ts` and `providerResolution.ts` are deleted.
- `ChatTabComposition` class is the only public composition seam used by `TabManager`.
- Each new module has unit tests at its small interface; integration tests for tab lifecycle still pass unchanged.
- Provider switching, model selection, streaming, subagents, fork, auto-turn, and inline edit behave exactly as before.
- Adding a future provider capability (e.g., new draft policy rule, new controller) requires editing one of the four new modules, not a 1,895-line file.
- `npm run typecheck && npm run lint && npm run test && npm run build` all green.

## References

- Source PRD: [[docs/issues/Architecture Deepening Proposal.md]]
- Feature CLAUDE.md: [[src/features/chat/CLAUDE.md]]
- Project CLAUDE.md: [[CLAUDE.md]]
- Related stage specs (to be written): stream projection, conversation store, contract split, auxiliary query reuse, settings load normalization
