---
status: open
type: issue
target-version: 4.0.0
tags:
  - settings
  - registry
  - tech-debt
priority: 2 - normal
relations:
  - "[[2026-05-30-settings-overhaul-design]]"
  - "[[2026-05-30-settings-overhaul]]"
  - "[[Agent Board/tasks/work-order-20260606-settings-overhaul]]"
---

> **Triage update (2026-06-07):** target-version was 3.1.0 but Claudian is now at 3.5.0 without the port
> landing — every v3.x release after 3.0.0 has shipped on the restored legacy renderers (commit
> `45f71576`). Re-targeted to v4.0.0 because deleting the legacy fallback is the breaking change that
> justifies a major bump. Work-order
> [[Agent Board/tasks/work-order-20260606-settings-overhaul]] (2026-06-06) tried to drive this port plus
> a fresh 3.0.0 release but was closed as stale — 3.0.0 had already shipped months earlier and the
> residual scope is what this issue tracks. The `USE_REGISTRY_RENDERER` const and the orchestrator
> registry slot (`fields/orchestrator.ts` was never created — orchestrator surface removed in
> `f0d0d5d7`) are obsolete; drop both when porting.

# Complete the settings registry port — phase J followup (v3.1.0)

## Problem

The v3.0.0 settings overhaul (phases A–J) landed the registry foundation, search bar, first-run banner, custom models table, resolver-aware Agent Board defaults, and live hotkeys section. Phase J1 (`d78920c refactor(settings): remove legacy imperative renderers`) then deleted every legacy renderer assuming the registry was complete.

The registry is NOT complete. Five tabs ship with stub registrations or major field gaps. Without the legacy renderers as fallback, the settings panel rendered with most fields missing on first install. Legacy renderers were restored as a temporary fallback and wired back through `useRegistryRenderer(tabId)` in `featureFlag.ts`.

Current `REGISTRY_TABS = { agentBoard, orchestrator, diagnostics }` — only those three tabs use the registry. The other five (`general`, `claude`, `codex`, `opencode`, `cursor`) still run the imperative renderers restored from git history.

## Audit (2026-06-07 — supersedes 2026-05-31)

| Tab | Registry fields | Legacy fields | % complete | Status |
|---|---|---|---|---|
| Agent Board | 7 | 7 | 100% | Registry ✓ |
| Diagnostics | 4 | 4 | 100% | Registry ✓ |
| General | 6 | 35+ | 17% | Legacy fallback |
| Claude | 3 | 12+ | 25% | Legacy fallback |
| Codex | 3 | 10+ | 30% | Legacy fallback |
| Opencode | 8 (5 stubs) | 9 | 44% | Legacy fallback |
| Cursor | 5 (2 stubs) | 6 | 67% | Legacy fallback |

> **Correction:** The 2026-05-31 audit listed Orchestrator at 100% in the registry; in commit `f0d0d5d7`
> (`refactor(settings): remove orchestrator settings surface`) the entire orchestrator settings UI was
> deleted, so there is no orchestrator tab to port. Current `REGISTRY_TABS = { 'agentBoard', 'diagnostics' }`
> (verified against `src/features/settings/registry/featureFlag.ts` at 3.5.0). Total registry-port scope is
> therefore 5 tabs, not 5 + orchestrator.

## Missing fields per tab

### General (29 fields missing)

`src/features/settings/registry/fields/general.ts` declares 7 sections (`providers`, `appearance`, `chat`, `inlineEdit`, `agentMentions`, `performance`, `diagnostics`, `hotkeys`) but only registers fields in `providers` (5) and `hotkeys` (1). Missing:

- **Language**: locale dropdown
- **Display**: `tabBarPosition`, `maxTabs` slider, `chatViewPlacement`, `enableAutoScroll`, `deferMathRenderingDuringStreaming`
- **Conversations**: `enableAutoTitleGeneration`, `titleGenerationModel`
- **Content**: `userName`, `systemPrompt`, `excludedTags`, `mediaFolder`
- **Input**: `requireCommandOrControlEnterToSend`, `keyboardNavigation` mappings
- **Environment**: `sharedEnvironmentVariables` snippet manager
- **Quick actions**: `quickActionsFolder`

### Claude (10 fields missing)

`src/features/settings/registry/fields/claude.ts` registers 3 fields. Missing:

- `loadUserSettings` toggle
- `enableOpus1M`, `enableSonnet1M` toggles
- `enableChrome`, `enableBangBash` experimental toggles
- Custom widgets: slash commands, hidden commands, subagents, MCP servers, plugins, environment variables
- Field-name unification: registry uses `cliPath`; legacy uses `cliPathsByHost` (hostname-keyed)

### Codex (8 fields missing)

`src/features/settings/registry/fields/codex.ts` registers 3 fields. Missing:

- `safeMode` dropdown (workspace-write | read-only)
- `installationMethod` (native-windows | wsl, Windows-only)
- `wslDistroOverride` (Windows + WSL)
- `reasoningSummary` dropdown
- Custom widgets: skills, subagents, environment variables
- Field-name unification: registry uses `appServerPath`; legacy uses `cliPathsByHost`

### Opencode (5 stub fields)

Custom widgets declared but render as no-op:

- `visibleModels` picker (multi-checkbox, complex UI)
- `modelAliases` editor
- `commands` widget
- `subagents` widget

### Cursor (2 stub fields)

- `visibleModels` picker (family grouping, search, count badges)
- `modelAliases` editor

## Other deferred work from spec

- **First-run banner UI**: spec calls for one row per provider with checkbox + name + one-line description + CLI hint + Enable selected/Dismiss buttons. Current `FirstRunBanner.ts` has the data flow but should be checked against spec wording and CLI-missing pill.
- **Custom models source pill behavior**: spec calls for `env` source → read-only id + alias, editable context window, Remove disabled with `Set via env` tooltip. Implementation should be verified against env-discovered rows. **Polish pass (2026-05-31)**: env rows now reject `openEditorRow()` and edit/delete buttons hidden — but the `Set via env` tooltip and explicit Remove-disabled state still need verification on a vault with env-discovered models.
- **Legacy modelOverrides migration**: one-shot migration from `{providerId}.environment.modelOverrides` to `customModels` on first v3 load. Verify on a vault that has legacy overrides.
- **`registry/providers/registerProviderTab.ts`** ~~is unused~~ **was wrongly tagged unused on 2026-05-31** — actually imported by all four `src/features/settings/registry/fields/{claude,codex,opencode,cursor}.ts` modules to register the provider tab + sections in one call. Decide canonical location (spec said `src/providers/{provider}/settings/registryFields.ts`), but it is wired in today; don't delete during the port.
- **HotkeysSection refresh** currently polls every 2 s (`HotkeysSection.ts` post-polish pass) because Obsidian does not emit a `hotkey-changed` event. Either subscribe to a native Obsidian event if one becomes available, or replace polling with a single check on `settings-panel-focused` workspace event.

## Polish pass (2026-05-31) — landed

Tracked here so the registry port plan does not duplicate work. Not yet committed; on `main` working tree.

- `searchUtils.searchFields()` now filters fields whose `visible(settings)` returns `false`. ClaudianSettings passes `ctx.settings` through. New unit tests in `tests/unit/features/settings/search/searchUtils.test.ts` cover the visibility branch.
- `featureFlag.ts` flipped to only register-driven tabs (`agentBoard`, `orchestrator`, `diagnostics`). New unit test `tests/unit/features/settings/registry/featureFlag.test.ts` locks the membership.
- `HotkeysSection.ts` renamed unprefixed CSS classes to `claudian-hotkey-*`, polls bindings every 2 s while panel open, returns proper disposer. New `src/style/settings/hotkeys-section.css`.
- `CustomModelsTable.ts` guards env-sourced rows from `openEditorRow()`. New `src/style/settings/custom-models.css` (grid table layout + editor + error state).
- Restored legacy renderers (`ClaudeSettingsTab.ts`, `CodexSettingsTab.ts`, `OpencodeSettingsTab.ts`, `CursorSettingsTab.ts` plus the four `src/features/settings/ui/*.ts` files deleted in J1). Their `settingsTabRenderer` re-wired into the provider workspace service registrations.
- `ProviderWorkspaceRegistry.getSettingsTabRenderer` smoke test added so the J1-style accidental wipe is caught next time.
- `src/style/settings/mcp-settings.css` swapped hard-coded `rgba(0,0,0,0.2)` shadow for `var(--shadow-l)` — dark-mode safe.
- `src/style/settings/base.css` added registry-section / first-run-banner-host styles.
- `.gitignore` hardened: `.claude/worktrees/**` and `.worktrees/**` both ignored explicitly. Stale `.claude/worktrees/cursor-hardening` gitlink entry removed via `git rm --cached`.

## Acceptance

- All 7 active tab ids present in `REGISTRY_TABS` (`general`, `claude`, `codex`, `opencode`, `cursor`, `agentBoard`, `diagnostics` — orchestrator removed in `f0d0d5d7`).
- Every legacy field has a matching registry entry (id, label, type, default, keywords).
- All four legacy renderer files removed:
  - `src/providers/claude/ui/ClaudeSettingsTab.ts`
  - `src/providers/codex/ui/CodexSettingsTab.ts`
  - `src/providers/opencode/ui/OpencodeSettingsTab.ts`
  - `src/providers/cursor/ui/CursorSettingsTab.ts`
- Legacy section files removed (verified present on `main` at 3.5.0):
  - `src/features/settings/ui/AgentBoardSettingsSection.ts`
  - `src/features/settings/ui/EnvironmentSettingsSection.ts`
  - `src/features/settings/ui/LoggingSettingsSection.ts`
  - `src/features/settings/ui/QuickActionsSettingsTab.ts`
  - (`OrchestratorSettingsTab.ts` already deleted in `f0d0d5d7` along with the orchestrator surface.)
- `src/features/settings/ClaudianSettings.ts` reduced to shell + search + tab strip + single `renderTab()` call per tab (no `renderHiddenProviderCommandSetting`/`renderCustomContextLimits` helpers).
- `featureFlag.ts` deleted. `useRegistryRenderer` removed from `registry/index.ts`. Tab dispatch goes directly through registry. (Vestigial `USE_REGISTRY_RENDERER` const already removed in commit `3de65d55` — 2026-06-07 triage pass.)
- All settings reachable via search bar (post-port, no field hidden behind unindexed widgets).
- Workspace service `settingsTabRenderer` fields removed from all four provider services.
- Per-tab port commit per provider so a regression can be bisected.

## Implementation guide

Follow the writing-plans skill to create `docs/superpowers/plans/2026-XX-XX-settings-registry-port-completion.md` with per-tab task breakdown:

1. **General**: port 29 fields across 7 sections.
2. **Claude**: port 10 fields including custom-render slots for slash commands, MCP, plugins, subagents.
3. **Codex**: port 8 fields, including Windows-only `installationMethod` and `wslDistroOverride` (use `visible(settings) => Platform.isWin32`).
4. **Opencode**: implement visible-models picker, model aliases, commands, subagents as registered custom render functions.
5. **Cursor**: implement family-grouped visible-models picker, model aliases.
6. **Field-name unification**: settle on `cliPathsByHost` everywhere (hostname-keyed object) or unify to `cliPath` with per-host resolution. Decision should preserve existing user data.
7. **Delete legacy files + workspace service references + featureFlag.ts**.
8. **Verify on fresh vault** and **vault with existing settings** before merging.

## Related

- Design: [[2026-05-30-settings-overhaul-design]]
- Original plan: [[2026-05-30-settings-overhaul]] (Phases A–J)
- Polish pass (2026-05-31): search visibility filter, hotkey polling, CustomModelsTable env guard, custom-models/hotkeys CSS, restored legacy renderers + workspace service wiring, `.claude/worktrees` gitignore hardening

## Status

**Port complete (2026-06-11)** — deletion pass remains, gated on manual vault
verification. Implemented per
[[2026-06-11-settings-registry-port-completion]]:

- `REGISTRY_TABS` now contains all seven tab ids; every tab renders through
  the registry walker, each flipped together with a passing parity test
  (`tests/integration/settings/<tab>Port.test.ts`) that asserts the legacy
  field inventory, real widget mounts, and representative round-trips.
- Provider-owned widgets mount through a new seam: named mounts on
  `ProviderSettingsTabRenderer.widgets`
  (`src/core/providers/settingsWidgets.ts`), resolved from registry custom
  fields via `ProviderWorkspaceRegistry` — features never imports
  `src/providers/**` (boundary gate holds).
- Field-name unification resolved per the plan: hostname-keyed persisted paths
  (`cliPathsByHost`, `installationMethodsByHost`, `wslDistroOverridesByHost`,
  `enabledModelsByHost`) replaced the wrong flat registry ids; user data is
  preserved because the persisted shape never changed.
- Cursor `modelAliases` was removed rather than ported: no such setting is
  persisted or read; the legacy tab (source of truth) has no editor.
- Legacy renderers shrank to thin shells over the same widget mounts
  (Claude 448→173, Codex 447→214, Opencode 671→73, Cursor 326→33 lines) and
  stay wired as the fallback.

**Remaining for v4.0.0 (deliberately NOT done here):** delete the legacy
renderer files + `settingsTabRenderer` render path + `featureFlag.ts`, per
the acceptance list above — only after manual verification on a fresh vault
and a vault with existing settings (the phase-J1 lesson). Until then the
fallback remains one flag-flip away.
