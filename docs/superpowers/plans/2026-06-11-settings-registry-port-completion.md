---
title: "Settings registry port completion"
date: 2026-06-11
status: active
scope: settings-architecture
---

# Settings Registry Port Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render all five remaining settings tabs (`general`, `claude`, `codex`, `opencode`, `cursor`) through the settings registry at field-for-field parity with the legacy renderers, gated by per-tab parity tests, WITHOUT deleting the legacy renderers (deletion is the v4.0.0 breaking step, after manual vault verification).

**Architecture:** Each tab's `src/features/settings/registry/fields/<tab>.ts` becomes feature-complete: simple fields use native registry kinds (`toggle`/`text`/`dropdown`/…); complex widgets mount the *same* legacy component code through `{ kind: 'custom', render }` adapters so behavior is preserved by construction (the pattern `CustomModelsTable` already uses). A per-tab integration parity test renders the registry tab via `mountSettingsShell` and asserts every legacy field is present, then the tab id is added to `REGISTRY_TABS`. Legacy renderers and `settingsTabRenderer` wiring stay in place as the documented fallback until v4.0.0.

**Tech Stack:** TypeScript, Obsidian `Setting` API, the in-repo settings registry (`src/features/settings/registry/`), Jest integration project (`tests/integration/settings/`).

**Key prior art / constraints:**

- `docs/issues/settings-registry-port-followup.md` — authoritative audit + acceptance criteria. This plan implements everything EXCEPT the deletion items (legacy renderer files, `featureFlag.ts` removal, workspace-service `settingsTabRenderer` removal), which are deferred to v4.0.0 per the triage note.
- Phase J1 history: legacy renderers were deleted before the registry was complete and the settings UI shipped broken. That is why every flip in this plan is gated on a parity test.
- Registry API: `src/features/settings/registry/SettingsField.ts` (`SettingsCtx { settings, saveSettings, refresh, plugin }`, field kinds incl. `{ kind: 'custom', render(ctx, host) => void | dispose }`), `registerProviderTab` helper, `getSettingsRegistry()`.
- Test scaffold: `tests/integration/settings/_portTestHelpers.ts` (`createStubPlugin`, `configureProviderRegistryMock`, `mountSettingsShell`, `assertTabRendersRegistry`).
- Gates that must stay green after every task: `npm run typecheck && npm run lint && npm run check:loc && npm run check:quality && npx fallow dead-code --no-cache`, plus the unit/integration projects. New helper modules < 500 nonblank LOC; no new fallow complexity findings (cyclomatic ≤ 20 / cognitive ≤ 15 per function); `max-params` ≤ 6 and `max-depth` ≤ 5 are lint errors; no `any`; no `innerHTML`; `Notice` strings via `t()`.

---

## Decisions locked by this plan

1. **CLI-path field shape: `cliPathsByHost` wins.** The persisted settings shape is the hostname-keyed object (`HostnameCliPaths`, `src/core/types/settings.ts`) that the legacy renderers edit. The registry's flat `providerConfigs.<id>.cliPath` text fields are wrong against real vault data and must be replaced by a custom field whose id is `providerConfigs.<id>.cliPathsByHost`, mounting the same hostname-aware editor the legacy tab uses. No data migration needed because no migration is what preserves data.
2. **Widget reuse over reimplementation.** Every complex legacy widget (MCP manager, slash/hidden commands, subagents, skills, visible-models pickers, model-aliases editors, env snippet manager) is mounted inside a registry custom field by calling the existing exported component/render function. If a widget is currently inline private code in a legacy `*SettingsTab.ts`, extract it to a sibling module first (export one mount function), then call it from BOTH the legacy renderer and the registry field — parity by shared code, and the clone-groups gate stays flat.
3. **Flips are per-tab and last.** A tab id enters `REGISTRY_TABS` only in the same commit as its passing parity test. The coordinator owns `featureFlag.ts` edits to avoid agent conflicts.
4. **Search keywords are part of parity.** Every ported field carries `keywords` so the search-bar acceptance criterion holds.

## File structure

- Modify per tab: `src/features/settings/registry/fields/{general,claude,codex,opencode,cursor}.ts` (field definitions only — keep each file declarative; extract render helpers if a file would exceed ~400 nonblank LOC).
- Create as needed: widget mount modules extracted from legacy tabs, e.g. `src/providers/opencode/ui/visibleModelsPicker.ts`, `src/providers/cursor/ui/visibleModelsPicker.ts` (family-grouped), `src/providers/opencode/ui/modelAliasesEditor.ts` — colocated with their legacy tab, exported mount function `(ctx-like deps, host: HTMLElement) => void | (() => void)`.
- Create per tab: `tests/integration/settings/<tab>Port.test.ts`.
- Modify (coordinator only): `src/features/settings/registry/featureFlag.ts`.

## Parity test pattern (complete, reusable)

```ts
// tests/integration/settings/cursorPort.test.ts  (same shape for every tab)
import {
  assertTabRendersRegistry,
  configureProviderRegistryMock,
  createStubPlugin,
  mountSettingsShell,
} from './_portTestHelpers';

describe('cursor tab registry port', () => {
  it('renders every legacy field through the registry', () => {
    const opts = { /* per _portTestHelpers.PortTestOptions defaults */ };
    configureProviderRegistryMock(opts);
    const shell = mountSettingsShell(opts);

    // Renders the tab through the registry walker (independent of REGISTRY_TABS)
    // and asserts section + field presence by label.
    assertTabRendersRegistry(shell, 'cursor', {
      sections: ['Models', 'Environment'],
      fields: [
        'CLI path',            // hostname-keyed widget host
        'Enabled models',      // family-grouped picker (real, not stub)
        'Model aliases',
        'Custom models',
        'Environment variables',
      ],
    });
  });

  it('round-trips a representative simple field through SettingsCtx', async () => {
    // toggle/text field: simulate the change handler, assert settings value
    // mutated and saveSettings called — guards against fields wired to the
    // wrong settings path (the cliPath vs cliPathsByHost class of bug).
  });
});
```

Read `_portTestHelpers.ts` first and conform to its actual option/assert shapes; extend the helper (not the tests) if a widget needs plugin services stubbed. Custom widgets are asserted present-and-mounted (host element populated, not the stub `render: () => undefined`), with one behavioral smoke each where cheap (e.g. picker renders one checkbox per catalog model).

---

### Task 1: General tab (29 missing fields)

**Files:**
- Modify: `src/features/settings/registry/fields/general.ts`
- Test: `tests/integration/settings/generalPort.test.ts`
- Reference (do not delete): legacy general rendering inside `src/features/settings/ClaudianSettings.ts`

- [ ] **Step 1:** Read the legacy general-tab render path in `ClaudianSettings.ts` end-to-end; list every `Setting` it creates (the audit names them: locale; `tabBarPosition`, `maxTabs`, `chatViewPlacement`, `enableAutoScroll`, `deferMathRenderingDuringStreaming`; `enableAutoTitleGeneration`, `titleGenerationModel`; `userName`, `systemPrompt`, `excludedTags`, `mediaFolder`; `requireCommandOrControlEnterToSend`, keyboard-navigation mappings; shared env snippet manager; `quickActionsFolder`). Treat the legacy renderer as the source of truth, not the audit.
- [ ] **Step 2:** Write `generalPort.test.ts` asserting all sections + the full field list (parity pattern above). Run: `npx jest tests/integration/settings/generalPort.test.ts --selectProjects integration` — expect FAIL (fields missing).
- [ ] **Step 3:** Port the simple fields as native registry kinds with ids equal to their real persisted paths (verify each against `src/app/settings/defaultSettings.ts`), labels/descriptions copied verbatim from the legacy renderer (i18n: reuse the same `t()` keys), and `keywords`.
- [ ] **Step 4:** Mount the shared environment snippet manager (`src/shared/settings/EnvSnippetManager.ts` / `SecretEnvVarsSection.ts` — already shared-zone) and any other composite legacy section as `custom` fields.
- [ ] **Step 5:** Test passes; run the gate set; commit `feat(settings): port general tab to the registry`.

### Task 2: Claude tab (10 missing fields + widgets)

**Files:**
- Modify: `src/features/settings/registry/fields/claude.ts`
- Reference: `src/providers/claude/ui/ClaudeSettingsTab.ts` (448 lines)
- Test: `tests/integration/settings/claudePort.test.ts`

- [ ] **Step 1:** Inventory legacy fields: `loadUserSettings`, `enableOpus1M`, `enableSonnet1M`, `enableChrome`, `enableBangBash`, plus widgets — slash commands (`SlashCommandSettings`), hidden commands, subagents, MCP servers (`McpSettingsManager` from `src/shared/settings/`), plugins, environment variables (`renderEnvironmentSettingsSection` from `src/shared/settings/`), and the hostname-keyed CLI path editor.
- [ ] **Step 2:** Failing parity test (same pattern).
- [ ] **Step 3:** Port toggles natively; mount each widget via `custom` render calling the SAME component the legacy tab uses (extract from `ClaudeSettingsTab.ts` into exported mount functions where currently inline; legacy tab calls the extraction too).
- [ ] **Step 4:** Replace registry `cliPath` field with `cliPathsByHost` custom field (Decision 1).
- [ ] **Step 5:** Test passes; gates; commit `feat(settings): port claude tab to the registry`.

### Task 3: Codex tab (8 missing fields)

**Files:**
- Modify: `src/features/settings/registry/fields/codex.ts`
- Reference: `src/providers/codex/ui/CodexSettingsTab.ts` (447 lines)
- Test: `tests/integration/settings/codexPort.test.ts`

- [ ] **Step 1:** Inventory: `safeMode` dropdown, `installationMethod` (visible only on Windows — `visible: () => Platform.isWin`, match the legacy guard exactly), `wslDistroOverride` (Windows+WSL guard), `reasoningSummary` dropdown, skills widget, subagents widget, env vars section, `cliPathsByHost`.
- [ ] **Step 2–5:** Same TDD/port/flip-prep sequence and commit `feat(settings): port codex tab to the registry`.

### Task 4: Opencode tab (5 stub widgets become real)

**Files:**
- Modify: `src/features/settings/registry/fields/opencode.ts`
- Create: `src/providers/opencode/ui/visibleModelsPicker.ts`, `src/providers/opencode/ui/modelAliasesEditor.ts` (extracted from `OpencodeSettingsTab.ts`, 671 lines — its `render` already carries a 510-line max-lines warning; extraction must shrink it, not grow it)
- Test: `tests/integration/settings/opencodePort.test.ts`

- [ ] Replace the no-op `render: () => undefined` stubs for `visibleModels`, `modelAliases`, `commands`, `subagents` with mounts of the extracted legacy widget code; port remaining simple fields; `cliPathsByHost`; parity test; gates; commit `feat(settings): port opencode tab to the registry`.

### Task 5: Cursor tab (2 stub widgets become real)

**Files:**
- Modify: `src/features/settings/registry/fields/cursor.ts`
- Create: `src/providers/cursor/ui/visibleModelsPicker.ts` (family grouping, search, count badges — extract from `CursorSettingsTab.ts`)
- Test: `tests/integration/settings/cursorPort.test.ts`

- [ ] Same sequence; commit `feat(settings): port cursor tab to the registry`.

### Task 6 (coordinator): flips, search, docs

- [ ] Add each tab id to `REGISTRY_TABS` in `featureFlag.ts` only once its parity test passes; update the audit comment block to reflect completion + the deferred v4.0.0 deletion.
- [ ] Update `tests/unit/features/settings/registry/featureFlag.test.ts` membership lock.
- [ ] Verify search: every ported field reachable via the search bar (`tests/integration/settings/search.test.ts` extended or asserted).
- [ ] Update `docs/issues/settings-registry-port-followup.md`: port complete, deletion items re-scoped to a v4.0.0 follow-up section; note manual vault verification (fresh vault + existing vault) as the remaining gate before deletion.
- [ ] Full gate suite; ratchet baseline if metrics moved; commit `feat(settings): render all tabs through the registry (legacy fallback retained)`.

## Self-review notes

- Spec coverage: all five tabs (audit §"Missing fields per tab") → Tasks 1–5; flips + search + docs → Task 6; deletion criteria intentionally deferred with rationale (triage note targets v4.0.0); field-name unification → Decision 1 inside Tasks 2–5; per-tab commits → each task commits separately (bisectable, per acceptance).
- The inventories above come from the 2026-06-07 audit; each task's Step 1 re-derives them from the legacy renderer so the plan can't be stale.
- Widget reuse keeps the duplication and LOC gates flat; extractions must leave legacy files smaller, never larger (LOC ratchet).
