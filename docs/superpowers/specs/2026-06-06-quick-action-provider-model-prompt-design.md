---
title: Quick-action provider+model prompt
date: 2026-06-06
status: shipped
scope: src/features/quickActions, src/features/tasks/ui/workOrderContextMenu.ts
---

# Quick-action provider+model prompt

## Problem

Quick-actions fired from outside an active chat tab (file/folder right-click,
work-order card right-click favorites) currently inherit the provider from
whatever tab happens to be active, and the model from
`resolveBlankTabModel`. A user who right-clicks a vault note to run a code
review action has no signal which provider+model will receive the prompt;
the wrong combination wastes a turn and pollutes history.

Reference: [`docs/issues/Executing a quick-action shall prompt for provider and model.md`](../../issues/Executing%20a%20quick-action%20shall%20prompt%20for%20provider%20and%20model.md).

## Goal

When a quick-action is invoked from a non-chat entry point (file/folder
context menu, work-order card right-click), prompt the user for the
provider and model before dispatching. Remember the last choice per
quick-action so repeat runs only require confirming with Enter.

## Non-goals

- Skills tab routing is unchanged. A Claude skill remains Claude-bound;
  model resolution stays on the current `resolveBlankTabModel` path.
- Chat-header toolbar quick-actions button is unchanged — it sends into
  the currently active tab and uses that tab's provider+model.
- No frontmatter mutation of quick-action `.md` files.
- No global "default provider for quick-actions" setting.

## Decisions

| # | Decision |
|---|----------|
| D1 | Trigger scope: file/folder context menu + WO card right-click always prompt. Chat-header toolbar unchanged. |
| D2 | Skills out of scope. Quick Actions only. |
| D3 | UX: a second modal opens after the picker. Two dropdowns + Run/Cancel. |
| D4 | Picker pre-fill = last-used per quick-action (keyed by stem, rename-safe). |
| D5 | Storage: sidecar `.claudian/cache/quick-action-last-used.json`, debounced writes. |
| D6 | Stale persisted pick (provider disabled or model gone): silent fallback to global default + inline notice inside the modal. |

## Architecture

```
openContextMenuQuickAction ─┐
                            ├─► launchQuickAction(plugin, file, action)
WO favorites submenu ───────┘        │
                                     ├─► QuickActionLastUsedStore.get(stem)
                                     │     fallback → global defaults
                                     │
                                     ├─► QuickActionLaunchModal.open({
                                     │     presetProviderId, presetModel,
                                     │     fallbackNotice?,
                                     │   })
                                     │     └─► user picks → { providerId, model }
                                     │
                                     ├─► QuickActionLastUsedStore.set(stem, choice)
                                     │
                                     └─► runQuickActionForFile(plugin, file, action, override)
                                           └─► resolveTargetTab + attach pill
                                               + dispatchQuickActionToTab
```

### New files

| File | Purpose |
|------|---------|
| `src/features/quickActions/launchQuickAction.ts` | Single seam called by every non-chat entry point. Resolves preset, drives the modal, persists the choice, delegates to `runQuickActionForFile` with an override. |
| `src/features/quickActions/QuickActionLastUsedStore.ts` | Reads, mutates, and persists `.claudian/cache/quick-action-last-used.json`. Hydrated in `completeDeferredOnload`, flushed in `onunload`. |
| `src/features/quickActions/ui/QuickActionLaunchModal.ts` | Obsidian `Modal` subclass with provider+model dropdowns, optional fallback notice, Run/Cancel. |

### Modified files

| File | Change |
|------|--------|
| `src/features/quickActions/openContextMenuQuickAction.ts` | Replace `runQuickActionForFile` call inside `onRun` with `launchQuickAction`. |
| `src/features/tasks/ui/workOrderContextMenu.ts` | Replace `runQuickActionForFile` favorites-submenu call with `launchQuickAction`. Picker-submenu path already routes through `openContextMenuQuickAction`. |
| `src/features/quickActions/runQuickActionForFile.ts` | Accept optional `override?: { providerId; model }`. When present, change tab resolution so a blank active tab on the wrong provider is no longer reused, and pass `defaultProviderId` + `pinnedModel` to `createTab`. When absent, behavior is unchanged (chat-header path). |
| `src/main.ts` | Construct + hydrate `QuickActionLastUsedStore` in `completeDeferredOnload` after `ProviderRegistry`. Expose as `plugin.quickActionLastUsedStore`. Flush in `onunload`. |

### Unchanged

- `src/features/quickActions/skills/runVaultSkill.ts` — skills are out of scope.
- `src/features/chat/ClaudianView.ts` `quickActionsBtn` — chat-header path keeps its current "send into the active tab" semantics, with no override.
- `dispatchQuickActionToTab`, `quickActionStemFromPath`, `QuickActionFavoritesCache` — all reused as-is.

## Components

### `QuickActionLastUsedStore`

```ts
class QuickActionLastUsedStore {
  constructor(plugin: ClaudianPlugin);
  hydrate(): Promise<void>;
  get(stem: string): { providerId: ProviderId; model: string } | null;
  set(stem: string, choice: { providerId: ProviderId; model: string }): void;
  flush(): Promise<void>;
}
```

On-disk schema:

```json
{
  "version": 1,
  "entries": {
    "<stem>": {
      "providerId": "claude",
      "model": "claude-sonnet-4-5",
      "updatedAt": 1733512345678
    }
  }
}
```

- Cold cache, corrupt JSON, or schema mismatch resolves to an empty
  in-memory map plus a `warn` breadcrumb on `plugin.logger.scope('quickActions')`.
  Nothing is thrown.
- `set` mutates the in-memory map immediately and schedules a debounced
  write (500 ms trailing). Concurrent `set` calls coalesce to one write.
- `flush` awaits any pending write so unload does not lose the most
  recent choice.
- Key is `quickActionStemFromPath(action.filePath)` — already exists,
  already rename-safe, already used by `QuickActionFavoritesCache`.

### `QuickActionLaunchModal`

```ts
interface QuickActionLaunchModalOptions {
  action: QuickAction;
  presetProviderId: ProviderId;
  presetModel: string;
  fallbackNotice?: {
    storedProviderId: ProviderId;
    storedModel: string;
  };
  onConfirm: (choice: { providerId: ProviderId; model: string }) => void;
}
```

Layout (top → bottom):

```
┌─────────────────────────────────────────────┐
│  Run "<action.name>"                        │
├─────────────────────────────────────────────┤
│  [ Notice: Previous choice                  │  ← only when fallbackNotice present
│    (Codex / gpt-5-codex) unavailable,       │
│    defaulted to Claude / sonnet-4-5. ]      │
│                                             │
│  Provider   [ Claude        ▾ ]             │
│  Model      [ claude-sonnet-4-5  ▾ ]        │
│                                             │
│              [ Cancel ]   [ Run ]           │
└─────────────────────────────────────────────┘
```

Behavior:

- Provider dropdown enumerates `ProviderRegistry.getRegisteredProviderIds()`
  filtered to `ProviderRegistry.isEnabled`. Display label comes from each
  provider's `ProviderCatalogInfo.config.displayName`.
- Switching provider resets the model dropdown to that provider's
  `resolveBlankTabModel`.
- Model dropdown lists the current provider's available models. The model
  list helper currently used by `InputToolbar` is extracted to a shared
  helper so the modal and the toolbar stay in sync.
- Run is the default focus. Enter triggers Run; Esc triggers Cancel.
- Cancel closes the modal and returns without invoking `onConfirm`. The
  store is not mutated.
- Tab-limit checking remains in the dispatcher (`runQuickActionForFile`)
  so the failure notice has one home.
- When no provider is enabled, the provider list is empty, Run is
  disabled, and an inline notice reads "No providers enabled — configure
  in settings."

### `launchQuickAction`

```ts
export async function launchQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
): Promise<void>;
```

Flow:

1. `stem = quickActionStemFromPath(action.filePath)`.
2. `stored = plugin.quickActionLastUsedStore.get(stem)`.
3. Validate `stored`:
   - Provider currently enabled (`ProviderRegistry.isEnabled`)?
   - Model still listed by the provider's model catalog?
   - If both true → `preset = stored`, no fallback notice.
   - If either false → drop the entry, compute default preset, pass
     `fallbackNotice = { storedProviderId, storedModel }` to the modal.
4. If `stored` was absent → preset = global default
   (`ProviderRegistry.resolveSettingsProviderId` + `resolveBlankTabModel`).
5. Open `QuickActionLaunchModal` with preset and optional notice.
6. On confirm:
   - `plugin.quickActionLastUsedStore.set(stem, choice)`.
   - `await runQuickActionForFile(plugin, file, action, { providerId: choice.providerId, model: choice.model })`.
7. On cancel: return without mutating the store.

### `runQuickActionForFile` override

Signature:

```ts
export async function runQuickActionForFile(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
  override?: { providerId: ProviderId; model: string },
): Promise<void>;
```

When `override` is present, the tab-resolution branch changes:

1. Reuse the active blank tab only if its current provider already equals
   `override.providerId`. The pinned model is set on reuse.
2. Otherwise create a new tab with `defaultProviderId: override.providerId`
   and `pinnedModel: override.model`.

When `override` is absent, the existing behavior is preserved — chat-header
toolbar quick-actions keep their current inheritance semantics.

## Data flow

| Step | Source | Sink | Persistence |
|------|--------|------|-------------|
| 1. Right-click | Obsidian context menu | `openContextMenuQuickAction` / WO favorites menu | — |
| 2. Pick action | `QuickActionsModal` (file/folder context menu only) | `launchQuickAction` | — |
| 3. Resolve preset | `QuickActionLastUsedStore` (read) | `QuickActionLaunchModal` (input) | — |
| 4. Confirm | `QuickActionLaunchModal` | `launchQuickAction` (callback) | — |
| 5. Persist | `launchQuickAction` | `QuickActionLastUsedStore.set` | debounced write to `.claudian/cache/quick-action-last-used.json` |
| 6. Dispatch | `launchQuickAction` | `runQuickActionForFile` | tab opens; `usage.recorded` event fires after `sendMessage` resolves |

## Error handling

| Scenario | Behavior |
|----------|----------|
| All providers disabled | Empty provider list, Run disabled, inline notice "No providers enabled — configure in settings." |
| Store hydrate fails (missing or corrupt JSON, schema mismatch) | Treat as cold cache. Warn-log. No notice to user. |
| Store write fails | Warn-log, swallow. Next invocation falls back to defaults. |
| Tab limit reached at dispatch | Existing `tabLimitReached` Notice from `runQuickActionForFile`. The store entry stays written — user intent is preserved for the next attempt. |
| Plugin view fails to activate | Existing early-return in `runQuickActionForFile`. Store entry stays written for the same reason. |
| Persisted provider disabled at launch | Fallback to default preset, modal renders `fallbackNotice`. |
| Persisted model no longer offered by provider | Same as above. |

## Testing

### Unit (under `tests/unit/features/quickActions/`)

| Spec | Coverage |
|------|----------|
| `QuickActionLastUsedStore.test.ts` | hydrate from missing file → empty; hydrate from valid JSON; hydrate from corrupt JSON → empty + warn; `set` updates in-memory immediately; debounced write coalesces multiple `set` calls; `flush` awaits pending write; schema mismatch treated as cold; `get` returns null for unknown stem. |
| `ui/QuickActionLaunchModal.test.ts` | initial state reflects `presetProviderId` + `presetModel`; switching provider resets model to that provider's default; `fallbackNotice` renders when present and is hidden when absent; Run → `onConfirm` with chosen pair; Cancel → no `onConfirm`; only enabled providers appear in the dropdown; empty enabled-provider set disables Run and renders the configure notice. |
| `launchQuickAction.test.ts` | store hit valid → uses stored, no notice; store hit invalid (disabled provider or missing model) → fallback preset + `fallbackNotice` passed to modal; store miss → global default, no notice; cancel → no `set`, no dispatch; confirm → `set` called once with the chosen pair, `runQuickActionForFile` called with the override. |
| `runQuickActionForFile.test.ts` (extend existing) | override + active tab matches provider AND is blank → reuses with `pinnedModel`; override + active blank with wrong provider → creates a new tab with `defaultProviderId` + `pinnedModel`; override absent → existing inheritance path preserved. |

### Integration (under `tests/integration/features/quickActions/`)

| Spec | Coverage |
|------|----------|
| `quickActionFromFileContextMenu.int.test.ts` | right-click file → `QuickActionsModal` → click action → launch modal → confirm → tab created with chosen provider+model → prompt dispatched with file pill attached → `usage.recorded` emitted. |
| `quickActionFavoritesFromWorkOrder.int.test.ts` | WO right-click favorites submenu → launch modal opens (no picker step) → confirm → action runs on the WO note. |

### Out of scope

- Skills tab routing (`runVaultSkill`) — unchanged.
- Chat-header toolbar quick-actions button — unchanged path.
- No new perf spec: store reads are O(1) map lookups and writes are
  debounced; modal opens are user-initiated.

## Migration

- First load after upgrade: cache file does not exist. `hydrate` resolves
  to empty. Every quick-action invocation falls through to the global
  default preset. After the user's first Run, the entry is written and
  future invocations of that action pre-fill the stored pair.
- No settings migration is required. No frontmatter mutation occurs.

## Open questions

None at this time.
