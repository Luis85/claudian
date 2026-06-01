# main.ts refactor — design

**Status**: draft
**Date**: 2026-06-01
**Author**: Claudian + Luis

## Problem

`src/main.ts` is 1059 lines. `ClaudianPlugin.onload()` alone is ~400 lines and mixes
provider bootstrap, view registration, command registration, menu wiring, inline
edit, tab orchestration, ribbon icons, and settings tab install. The rest of the
class mixes lifecycle teardown, view activation, tab orchestration, settings
load/normalize, environment-apply choreography, conversation-store passthroughs,
and view accessors. Hard to navigate, hard to test, hard to extend.

## Goals

1. Shrink `onload()` to a clear bootstrap skeleton.
2. Pull testable logic (env apply, view activation rules, lifecycle teardown)
   out of the Plugin shell into focused, unit-testable services.
3. Clarify responsibilities. Each extracted module owns one concern with a
   stated contract.

## Non-goals

- Reshaping `PluginContext` (101-line interface, ~50 surface members). Stays
  byte-identical so every feature/provider consumer compiles unchanged.
- Removing the conversation-store passthrough methods on Plugin. `PluginContext`
  requires them; consumers depend on them.
- Extracting `loadSettings` / `saveSettings`. They mutate Plugin instance fields
  used directly by `PluginContext` getters; extraction has low payoff and high
  churn. Deferred.
- Extracting `addFileToActiveChat` / `addFolderToActiveChat`. Small,
  semantically part of the plugin shell.

## Approach

Extract five collaborators under `src/app/`. Plugin class becomes a thin shell
that news them up in `onload()` and delegates `PluginContext` methods to them.
Each collaborator takes a typed `plugin` reference (or narrower interface) so
fakes work in tests.

### Module map

| Module | Responsibility | Approx LOC moved |
|--------|----------------|------------------|
| `src/app/commands/registerPluginCommands.ts` | All `addCommand` + `registerCommandHotkey` calls (15 commands) | ~250 |
| `src/app/commands/registerWorkspaceMenus.ts` | `file-menu` + `editor-menu` handlers | ~55 |
| `src/app/views/PluginViewActivator.ts` | View open/activation, tab-creation rules, placement | ~95 |
| `src/app/environment/EnvironmentApplyService.ts` | `applyEnvironmentVariables[Batch]`, affected-provider expansion, reconcile-with-environment, tab restart choreography | ~140 |
| `src/app/lifecycle/PluginLifecycle.ts` | Git watcher install, `shutdownActiveRuntimes`, `persistOpenTabStates` | ~50 |

Total removed from `main.ts`: ~590 lines. Plugin shell lands ~470 LOC.

### Module shapes

**`registerPluginCommands.ts`** — pure registration function.
```ts
export interface PluginCommandDeps {
  plugin: ClaudianPlugin;
  taskExecutionSurface: ChatTabExecutionSurface;
  chatWorkOrderLinker: ChatWorkOrderLinker;
}
export function registerPluginCommands(deps: PluginCommandDeps): void;
```
Each command stays a local `const` so the hotkey-registry call can re-use the
same `id` and `name`. The inline-edit `editorCallback` body (currently a 40-line
inline closure in `onload`) becomes an arrow function inside the factory; it
captures `plugin` via the deps object instead of `this`.

**`registerWorkspaceMenus.ts`** — pure registration function.
```ts
export function registerWorkspaceMenus(plugin: ClaudianPlugin): void;
```
Registers `file-menu` and `editor-menu` listeners through `plugin.registerEvent`.

**`PluginViewActivator.ts`** — class with injected plugin.
```ts
export class PluginViewActivator {
  constructor(private readonly plugin: ClaudianPlugin) {}
  activateView(): Promise<void>;
  activateAgentBoardView(): Promise<void>;
  ensureViewOpen(): Promise<ClaudianView | null>;
  openNewTab(): Promise<void>;
  canCreateNewTab(): boolean;
  runNextReadyWorkOrder(): Promise<void>;
  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null;
  private getMaxTabsLimit(): number;
  private getLastKnownOpenTabCount(): number;
}
```
Plugin keeps `activateView()` (PluginContext requires it) as a one-line
delegate. `canCreateNewTab` and `openNewTab` move fully.

**`EnvironmentApplyService.ts`** — class with injected plugin.
```ts
export class EnvironmentApplyService {
  constructor(private readonly plugin: ClaudianPlugin) {}
  apply(scope: EnvironmentScope, envText: string): Promise<void>;
  applyBatch(updates: Array<{ scope: EnvironmentScope; envText: string }>): Promise<void>;
  reconcileWithEnvironment(providerIds?: ProviderId[]): {
    changed: boolean;
    invalidatedConversations: Conversation[];
  };
  private affectedProviders(scopes: EnvironmentScope[]): ProviderId[];
}
```
Heaviest extraction: owns the multi-step choreography (settings save → tab
restart → view refresh → notice). Plugin's `applyEnvironmentVariables[Batch]`
become one-line delegates.

**`PluginLifecycle.ts`** — class with injected plugin.
```ts
export class PluginLifecycle {
  constructor(private readonly plugin: ClaudianPlugin) {}
  installGitWatcher(): void;
  shutdownActiveRuntimes(): void;
  persistOpenTabStates(): Promise<void>;
}
```
`installGitWatcher` mutates `plugin.gitStatusWatcher` (already a public field
on PluginContext). `shutdownActiveRuntimes` runs synchronously inside
`onunload` — same constraint as today.

### Post-refactor `onload()` skeleton

```ts
async onload() {
  await this.loadSettings();
  this.logger.setEnabled(this.settings.loggingEnabled ?? false);
  this.logger.setLevel(this.settings.logLevel ?? 'warn');
  this.events.setErrorSink((error, event) => {
    this.logger.scope('events').error(`handler for "${event}" threw`, error);
  });

  this.lifecycle = new PluginLifecycle(this);
  this.viewActivator = new PluginViewActivator(this);
  this.envApply = new EnvironmentApplyService(this);
  this.lifecycle.installGitWatcher();

  await ProviderWorkspaceRegistry.initializeAll(this);

  this.registerView(VIEW_TYPE_CLAUDIAN, (leaf) => new ClaudianView(leaf, this));
  this.addRibbonIcon('bot', 'Open Claudian', () => void this.activateView());

  const taskExecutionSurface = new ChatTabExecutionSurface(this);
  this.registerView(
    VIEW_TYPE_CLAUDIAN_AGENT_BOARD,
    (leaf) => new AgentBoardView(leaf, this, taskExecutionSurface),
  );
  // eslint-disable-next-line obsidianmd/ui/sentence-case
  this.addRibbonIcon('kanban-square', 'Open Agent Board',
    () => void this.activateAgentBoardView());

  const chatWorkOrderLinker = new ChatWorkOrderLinker(this);
  this.registerChatMessageAction({ /* unchanged inline action */ });

  registerPluginCommands({ plugin: this, taskExecutionSurface, chatWorkOrderLinker });
  registerWorkspaceMenus(this);

  this.addSettingTab(new ClaudianSettingTab(this.app, this));
}
```

### PluginContext delegates

PluginContext requires several methods that map 1:1 to extracted services.
Plugin keeps them as one-liners:

```ts
activateView(): Promise<void> {
  return this.viewActivator.activateView();
}
applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
  return this.envApply.apply(scope, envText);
}
applyEnvironmentVariablesBatch(
  updates: Array<{ scope: EnvironmentScope; envText: string }>,
): Promise<void> {
  return this.envApply.applyBatch(updates);
}
```

## Staging (5 PRs)

Each PR runs `npm run typecheck && npm run lint && npm run test && npm run build`
before merge. PluginContext byte-identical at every step. No consumer changes.

| # | PR title | Removed LOC | Risk | Order rationale |
|---|----------|-------------|------|-----------------|
| 1 | `refactor(main): extract registerWorkspaceMenus` | ~55 | Lowest | Pure side-effect registration. Establishes pattern. |
| 2 | `refactor(main): extract registerPluginCommands` | ~250 | Low | Big LOC win, mechanical. Reuses pattern from PR 1. |
| 3 | `refactor(main): extract PluginLifecycle` | ~50 | Low | Independent of other extractions. |
| 4 | `refactor(main): extract PluginViewActivator` | ~95 | Medium | Touches `PluginContext.activateView` (one-line delegate). |
| 5 | `refactor(main): extract EnvironmentApplyService` | ~140 | Highest | Most complex side-effect graph. Last so prior pieces stabilize. |

## Test strategy

TDD per project convention. Tests mirror `src/` under `tests/unit/`. Land each
test file in the same PR as its extraction.

| Module | Test file | Cases |
|--------|-----------|-------|
| `registerPluginCommands` | `tests/unit/app/commands/registerPluginCommands.test.ts` | After invoke: `plugin.addCommand` called for every expected id; hotkey registry contains each id; snapshot of `(id, name, callback-kind)`. Fake plugin with stub `addCommand` + `registerCommandHotkey` spy. |
| `registerWorkspaceMenus` | `tests/unit/app/commands/registerWorkspaceMenus.test.ts` | Fire fake `file-menu` event with TFile → expected items added; with TFolder → folder items added. Fire `editor-menu` with empty selection → no item; with non-empty → expected item. |
| `PluginViewActivator` | `tests/unit/app/views/PluginViewActivator.test.ts` | `getLeafForPlacement` per placement; `canCreateNewTab` honors `maxTabs` clamp [3,10]; `canCreateNewTab` uses last-known state when no live view; `openNewTab` skips stacking when `restoredTabCount === 0`; `ensureViewOpen` returns existing view without re-activating. |
| `EnvironmentApplyService` | `tests/unit/app/environment/EnvironmentApplyService.test.ts` | `applyBatch` short-circuits when no scope changed (no tab restarts, single save); `affectedProviders` expands `shared` to all registered providers, narrows `provider:<id>` to one; on `changed=true`, each affected tab gets `resetSession()` + `ensureReady()`; streaming tabs cancelled before restart; failed-tab count surfaces in Notice. View caches invalidated for affected providers. |
| `PluginLifecycle` | `tests/unit/app/lifecycle/PluginLifecycle.test.ts` | `shutdownActiveRuntimes` calls `cleanup()` on every tab across every view, swallows throws; `persistOpenTabStates` runs view saves in parallel; `installGitWatcher` no-ops when `getVaultPath` returns null. |

Fakes built in-test or in `tests/unit/_helpers/`. Use `Pick<ClaudianPlugin, ...>`
typed subsets so TS catches drift from real Plugin shape.

Existing tests untouched. PluginContext unchanged → feature/provider tests stay
green.

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Circular import between extracted module and ClaudianPlugin | `import type { ClaudianPlugin }` only. Module never instantiates the plugin. No runtime cycle. |
| Hidden coupling between commands (shared `taskExecutionSurface`, `chatWorkOrderLinker`) | Pass via explicit `PluginCommandDeps` object. No module-scope state. |
| Inline-edit `editorCallback` captures `this` | Keep as arrow-bound closure inside factory; `plugin` flows through deps. |
| Test fakes drift from real Plugin shape | Use `Pick<ClaudianPlugin, ...>` typed subsets; TS catches missing fields when Plugin changes. |
| Stage 5 (env apply) touches the most surface | Land after stages 1–4 stabilize. If integration coverage gaps surface during PR 5, expand before merging. |
| Subagent dispatch reads main.ts during refactor mid-stage | Each stage compiles and tests green independently; mid-stage worktrees are not committed to main. |

## Definition of done

- All 5 PRs merged.
- `src/main.ts` ≤ 500 LOC.
- `onload()` body ≤ 60 LOC.
- New test files exist for each extracted module, all passing.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` clean.
- `PluginContext` diff: zero lines.
- No `console.*` introductions; logs go through `plugin.logger.scope(...)`.
