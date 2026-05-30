---
status: draft
---

# Settings overhaul — design

Status: draft / design  
Date: 2026-05-30  
Owner: Claudian core  
Target version: 3.0.0 (major)

## Executive summary

The Claudian settings panel grew organically and now ships several surprises that hurt onboarding and authoring:

1. All four providers default to `enabled: false` — fresh installs hide every provider tab.
2. Codex and Opencode tabs each contain a redundant "Enable X" toggle that duplicates the General-tab toggle.
3. `agentBoardDefaultProvider` defaults to `'codex'` and is auto-rewritten at render time.
4. Orchestrator and Agent Board tabs are always visible regardless of feature state.
5. Per-model context-window/alias overrides live hidden in General → Environment and only render when a `*_MODEL` env var is detected.
6. Legacy `.claude/claudian-settings.json` and `.claude/sessions/` paths are still read; the fork has been on `.claudian/` since 2.0.18 — the code is dead.
7. Hotkeys section is a list of read-only deep-link rows with no live binding information.

The user has also asked for two structural improvements layered on top of the surprise fixes:

- A search box at the top of the settings panel that fuzzy-matches across all tabs and jumps to the result.
- A typed settings registry so each field is declared once and consumed by renderers, search, defaults, and visibility.

These changes are breaking (default-enable behaviour and the `agentBoardDefaultProvider` default change). Version bumps to 3.0.0.

Related context:

- [[docs/user-manuals/settings.md]] — the manual that surfaced the surprises.
- [[docs/ideas/2026-05-28-standalone-product-vision.md]] — future-direction context for staying provider-neutral.
- Project [[CLAUDE.md]] — multi-provider product status.

## Goals

- Eliminate every documented surprise.
- Move every settings field through a single typed registry.
- Add a search box that jumps to the matched field.
- Render the first-run experience as an inline banner on the General tab.
- Hide disabled provider tabs entirely.
- Resolve the Agent Board default provider deterministically from the enabled set.
- Surface per-model context-window/alias overrides in each provider's Models section, always.
- Show live hotkey bindings inline with deep-link Edit buttons.
- Strip all dead legacy storage paths.

## Non-goals

- Reshaping the tab structure (feature tabs and per-provider tabs stay).
- Adding provider presets, multi-select bulk actions, or per-section collapsibles.
- Building a settings-import/export tool.
- Refactoring the provider runtimes themselves.
- Changing the Hotkeys behavior beyond surfacing the current binding.

## Approach

A single typed settings registry owns every field's declaration. Tab renderers iterate the registry slice for their tab + section. Tab visibility, default seeding, first-run banner state, and search index are all derived from the same registry. Storage stays where it is (`.claudian/claudian-settings.json`), but the registry replaces hand-maintained `addSetting()` walls in tab renderers.

Other approaches considered and rejected:

- **Minimal patch + bolt-on search.** Keep imperative tab builders, add a hand-maintained search index. Every new field would have to be added in three places. Drift risk too high.
- **Registry only for search + banner.** Two coexisting systems (imperative tabs + registry slice). Same drift risk in a smaller surface.

## Architecture overview

New module: `src/features/settings/registry/`.

- `SettingsField.ts` — typed contract for fields.
- `SettingsRegistry.ts` — runtime registry, grouped by tab + section, with `register`, `getByTab`, `getAll`, `search`.
- `fields/` — one file per logical group: `general.ts`, `agentBoard.ts`, `orchestrator.ts`, `diagnostics.ts`. Per-provider fields live in `src/providers/{provider}/settings/registryFields.ts`.

Existing per-tab renderers (`ClaudeSettingsTab.ts`, `CodexSettingsTab.ts`, `OpencodeSettingsTab.ts`, `CursorSettingsTab.ts`, the General tab, etc.) keep ownership of layout but consume the registry slice via `registry.getByTab(tabId)`. Hard-coded `addSetting()` walls are replaced by iteration. Renderers still own non-uniform widgets (Custom models table, MCP server list, plugin manager grid) by registering them as `kind: 'custom'` fields.

Shell (`ClaudianSettings.ts`):

- Adds the search bar at the top.
- Reads the tab list from the registry: `registry.getTabs(settings).filter(tab => tab.visible(settings))`.
- Renders the first-run banner above the active tab when its predicate holds.

Settings storage (`ClaudianSettingsStorage`):

- Drops every legacy code path. On missing canonical file, writes registry-derived defaults.
- `defaultSettings.ts` shrinks to the non-registry composite shapes (nested arrays like provider catalogs).

## Settings registry contract

```ts
type SettingsFieldType =
  | { kind: 'toggle' }
  | { kind: 'text' }
  | { kind: 'textarea' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'dropdown'; options: (s: ClaudianSettings) => Array<{ value: string; label: string }> }
  | { kind: 'folder' }
  | { kind: 'button'; label: string; onClick: (ctx: SettingsCtx) => void }
  | { kind: 'custom'; render: (ctx: SettingsCtx, host: HTMLElement) => void };

interface SettingsField<T = unknown> {
  id: string;               // dotted path, e.g. 'agentBoard.workOrderFolder'
  tabId: string;
  sectionId: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  default: T;
  visible?: (s: ClaudianSettings) => boolean;
  keywords?: string[];      // search aliases
}

interface SettingsTab { id: string; label: string; order: number; visible: (s: ClaudianSettings) => boolean }
interface SettingsSection { id: string; tabId: string; label: string; order: number; description?: string; visible?: (s: ClaudianSettings) => boolean }
```

Registry API:

```ts
registry.registerTab(tab)
registry.registerSection(section)
registry.registerField(field)
registry.getTabs(settings): SettingsTab[]                     // visible + ordered
registry.getSections(tabId, settings): SettingsSection[]      // visible + ordered
registry.getFields(tabId, sectionId, settings): SettingsField[]
registry.search(query, settings): SettingsField[]             // fuzzy over label + description + keywords
```

Value I/O stays on the `ClaudianSettings` object — the registry only describes shape. Helpers `readPath(s, id)` and `writePath(s, id, value)` resolve dotted ids.

Defaults: `buildDefaultsFromRegistry()` returns the registry-derived seed on first run. Composite shapes (e.g. nested provider model lists) are merged from `defaultSettings.ts`.

## Tab visibility and the first-run banner

Visibility rules declared on each tab:

| Tab | `visible(settings)` |
|---|---|
| General | always |
| Agent Board | always |
| Orchestrator | always |
| Diagnostics | always |
| Claude | `settings.claude.enabled` |
| Codex | `settings.codex.enabled` |
| Opencode | `settings.opencode.enabled` |
| Cursor | `settings.cursor.enabled` |

The shell re-renders the tab strip whenever any provider's `enabled` flag changes. If the currently active tab disappears, the shell falls back to General.

**Single source of truth for enable**: General → Providers section. Each provider renders one row containing the enable toggle, a status pill (`Enabled` / `Disabled` / `CLI missing`), and an `Open settings →` link enabled only when the provider is on. The redundant per-tab "Enable X" toggles inside Codex and Opencode Setup are removed.

**First-run banner** lives at the top of the General tab only (other tabs are not the entry point on a fresh install). Visibility:

```text
showBanner = !settings.firstRunDismissed && !hasAnyProviderEnabled(settings)
```

New settings flag: `firstRunDismissed: boolean` (default `false`).

Banner UI:

- Heading: "Welcome to Claudian — pick your providers".
- Short blurb: "Claudian wraps coding agents inside Obsidian. Enable one or more to start."
- One row per provider with: checkbox, name, one-line description, CLI requirement hint.
- Two buttons:
  - **Enable selected** writes enables atomically, sets `firstRunDismissed = true`, refreshes the tab strip.
  - **Dismiss** sets `firstRunDismissed = true` only.
- Re-show path: General → Providers section has a `Show setup again` link that flips `firstRunDismissed` back to `false`.

Banner gotchas:

- If the user manually enables a provider in the Providers section while the banner is open, the banner auto-dismisses and `firstRunDismissed = true` is written.
- The banner never returns automatically; only the `Show setup again` link brings it back.

## Search

- Box at the top of the settings shell, above the tab strip. Persistent across tabs.
- Placeholder: `Search settings…`. Clear button on the right when non-empty. Keyboard: `/` from inside the panel focuses; `Esc` clears.
- Index is built once from the registry on settings-panel open. Each `SettingsField` becomes a weighted index entry: label (×3), description (×2), `keywords[]` (×2), and `tabId + sectionId` joined (×1).
- Match is case-insensitive subsequence per weighted string. Score is the weighted sum of inverse positions — the same simple matcher Obsidian uses for the command palette.

Result rendering:

- Empty query: normal tab view, no filter applied.
- Non-empty query: the tab strip is replaced by a single virtual **Search results** view listing matched fields grouped by tab → section. Each row shows label, description, breadcrumb (`Claude › Models › Custom models`), and a **Go** button.
- **Go** click: clears the search, switches to the result's tab, scrolls the section into view, pulses a 1.5 s highlight ring around the field.

Visibility filter applied per query, not at index time: the index covers every registered field, but results are filtered through each field's `visible(settings)` predicate at search time. Hidden fields (e.g. Claude fields while `claude.enabled = false`) drop out of results. The search will not surface settings the user cannot currently see.

Empty results: "Nothing matches. Try fewer words." plus a `Reset` button.

Performance: registry size stays well under 200 fields. Linear scan is fine; no web worker.

## Models section per provider

Each provider tab gains a **Models** section with two subsections.

**Default model**

- Single dropdown sourced from the provider's catalog.
- Default = first entry of the catalog.
- Field id: `{providerId}.defaultModel`. Distinct from `agentBoard.defaultModel` — the per-provider default is the model the chat picker opens to; the Agent Board default is the model captured work orders are stamped with.

**Custom models** (replaces the hidden General → Environment per-model overrides)

- Always renders. Empty state: "No custom models configured. Add one to set a context window or alias."
- Table rows: `{ Model id, Label (alias), Context window, Source, Remove }`.
- Source pill:
  - `env` — discovered from a `*_MODEL` env var. Read-only id and alias, editable context window, Remove disabled with tooltip "Set via env".
  - `user` — added via the `+ Add custom model` button. All fields editable, Remove enabled.
- **+ Add custom model** opens an inline editor row with id (required), label (optional), context window (number, default = catalog default for the closest match).
- Validation: model id must be unique within the provider; reject duplicates against the catalog or other custom rows. Inline error under the row.

Storage shape (per provider):

```ts
interface ProviderCustomModel {
  id: string;
  label?: string;
  contextWindow?: number;
  source: 'user' | 'env';
}
```

Field id: `{providerId}.customModels: ProviderCustomModel[]`.

Where the override is consumed: the provider's model catalog merges `customModels` plus env-discovered entries at runtime. The runtime picks `customModels[].label` for display and `contextWindow` for token budgeting. No change to the provider runtime contract.

**One-shot in-place migration** of legacy General → Environment overrides on first v3 load: walk `{providerId}.environment.modelOverrides` (if present), translate each entry to `{ id, contextWindow, source: 'env' }`, write to new `customModels`, erase the legacy field. Silent and idempotent.

## Agent Board default provider resolver

Stored field: `agentBoard.defaultProvider: ProviderId | null` (default `null`, not `'codex'`).

`resolveAgentBoardDefaultProvider(settings)`:

1. If `defaultProvider` is set and that provider is enabled → return it.
2. Otherwise → return the first provider in tab-strip order (`claude`, `codex`, `opencode`, `cursor`) that is enabled.
3. If no provider is enabled → return `null`.

Settings-panel UI rules:

- 0 providers enabled: dropdown disabled, helper text "No provider enabled — enable one first". No write to stored field.
- 1 provider enabled: dropdown is locked to that provider, shown as a read-only chip with helper text "Locked while only one provider is enabled". Stored field keeps the user's last explicit pick.
- ≥ 2 providers enabled: dropdown editable. User picks write `defaultProvider`. If the user pick later becomes invalid (provider disabled), the stored field stays; resolver step 1 falls through to step 2.

Reactive UI: enabling or disabling any provider triggers a re-render of the Agent Board section. The dropdown swaps mode automatically.

Default model field (`agentBoard.defaultModel`) follows the same pattern keyed off the resolved provider. Stored: `agentBoard.defaultModel: string | null`. Resolved: user's pick if valid for the resolved provider, otherwise the provider's `defaultModel`, otherwise `null`.

There is no auto-rewrite at render time. The stored field always reflects user intent; the resolved field always reflects current reality.

## Hotkeys section

Lives on General tab, last section. One row per Claudian command.

Row anatomy:

- Command label (e.g. "Open Agent Board").
- Current binding chip — read live from `this.app.hotkeyManager.getHotkeys(commandId)`. Renders the human-readable shortcut (e.g. `Ctrl+Shift+B`). Multiple bindings join with commas. Empty → muted `Unbound` chip.
- Edit button → deep-links to Obsidian's Hotkeys tab pre-filtered to that command (`app.setting.openTabById('hotkeys')` plus filter setter, per the existing global-link pattern).

Source of truth for the command list: each `plugin.addCommand(...)` call also registers a `HotkeyEntry { commandId, label, defaultBinding? }` in a `commandHotkeyRegistry`. The settings section reads from that registry — no hand-maintained duplicate list.

Re-render: the section subscribes to `app.workspace.on('hotkey-changed')` while visible and updates chips live without panel reopen.

Search integration: command labels are indexed with `keywords: ['hotkey', 'shortcut', 'binding']` so a search for `agent board` surfaces both the actual Agent Board settings and the matching hotkey row.

## Strip legacy storage paths

Fork started at Claudian 2.0.18; `.claudian/` has always been canonical here. No upgrade path exists.

Code deletions:

- `LEGACY_CLAUDIAN_SETTINGS_PATH` in `src/core/bootstrap/StoragePaths.ts` and every call site.
- `LEGACY_SESSIONS_PATH` in the same file and every call site.
- `existsLegacyFile()` / `deleteLegacyFileIfPresent()` / legacy-read branch in `src/app/settings/ClaudianSettingsStorage.ts`.
- Re-exports in `src/providers/claude/storage/ClaudianSettingsStorage.ts`.
- Legacy session-path fallback in `src/core/bootstrap/SessionStorage.ts`.
- Tests asserting migration behavior.

Runtime behavior after the strip:

- Missing canonical file → write defaults from the registry. Done.
- A pre-existing `.claude/claudian-settings.json` (from outside this fork) is ignored, never read, never deleted. Inert orphan.

Release-notes bullet: "Removed unused legacy `.claude/` storage paths."

## Testing strategy

Unit:

- `registry/` — uniqueness, default-roundtrip, search relevance, visibility predicate eval.
- `firstRunBanner` — show/hide rules, dismiss persistence, auto-dismiss on manual enable.
- `agentBoardDefaultProviderResolver` — full state table from the resolver section.
- `customModels` — CRUD, env-source read-only fields, duplicate rejection, legacy migration.
- `hotkeysSection` — live-binding read, deep-link wiring, command-registry indexing.

Integration (`tests/integration/settings/overhaul.test.ts`):

- 0 providers enabled → banner visible, only General/Agent Board/Orchestrator/Diagnostics tabs.
- Enable Claude via banner → tab appears, banner hides, `claude.enabled = true`.
- Default-provider resolver auto-locks to Claude.
- Search `claude` returns Claude fields; search `claude` while Claude disabled returns 0.

Snapshot:

- Tab strip per provider-enable combination (5 snapshots: none, claude-only, claude+codex, all four on, intermediate set).

## Rollout and versioning

Version: 3.0.0 major.

Breaking changes (release-notes section):

- Settings storage no longer reads legacy `.claude/claudian-settings.json` or `.claude/sessions/` (dead-code removal; no behavior change for fork users).
- All providers default to `enabled: false`. Existing vaults preserve their flags via persisted settings — only fresh installs see the change.
- `agentBoardDefaultProvider` default changes from `'codex'` to `null`. Resolver auto-tracks the first enabled provider. Existing vaults keep their explicit value untouched.
- General → Environment hidden per-model context-window overrides moved to each provider tab's Models → Custom models section. One-shot in-place migration on first v3 load.

Backward-compatible additions:

- Settings search box.
- First-run setup banner.
- Hide-disabled-provider-tabs.
- Hotkeys section shows live bindings.
- Custom-model editor with table and add button.

Implementation order (build → release):

1. Registry skeleton + types + tests (no UI swap yet).
2. Port General tab onto the registry; renderer iterates the registry slice. Ship side-by-side with old renderers behind a `USE_REGISTRY_RENDERER` boolean const in `src/features/settings/registry/featureFlag.ts`.
3. Port remaining tabs one by one (Claude → Codex → Opencode → Cursor → Agent Board → Orchestrator → Diagnostics). Each port is its own commit with tests.
4. Shell-level changes: tab visibility, search bar, first-run banner.
5. Default-provider resolver + custom-model section + legacy modelOverrides migration.
6. Hotkeys live-binding read.
7. Strip legacy storage paths.
8. Remove `USE_REGISTRY_RENDERER` once all tabs are ported.

Build gates: `npm run typecheck && npm run lint && npm run test && npm run build` after each step.

A separate implementation plan will live at `docs/superpowers/plans/2026-05-30-settings-overhaul.md` (written next via the writing-plans skill).
