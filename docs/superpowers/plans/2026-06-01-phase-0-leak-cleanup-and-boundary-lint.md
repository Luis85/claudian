---
status: done
---
# Phase 0 — Leak cleanup + boundary lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three outside-provider imports + replace pure-id hardcoded provider arrays + delete the stale ESLint `no-restricted-imports` block + add a scoped provider-boundary ESLint rule so a provider's internals are reachable only through `ProviderRegistry` / `ProviderWorkspaceRegistry`. Implements Move 1 of ADR 0001 r2.

**Architecture:**
- Two new optional methods on existing interfaces — no new structs. `ProviderSettingsReconciler.setEnabled?(settings, enabled)` replaces the per-provider import map in `features/settings/providerEnableUpdaters.ts`. `ProviderChatUIConfig.getAvailableModes?(settings)` lets Opencode's settings field read modes without importing `getOpencodeProviderSettings`. Opencode's existing `normalizeOnLoad?()` hook absorbs the plan→safe selectedMode rewrite currently in `main.ts:701-709`.
- Hardcoded `['claude','codex','opencode','cursor']` arrays in feature code are replaced by `ProviderRegistry.getRegisteredProviderIds()` (order-insensitive sites) or `getEnabledProviderIds()` (preference-ordered sites). `PROVIDER_LABELS` lookup map collapses into `getProviderDisplayName()`.
- `DEFAULT_CHAT_PROVIDER_ID` *literal-stays carve-out*: ~6 migration-backfill sites in `ConversationStore.ts` / `SessionStorage.ts` keep the literal as historical default for legacy session metadata. The remaining `?? DEFAULT_CHAT_PROVIDER_ID` fallback chains in chat features are correct as-is (sensible last-resort default). Phase 0 does not sweep these.
- The ESLint stale block (`eslint.config.mjs:117-126`, all 8 globs match zero files) is deleted wholesale. A new scoped `no-restricted-imports` block is added forbidding any path outside `src/providers/<id>/` from importing `src/providers/<id>/**` — with three exemptions: intra-provider, the bootstrap aggregator(s) that call `ProviderRegistry.register` / `ProviderWorkspaceRegistry.register`, and `features/` deps on `i18n`/`shared`/`utils`/`core/`/`main`.

**Tech Stack:** TypeScript 5; Jest (`npm run test`); ESLint 9 flat config (`eslint.config.mjs`); Obsidian plugin API.

---

## Pre-flight (do once before Task 1)

- [ ] **Verify the baseline is green.**

  Run: `npm run typecheck && npm run lint && npm run test && npm run build`
  Expected: all four exit 0. If any fails, fix the failure first — do not start Phase 0 against a red baseline.

- [ ] **Create the worktree if not already in one.**

  See `superpowers:using-git-worktrees` if needed. Branch name: `phase-0/leak-cleanup-and-boundary-lint`.

---

## File Structure

**Created:**
- `tests/unit/eslint/boundaryRule.test.ts` — synthetic-violation test for the new ESLint rule
- `tests/integration/core/providers/setEnabledRoundTrip.test.ts` — toggle→persist→reload round-trip for all four providers
- `tests/unit/providers/opencode/ui/getAvailableModes.test.ts` — accessor matches settings-field read site

**Modified:**
- `src/core/providers/types.ts` — add `setEnabled?` on `ProviderSettingsReconciler`; add `getAvailableModes?` on `ProviderChatUIConfig`
- `src/providers/claude/env/ClaudeSettingsReconciler.ts` — implement `setEnabled`
- `src/providers/codex/env/CodexSettingsReconciler.ts` — implement `setEnabled`
- `src/providers/cursor/env/CursorSettingsReconciler.ts` — implement `setEnabled`
- `src/providers/opencode/env/OpencodeSettingsReconciler.ts` — implement `setEnabled` and `normalizeOnLoad`
- `src/providers/opencode/ui/OpencodeChatUIConfig.ts` — implement `getAvailableModes`
- `src/features/settings/ClaudianSettings.ts:640` — call `getSettingsReconciler(id).setEnabled?(...)` instead of `getProviderEnableUpdater(id)`
- `src/features/settings/registry/fields/opencode.ts` — call `getChatUIConfig('opencode').getAvailableModes?(settings)`; delete `getOpencodeProviderSettings` import
- `src/features/settings/registry/fields/agentBoard.ts` — replace `PROVIDER_IDS` + `PROVIDER_LABELS` with registry calls
- `src/features/settings/registry/fields/general.ts` — replace hardcoded `PROVIDERS` tuple with registry iteration
- `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts` — replace hardcoded `PROVIDERS` with `getRegisteredProviderIds()`
- `src/features/settings/search/SearchResultsView.ts:40` — splice `getRegisteredProviderIds()` into the existing `tabOrder` (do not replace)
- `src/features/tasks/defaultProviderResolver.ts` — replace `ORDER` with `getEnabledProviderIds()`
- `src/main.ts:64` — delete `OPENCODE_PLAN_MODE_ID`/`OPENCODE_SAFE_MODE_ID` import
- `src/main.ts:701-709` — delete the plan→safe block (moved to opencode reconciler `normalizeOnLoad`)
- `eslint.config.mjs:116-144` — delete stale block; insert scoped boundary block

**Deleted:**
- `src/features/settings/providerEnableUpdaters.ts`
- `tests/unit/features/settings/providerEnableUpdaters.test.ts`

**NOT touched in Phase 0 (deferred / left as-is):**
- `src/features/settings/firstRunBanner/FirstRunBanner.ts:4-9` — carries per-provider UI copy (`blurb`, `cli`), not a pure id list. Move to registration in a follow-up if/when first-run copy becomes provider-owned.
- All ~36 `?? DEFAULT_CHAT_PROVIDER_ID` fallback chains in `features/chat/` — correct as a last-resort default; not a leak.
- Internal `ProviderRegistry` uses of `DEFAULT_CHAT_PROVIDER_ID` — these are the historical-default fallback the constant exists for.
- `ConversationStore.ts:55,104` and `SessionStorage.ts:80` — migration-backfill, must stay literal.

---

## Task 1: Add `setEnabled?` to `ProviderSettingsReconciler`

**Files:**
- Modify: `src/core/providers/types.ts:80-111`

- [ ] **Step 1: Open the file at the reconciler interface.**

  Locate the `ProviderSettingsReconciler` interface block starting at `src/core/providers/types.ts:80`.

- [ ] **Step 2: Add the optional method to the interface.**

  Insert this method into the interface (before the closing brace at `:111`):

  ```ts
    /**
     * Toggles the provider's `enabled` flag inside its own config namespace.
     * Optional so the app shell can route enable toggles through the reconciler
     * without importing the per-provider settings module. Each implementation
     * delegates to its existing `update<Provider>ProviderSettings(s, { enabled })`.
     */
    setEnabled?(settings: Record<string, unknown>, enabled: boolean): void;
  ```

- [ ] **Step 3: Run typecheck.**

  Run: `npm run typecheck`
  Expected: PASS (existing impls remain valid because `setEnabled` is optional).

- [ ] **Step 4: Commit.**

  ```bash
  git add src/core/providers/types.ts
  git commit -m "feat(core): add optional setEnabled to ProviderSettingsReconciler"
  ```

---

## Task 2: Implement `setEnabled` on Claude reconciler

**Files:**
- Modify: `src/providers/claude/env/ClaudeSettingsReconciler.ts`
- Test: `tests/unit/providers/claude/env/ClaudeSettingsReconciler.test.ts` *(create if missing — otherwise extend)*

- [ ] **Step 1: Write the failing test.**

  Create or extend `tests/unit/providers/claude/env/ClaudeSettingsReconciler.test.ts` with:

  ```ts
  import { claudeSettingsReconciler } from '@/providers/claude/env/ClaudeSettingsReconciler';
  import { getClaudeProviderSettings } from '@/providers/claude/settings';

  describe('claudeSettingsReconciler.setEnabled', () => {
    it('writes enabled=true into providerConfigs.claude', () => {
      const settings: Record<string, unknown> = { providerConfigs: { claude: { enabled: false } } };
      claudeSettingsReconciler.setEnabled?.(settings, true);
      expect(getClaudeProviderSettings(settings).enabled).toBe(true);
    });

    it('writes enabled=false into providerConfigs.claude', () => {
      const settings: Record<string, unknown> = { providerConfigs: { claude: { enabled: true } } };
      claudeSettingsReconciler.setEnabled?.(settings, false);
      expect(getClaudeProviderSettings(settings).enabled).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/claude/env/ClaudeSettingsReconciler.test.ts`
  Expected: FAIL — `setEnabled is not a function` or both assertions fail because the method is undefined.

- [ ] **Step 3: Implement `setEnabled` on the reconciler.**

  Open `src/providers/claude/env/ClaudeSettingsReconciler.ts`. Find the `claudeSettingsReconciler` object literal. Add this method (top of the object is fine):

  ```ts
    setEnabled(settings: Record<string, unknown>, enabled: boolean): void {
      updateClaudeProviderSettings(settings, { enabled });
    },
  ```

  If `updateClaudeProviderSettings` is not already imported, add:

  ```ts
  import { updateClaudeProviderSettings } from '../settings';
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/claude/env/ClaudeSettingsReconciler.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run typecheck.**

  Run: `npm run typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit.**

  ```bash
  git add src/providers/claude/env/ClaudeSettingsReconciler.ts tests/unit/providers/claude/env/ClaudeSettingsReconciler.test.ts
  git commit -m "feat(claude): implement setEnabled on settings reconciler"
  ```

---

## Task 3: Implement `setEnabled` on Codex reconciler

**Files:**
- Modify: `src/providers/codex/env/CodexSettingsReconciler.ts`
- Test: `tests/unit/providers/codex/env/CodexSettingsReconciler.test.ts` *(create if missing — otherwise extend)*

- [ ] **Step 1: Write the failing test.**

  ```ts
  import { codexSettingsReconciler } from '@/providers/codex/env/CodexSettingsReconciler';
  import { getCodexProviderSettings } from '@/providers/codex/settings';

  describe('codexSettingsReconciler.setEnabled', () => {
    it('writes enabled=true into providerConfigs.codex', () => {
      const settings: Record<string, unknown> = { providerConfigs: { codex: { enabled: false } } };
      codexSettingsReconciler.setEnabled?.(settings, true);
      expect(getCodexProviderSettings(settings).enabled).toBe(true);
    });

    it('writes enabled=false into providerConfigs.codex', () => {
      const settings: Record<string, unknown> = { providerConfigs: { codex: { enabled: true } } };
      codexSettingsReconciler.setEnabled?.(settings, false);
      expect(getCodexProviderSettings(settings).enabled).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/codex/env/CodexSettingsReconciler.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `setEnabled`.**

  In `src/providers/codex/env/CodexSettingsReconciler.ts`, add to the reconciler object:

  ```ts
    setEnabled(settings: Record<string, unknown>, enabled: boolean): void {
      updateCodexProviderSettings(settings, { enabled });
    },
  ```

  Add import if missing:

  ```ts
  import { updateCodexProviderSettings } from '../settings';
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/codex/env/CodexSettingsReconciler.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/codex/env/CodexSettingsReconciler.ts tests/unit/providers/codex/env/CodexSettingsReconciler.test.ts
  git commit -m "feat(codex): implement setEnabled on settings reconciler"
  ```

---

## Task 4: Implement `setEnabled` on Cursor reconciler

**Files:**
- Modify: `src/providers/cursor/env/CursorSettingsReconciler.ts`
- Test: `tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts` *(create if missing — otherwise extend)*

- [ ] **Step 1: Write the failing test.**

  ```ts
  import { cursorSettingsReconciler } from '@/providers/cursor/env/CursorSettingsReconciler';
  import { getCursorProviderSettings } from '@/providers/cursor/settings';

  describe('cursorSettingsReconciler.setEnabled', () => {
    it('writes enabled=true into providerConfigs.cursor', () => {
      const settings: Record<string, unknown> = { providerConfigs: { cursor: { enabled: false } } };
      cursorSettingsReconciler.setEnabled?.(settings, true);
      expect(getCursorProviderSettings(settings).enabled).toBe(true);
    });

    it('writes enabled=false into providerConfigs.cursor', () => {
      const settings: Record<string, unknown> = { providerConfigs: { cursor: { enabled: true } } };
      cursorSettingsReconciler.setEnabled?.(settings, false);
      expect(getCursorProviderSettings(settings).enabled).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `setEnabled`.**

  In `src/providers/cursor/env/CursorSettingsReconciler.ts`, add to the reconciler object:

  ```ts
    setEnabled(settings: Record<string, unknown>, enabled: boolean): void {
      updateCursorProviderSettings(settings, { enabled });
    },
  ```

  Add import if missing:

  ```ts
  import { updateCursorProviderSettings } from '../settings';
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/cursor/env/CursorSettingsReconciler.ts tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts
  git commit -m "feat(cursor): implement setEnabled on settings reconciler"
  ```

---

## Task 5: Implement `setEnabled` on Opencode reconciler

**Files:**
- Modify: `src/providers/opencode/env/OpencodeSettingsReconciler.ts`
- Test: `tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts` *(create if missing — otherwise extend)*

- [ ] **Step 1: Write the failing test.**

  ```ts
  import { opencodeSettingsReconciler } from '@/providers/opencode/env/OpencodeSettingsReconciler';
  import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

  describe('opencodeSettingsReconciler.setEnabled', () => {
    it('writes enabled=true into providerConfigs.opencode', () => {
      const settings: Record<string, unknown> = { providerConfigs: { opencode: { enabled: false } } };
      opencodeSettingsReconciler.setEnabled?.(settings, true);
      expect(getOpencodeProviderSettings(settings).enabled).toBe(true);
    });

    it('writes enabled=false into providerConfigs.opencode', () => {
      const settings: Record<string, unknown> = { providerConfigs: { opencode: { enabled: true } } };
      opencodeSettingsReconciler.setEnabled?.(settings, false);
      expect(getOpencodeProviderSettings(settings).enabled).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `setEnabled` in the existing reconciler object at `src/providers/opencode/env/OpencodeSettingsReconciler.ts:57`.**

  Insert (place before `handleEnvironmentChange`):

  ```ts
    setEnabled(settings: Record<string, unknown>, enabled: boolean): void {
      updateOpencodeProviderSettings(settings, { enabled });
    },
  ```

  `updateOpencodeProviderSettings` is already imported at the top of the file (line 22) — no import change needed.

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/opencode/env/OpencodeSettingsReconciler.ts tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts
  git commit -m "feat(opencode): implement setEnabled on settings reconciler"
  ```

---

## Task 6: Migrate the settings-tab caller; delete `providerEnableUpdaters.ts`

**Files:**
- Modify: `src/features/settings/ClaudianSettings.ts:17` and `:640`
- Delete: `src/features/settings/providerEnableUpdaters.ts`
- Delete: `tests/unit/features/settings/providerEnableUpdaters.test.ts`

- [ ] **Step 1: Update the import at `ClaudianSettings.ts:17`.**

  Replace:

  ```ts
  import { getProviderEnableUpdater } from './providerEnableUpdaters';
  ```

  With (no new import needed — `ProviderRegistry` is already imported earlier in the file; verify by searching the file's top imports):

  ```ts
  // setEnabled is provided by the registered ProviderSettingsReconciler.
  ```

- [ ] **Step 2: Update the call site at `ClaudianSettings.ts:640`.**

  Replace lines 638-653 (the `for (const providerId ...)` loop body) so the toggle calls the reconciler:

  ```ts
      for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
        const displayName = ProviderRegistry.getProviderDisplayName(providerId);
        const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
        if (!reconciler.setEnabled) {
          continue;
        }

        new Setting(container)
          .setName(`Enable ${displayName}`)
          .setDesc(`Show ${displayName} as a chat provider and reveal its settings tab.`)
          .addToggle((toggle) =>
            toggle
              .setValue(ProviderRegistry.isEnabled(providerId, settingsBag))
              .onChange(async (value) => {
                reconciler.setEnabled!(settingsBag, value);
                await this.plugin.saveSettings();
                for (const view of this.plugin.getAllViews()) {
  ```

  Keep the existing loop tail unchanged.

- [ ] **Step 3: Delete the shim module.**

  ```bash
  git rm src/features/settings/providerEnableUpdaters.ts
  git rm tests/unit/features/settings/providerEnableUpdaters.test.ts
  ```

- [ ] **Step 4: Run typecheck + lint + tests.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. The deleted `providerEnableUpdaters.test.ts` no longer runs; the toggle UI is exercised by the upcoming round-trip integration test (Task 19).

- [ ] **Step 5: Commit.**

  ```bash
  git add src/features/settings/ClaudianSettings.ts
  git commit -m "refactor(settings): route Enable toggle through ProviderSettingsReconciler.setEnabled; delete providerEnableUpdaters shim"
  ```

---

## Task 7: Add `getAvailableModes?` to `ProviderChatUIConfig`

**Files:**
- Modify: `src/core/providers/types.ts` (`ProviderChatUIConfig` interface around `:276`)

- [ ] **Step 1: Add the optional accessor.**

  Insert into `ProviderChatUIConfig` (near `getModeSelector?` at `:330`):

  ```ts
    /**
     * Optional list of provider-owned modes for settings UIs that surface a
     * mode dropdown outside an active selector. Returned modes are stable {id,
     * label} pairs sourced from the provider's own settings bag. Opencode is
     * the canonical user — its `selectedMode` setting field reads this so the
     * field code never imports `getOpencodeProviderSettings` directly.
     */
    getAvailableModes?(settings: Record<string, unknown>): Array<{ id: string; label: string }>;
  ```

- [ ] **Step 2: Run typecheck.**

  Run: `npm run typecheck`
  Expected: PASS (optional, no existing impl needs to change yet).

- [ ] **Step 3: Commit.**

  ```bash
  git add src/core/providers/types.ts
  git commit -m "feat(core): add optional getAvailableModes to ProviderChatUIConfig"
  ```

---

## Task 8: Implement `getAvailableModes` on `OpencodeChatUIConfig`

**Files:**
- Modify: `src/providers/opencode/ui/OpencodeChatUIConfig.ts` (near `getModeSelector` at `:255`)
- Test: `tests/unit/providers/opencode/ui/getAvailableModes.test.ts` *(create)*

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/providers/opencode/ui/getAvailableModes.test.ts`:

  ```ts
  import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';

  describe('opencodeChatUIConfig.getAvailableModes', () => {
    it('returns id/label pairs for non-empty mode ids', () => {
      const settings = {
        providerConfigs: {
          opencode: {
            availableModes: [
              { id: 'plan', name: 'Plan' },
              { id: 'safe', name: 'Safe' },
              { id: '', name: 'Skipped' },
              { id: 'name-only', name: '' },
            ],
          },
        },
      };
      const modes = opencodeChatUIConfig.getAvailableModes?.(settings);
      expect(modes).toEqual([
        { id: 'plan', label: 'Plan' },
        { id: 'safe', label: 'Safe' },
        { id: 'name-only', label: 'name-only' },
      ]);
    });

    it('returns an empty array when availableModes is missing', () => {
      expect(opencodeChatUIConfig.getAvailableModes?.({})).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/opencode/ui/getAvailableModes.test.ts`
  Expected: FAIL (`opencodeChatUIConfig.getAvailableModes is not a function`).

- [ ] **Step 3: Implement the accessor.**

  In `src/providers/opencode/ui/OpencodeChatUIConfig.ts`, replace the existing `getModeSelector(): null { return null; }` block (around `:255-257`) with:

  ```ts
    getAvailableModes(settings: Record<string, unknown>): Array<{ id: string; label: string }> {
      const { availableModes } = getOpencodeProviderSettings(settings);
      return availableModes
        .filter((mode) => typeof mode.id === 'string' && mode.id.length > 0)
        .map((mode) => ({ id: mode.id, label: mode.name || mode.id }));
    },

    getModeSelector(): null {
      return null;
    },
  ```

  `getOpencodeProviderSettings` is already imported at the top of `OpencodeChatUIConfig.ts` (it is used by `resolvePermissionMode` etc.).

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/opencode/ui/getAvailableModes.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/opencode/ui/OpencodeChatUIConfig.ts tests/unit/providers/opencode/ui/getAvailableModes.test.ts
  git commit -m "feat(opencode): expose getAvailableModes accessor on chat UI config"
  ```

---

## Task 9: Route `registry/fields/opencode.ts` through the accessor

**Files:**
- Modify: `src/features/settings/registry/fields/opencode.ts`

- [ ] **Step 1: Replace the imports at the top of the file.**

  Delete:

  ```ts
  import { asSettingsBag } from '../../../../core/types/settings';
  import { getOpencodeProviderSettings } from '../../../../providers/opencode/settings';
  ```

  Add:

  ```ts
  import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
  ```

- [ ] **Step 2: Replace the dropdown options builder at `:34-51`.**

  Replace the existing `r.registerField({ id: 'providerConfigs.opencode.selectedMode', ... })` block's `options:` callback with:

  ```ts
        kind: 'dropdown',
        options: (settings) => {
          const config = ProviderRegistry.getChatUIConfig('opencode');
          const modes = config.getAvailableModes?.(settings as Record<string, unknown>) ?? [];
          return modes.map((mode) => ({ value: mode.id, label: mode.label }));
        },
  ```

- [ ] **Step 3: Run typecheck + lint + tests.**

  Run: `npm run typecheck && npm run lint && npm run test -- tests/unit/features/settings/registry/fields/opencode.test.ts`
  Expected: PASS. If the existing `opencode.test.ts` asserts a specific options shape, it may already pass because we return the same `value/label` pairs.

- [ ] **Step 4: Commit.**

  ```bash
  git add src/features/settings/registry/fields/opencode.ts
  git commit -m "refactor(settings): read Opencode modes via getAvailableModes accessor"
  ```

---

## Task 10: Move plan→safe `selectedMode` rewrite into Opencode `normalizeOnLoad`

**Files:**
- Modify: `src/providers/opencode/env/OpencodeSettingsReconciler.ts`
- Modify: `src/main.ts:64` (delete import)
- Modify: `src/main.ts:701-709` (delete block)
- Test: extend `tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`

- [ ] **Step 1: Write the failing test.**

  In `tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`, add:

  ```ts
  import {
    OPENCODE_PLAN_MODE_ID,
    OPENCODE_SAFE_MODE_ID,
  } from '@/providers/opencode/modes';

  describe('opencodeSettingsReconciler.normalizeOnLoad', () => {
    it('rewrites plan-mode selection to safe on load', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { opencode: { selectedMode: OPENCODE_PLAN_MODE_ID } },
      };
      const changed = opencodeSettingsReconciler.normalizeOnLoad?.(settings);
      expect(changed).toBe(true);
      expect((settings.providerConfigs as { opencode: { selectedMode: string } }).opencode.selectedMode)
        .toBe(OPENCODE_SAFE_MODE_ID);
    });

    it('returns false when selectedMode is not plan', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { opencode: { selectedMode: OPENCODE_SAFE_MODE_ID } },
      };
      expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
    });

    it('returns false when providerConfigs.opencode is missing', () => {
      expect(opencodeSettingsReconciler.normalizeOnLoad?.({})).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`
  Expected: FAIL — `normalizeOnLoad` returns `undefined` because the method is not implemented yet.

- [ ] **Step 3: Implement `normalizeOnLoad`.**

  In `src/providers/opencode/env/OpencodeSettingsReconciler.ts`, add an import at the top:

  ```ts
  import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from '../modes';
  ```

  Add this method to the `opencodeSettingsReconciler` object (place it after `handleEnvironmentChange`):

  ```ts
    normalizeOnLoad(settings: Record<string, unknown>): boolean {
      const configs = settings.providerConfigs;
      if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
        return false;
      }
      const opencodeConfig = (configs as Record<string, unknown>).opencode;
      if (!opencodeConfig || typeof opencodeConfig !== 'object' || Array.isArray(opencodeConfig)) {
        return false;
      }
      const bag = opencodeConfig as { selectedMode?: unknown };
      if (bag.selectedMode === OPENCODE_PLAN_MODE_ID) {
        bag.selectedMode = OPENCODE_SAFE_MODE_ID;
        return true;
      }
      return false;
    },
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts`
  Expected: PASS.

- [ ] **Step 5: Delete the block in `main.ts:701-709`.**

  Open `src/main.ts`. Delete these lines (701-709):

  ```ts
      const opencodeConfig = this.settings.providerConfigs?.opencode;
      if (
        opencodeConfig
        && typeof opencodeConfig === 'object'
        && !Array.isArray(opencodeConfig)
        && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
      ) {
        opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
      }
  ```

- [ ] **Step 6: Delete the `main.ts:64` import.**

  Delete this line at `src/main.ts:64`:

  ```ts
  import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
  ```

- [ ] **Step 7: Verify `ProviderSettingsCoordinator.normalizeOnLoad` is invoked on the same code path.**

  Open `src/app/settings/ClaudianSettingsStorage.ts:77` (already wired) and confirm `ProviderSettingsCoordinator.normalizeOnLoad(settings)` runs after the existing plan→normal rewrite for the *neutral* `permissionMode` (which stays in `main.ts:687-700`). The Opencode rewrite now runs at the same point but through the registered reconciler.

- [ ] **Step 8: Run typecheck + lint + tests.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. The opencode mode constants are no longer imported in `main.ts`.

- [ ] **Step 9: Commit.**

  ```bash
  git add src/providers/opencode/env/OpencodeSettingsReconciler.ts src/main.ts tests/unit/providers/opencode/env/OpencodeSettingsReconciler.test.ts
  git commit -m "refactor(opencode): move plan->safe selectedMode rewrite into normalizeOnLoad"
  ```

---

## Task 11: Replace `defaultProviderResolver.ts` hardcoded `ORDER`

**Files:**
- Modify: `src/features/tasks/defaultProviderResolver.ts`
- Test: `tests/unit/features/tasks/defaultProviderResolver.test.ts` (existing; expect minor update)

- [ ] **Step 1: Write/extend a failing test that asserts ordering follows registration, not the hardcoded array.**

  Open `tests/unit/features/tasks/defaultProviderResolver.test.ts`. Add a new test before the closing `describe`:

  ```ts
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import { resolveAgentBoardDefaultProvider } from '@/features/tasks/defaultProviderResolver';

  describe('resolveAgentBoardDefaultProvider — ordering source', () => {
    it('uses ProviderRegistry.getEnabledProviderIds (sorted by blankTabOrder), not a hardcoded ORDER', () => {
      const spy = jest.spyOn(ProviderRegistry, 'getEnabledProviderIds');
      const settings = {
        providerConfigs: { codex: { enabled: true }, claude: { enabled: true } },
      };
      resolveAgentBoardDefaultProvider(settings as never);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/features/tasks/defaultProviderResolver.test.ts`
  Expected: FAIL — `getEnabledProviderIds` was not called because the resolver uses a local `ORDER` constant.

- [ ] **Step 3: Replace the resolver body.**

  Replace the entire contents of `src/features/tasks/defaultProviderResolver.ts` with:

  ```ts
  import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
  import type { ProviderId } from '../../core/providers/types';
  import type { ClaudianSettings } from '../../core/types/settings';

  function isEnabled(s: ClaudianSettings, id: ProviderId): boolean {
    const cfg = s.providerConfigs?.[id] as { enabled?: boolean } | undefined;
    return Boolean(cfg?.enabled);
  }

  export function resolveAgentBoardDefaultProvider(s: ClaudianSettings): ProviderId | null {
    const stored = (s.agentBoardDefaultProvider ?? null) as ProviderId | null;
    if (stored && isEnabled(s, stored)) return stored;
    const ordered = ProviderRegistry.getEnabledProviderIds(s as unknown as Record<string, unknown>);
    return ordered[0] ?? null;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/features/tasks/defaultProviderResolver.test.ts`
  Expected: PASS. Pre-existing tests should also still pass (ordering by `blankTabOrder` matches the previous claude/codex/opencode/cursor `ORDER` for the four current providers).

- [ ] **Step 5: Commit.**

  ```bash
  git add src/features/tasks/defaultProviderResolver.ts tests/unit/features/tasks/defaultProviderResolver.test.ts
  git commit -m "refactor(tasks): resolve default provider via getEnabledProviderIds (registration order)"
  ```

---

## Task 12: Replace `agentBoard.ts` `PROVIDER_IDS` + `PROVIDER_LABELS`

**Files:**
- Modify: `src/features/settings/registry/fields/agentBoard.ts:14-25` and `:246` and `:262` and `:272` and `:318`

- [ ] **Step 1: Write/extend a failing test.**

  Open `tests/unit/features/settings/registry/fields/agentBoard.test.ts`. Add a test that asserts the file does not export `PROVIDER_IDS` or `PROVIDER_LABELS`:

  ```ts
  import * as agentBoardFields from '@/features/settings/registry/fields/agentBoard';

  describe('agentBoard.ts boundary', () => {
    it('does not export hardcoded PROVIDER_IDS or PROVIDER_LABELS', () => {
      expect((agentBoardFields as Record<string, unknown>).PROVIDER_IDS).toBeUndefined();
      expect((agentBoardFields as Record<string, unknown>).PROVIDER_LABELS).toBeUndefined();
    });
  });
  ```

  This passes today vacuously (they are module-private), but locks the contract.

- [ ] **Step 2: Replace `:14-25` (the two consts and the helper).**

  Delete lines 14-25:

  ```ts
  const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

  const PROVIDER_LABELS: Record<string, string> = {
    claude: 'Claude',
    codex: 'Codex',
    opencode: 'Opencode',
    cursor: 'Cursor',
  };

  function providerLabel(id: ProviderId): string {
    return PROVIDER_LABELS[id] ?? id;
  }
  ```

  Replace with:

  ```ts
  function providerLabel(id: ProviderId): string {
    return ProviderRegistry.getProviderDisplayName(id);
  }
  ```

- [ ] **Step 3: Update `renderDefaultProviderWidget` at `:246`.**

  Replace:

  ```ts
    const enabledIds = PROVIDER_IDS.filter((id) => Boolean(configs?.[id]?.enabled));
  ```

  With:

  ```ts
    const enabledIds = ProviderRegistry.getRegisteredProviderIds().filter(
      (id) => Boolean(configs?.[id]?.enabled),
    );
  ```

- [ ] **Step 4: Run typecheck + lint + the agent-board test.**

  Run: `npm run typecheck && npm run lint && npm run test -- tests/unit/features/settings/registry/fields/agentBoard.test.ts`
  Expected: PASS. `providerLabel` still returns the same string for each provider id; the dropdown ordering now follows registration order, which matches the prior hardcoded sequence for the four registered providers.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/features/settings/registry/fields/agentBoard.ts tests/unit/features/settings/registry/fields/agentBoard.test.ts
  git commit -m "refactor(settings): replace agentBoard provider arrays with ProviderRegistry queries"
  ```

---

## Task 13: Replace `general.ts:96-112` hardcoded `PROVIDERS` tuple

**Files:**
- Modify: `src/features/settings/registry/fields/general.ts:96-112`

- [ ] **Step 1: Add the registry import.**

  At the top of `src/features/settings/registry/fields/general.ts`, add:

  ```ts
  import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
  ```

- [ ] **Step 2: Replace the `PROVIDERS` const and the loop.**

  Replace lines 96-112:

  ```ts
    const PROVIDERS = [
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
      { id: 'opencode', label: 'Opencode' },
      { id: 'cursor', label: 'Cursor' },
    ] as const;

    for (const p of PROVIDERS) {
      r.registerField({
        id: `providerConfigs.${p.id}.enabled`,
        tabId: 'general',
        sectionId: 'providers',
        label: `Enable ${p.label}`,
        type: { kind: 'toggle' },
        default: false,
      });
    }
  ```

  With:

  ```ts
    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      const displayName = ProviderRegistry.getProviderDisplayName(providerId);
      r.registerField({
        id: `providerConfigs.${providerId}.enabled`,
        tabId: 'general',
        sectionId: 'providers',
        label: `Enable ${displayName}`,
        type: { kind: 'toggle' },
        default: false,
      });
    }
  ```

- [ ] **Step 3: Run typecheck + lint + the general-tab test.**

  Run: `npm run typecheck && npm run lint && npm run test -- tests/unit/features/settings/registry/fields/general.test.ts`
  Expected: PASS. The four registered provider ids produce the same four fields in the same order as before.

- [ ] **Step 4: Commit.**

  ```bash
  git add src/features/settings/registry/fields/general.ts
  git commit -m "refactor(settings): register Enable-provider toggles via getRegisteredProviderIds"
  ```

---

## Task 14: Replace `hasAnyProviderEnabled.ts` with registry call

**Files:**
- Modify: `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts`

- [ ] **Step 1: Write the failing test.**

  Open or create `tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts`. Add:

  ```ts
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import { hasAnyProviderEnabled } from '@/features/settings/firstRunBanner/hasAnyProviderEnabled';

  describe('hasAnyProviderEnabled — ordering source', () => {
    it('iterates ProviderRegistry.getRegisteredProviderIds', () => {
      const spy = jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds');
      hasAnyProviderEnabled({ providerConfigs: {} } as never);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts`
  Expected: FAIL — the file uses a local `PROVIDERS` const, so `getRegisteredProviderIds` was not called.

- [ ] **Step 3: Replace the file contents.**

  Replace all of `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts` with:

  ```ts
  import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
  import type { ClaudianSettings } from '../../../core/types/settings';

  export function hasAnyProviderEnabled(settings: ClaudianSettings): boolean {
    for (const id of ProviderRegistry.getRegisteredProviderIds()) {
      const cfg = settings.providerConfigs?.[id] as { enabled?: boolean } | undefined;
      if (cfg?.enabled) return true;
    }
    return false;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts
  git commit -m "refactor(settings): hasAnyProviderEnabled iterates registered providers"
  ```

---

## Task 15: Splice registered provider ids into `SearchResultsView.ts:40`

**Files:**
- Modify: `src/features/settings/search/SearchResultsView.ts:36-47`

- [ ] **Step 1: Add the registry import.**

  At the top of `src/features/settings/search/SearchResultsView.ts`, add:

  ```ts
  import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
  ```

- [ ] **Step 2: Replace the hardcoded `tabOrder` definition at `:39-40`.**

  Replace:

  ```ts
      // Tab order: general, claude, codex, opencode, cursor, agentBoard, orchestrator, diagnostics
      const tabOrder = ['general', 'claude', 'codex', 'opencode', 'cursor', 'agentBoard', 'orchestrator', 'diagnostics'];
  ```

  With:

  ```ts
      // Tab order: general, <registered providers in registration order>, agentBoard, orchestrator, diagnostics.
      // Provider tab ids match provider ids by convention (see registry/providers/registerProviderTab.ts).
      const tabOrder = [
        'general',
        ...ProviderRegistry.getRegisteredProviderIds(),
        'agentBoard',
        'orchestrator',
        'diagnostics',
      ];
  ```

- [ ] **Step 3: Run typecheck + lint + the search test.**

  Run: `npm run typecheck && npm run lint && npm run test -- tests/unit/features/settings/search`
  Expected: PASS. The interleaved tab order still places provider tabs between `general` and `agentBoard`, in registration order.

- [ ] **Step 4: Commit.**

  ```bash
  git add src/features/settings/search/SearchResultsView.ts
  git commit -m "refactor(settings): splice registered provider ids into SearchResultsView tab order"
  ```

---

## Task 16: Delete the stale ESLint `no-restricted-imports` block

**Files:**
- Modify: `eslint.config.mjs:116-144`

- [ ] **Step 1: Verify the stale block matches zero files.**

  Run: `npx eslint --print-config src/main.ts | grep -A5 no-restricted-imports || echo "no rule active for src/main.ts"`
  Expected: the rule is in the config but does not apply to any real file because its `files:` globs are all dead paths.

- [ ] **Step 2: Delete the stale block.**

  Open `eslint.config.mjs`. Delete lines 116-144 (the whole `{ files: [...stale paths...], rules: { 'no-restricted-imports': [...] } }` block).

- [ ] **Step 3: Run lint.**

  Run: `npm run lint`
  Expected: PASS, with **identical** problem count to the pre-change baseline (the block matched zero files, so deleting it changes nothing operationally).

- [ ] **Step 4: Commit.**

  ```bash
  git add eslint.config.mjs
  git commit -m "chore(lint): delete stale no-restricted-imports block (8 globs match zero files)"
  ```

---

## Task 17: Add the scoped provider-boundary `no-restricted-imports` rule

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Insert the new block.**

  Open `eslint.config.mjs`. Add this block AFTER the main `files: ['src/**/*.ts']` block (after the deleted region):

  ```js
    {
      files: ['src/**/*.ts'],
      ignores: [
        // Provider-internal files own their own internals.
        'src/providers/*/**/*.ts',
        // The bootstrap aggregator(s) that call ProviderRegistry.register /
        // ProviderWorkspaceRegistry.register are the one sanctioned outside
        // importer of `src/providers/<id>/registration` and workspace modules.
        'src/providers/index.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/providers/claude/**',
                  '**/providers/codex/**',
                  '**/providers/cursor/**',
                  '**/providers/opencode/**',
                ],
                message:
                  'Provider internals are reachable only through ProviderRegistry / ProviderWorkspaceRegistry. Add a method to ProviderRegistration / ProviderChatUIConfig / ProviderSettingsReconciler instead of importing from src/providers/<id>/. See ADR 0001 § Boundary rule.',
              },
            ],
          },
        ],
      },
    },
  ```

- [ ] **Step 2: Run lint.**

  Run: `npm run lint`
  Expected: PASS. Phase 0 should have removed every outside-provider import, so the new rule should not fire. If it does, **stop and fix the leak** before continuing (do not weaken the rule).

- [ ] **Step 3: Commit.**

  ```bash
  git add eslint.config.mjs
  git commit -m "feat(lint): add scoped provider-boundary no-restricted-imports rule"
  ```

---

## Task 18: Add the boundary-rule synthetic-violation test

**Files:**
- Create: `tests/unit/eslint/boundaryRule.test.ts`

- [ ] **Step 1: Write the test.**

  Create `tests/unit/eslint/boundaryRule.test.ts`:

  ```ts
  import { ESLint } from 'eslint';
  import * as path from 'path';

  const REPO_ROOT = path.resolve(__dirname, '../../..');

  describe('provider boundary ESLint rule', () => {
    it('fires when code outside src/providers/<id>/ imports from src/providers/<id>/', async () => {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const source = "import { something } from '@/providers/claude/runtime/ClaudeChatRuntime';\nexport const x = something;\n";
      const results = await eslint.lintText(source, {
        filePath: path.join(REPO_ROOT, 'src/features/synthetic-boundary-violation.ts'),
      });
      const messages = results[0]?.messages ?? [];
      expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
    });

    it('does not fire when src/providers/index.ts imports a provider registration', async () => {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const source = "import { claudeProviderRegistration } from './claude/registration';\nexport const r = claudeProviderRegistration;\n";
      const results = await eslint.lintText(source, {
        filePath: path.join(REPO_ROOT, 'src/providers/index.ts'),
      });
      const messages = results[0]?.messages ?? [];
      expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
    });

    it('does not fire on intra-provider imports', async () => {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const source = "import { OPENCODE_PLAN_MODE_ID } from '../modes';\nexport const id = OPENCODE_PLAN_MODE_ID;\n";
      const results = await eslint.lintText(source, {
        filePath: path.join(REPO_ROOT, 'src/providers/opencode/env/synthetic.ts'),
      });
      const messages = results[0]?.messages ?? [];
      expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `npm run test -- tests/unit/eslint/boundaryRule.test.ts`
  Expected: PASS — all three assertions hold against the rule added in Task 17.

- [ ] **Step 3: Commit.**

  ```bash
  git add tests/unit/eslint/boundaryRule.test.ts
  git commit -m "test(lint): assert provider boundary rule fires on synthetic violation and skips exemptions"
  ```

---

## Task 19: Add the `setEnabled` round-trip integration test

**Files:**
- Create: `tests/integration/core/providers/setEnabledRoundTrip.test.ts`

- [ ] **Step 1: Write the test.**

  Create `tests/integration/core/providers/setEnabledRoundTrip.test.ts`:

  ```ts
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import type { ProviderId } from '@/core/providers/types';

  // Force all four provider registrations to load before the suite runs.
  import '@/providers';

  describe('ProviderSettingsReconciler.setEnabled — round trip', () => {
    const providers: ProviderId[] = ['claude', 'codex', 'cursor', 'opencode'];

    it.each(providers)('%s: setEnabled(true) then isEnabled returns true', (id) => {
      const settings: Record<string, unknown> = { providerConfigs: { [id]: { enabled: false } } };
      const reconciler = ProviderRegistry.getSettingsReconciler(id);
      reconciler.setEnabled?.(settings, true);
      expect(ProviderRegistry.isEnabled(id, settings)).toBe(true);
    });

    it.each(providers)('%s: setEnabled(false) then isEnabled returns false', (id) => {
      const settings: Record<string, unknown> = { providerConfigs: { [id]: { enabled: true } } };
      const reconciler = ProviderRegistry.getSettingsReconciler(id);
      reconciler.setEnabled?.(settings, false);
      expect(ProviderRegistry.isEnabled(id, settings)).toBe(false);
    });

    it.each(providers)('%s: setEnabled is defined (Phase 0 contract)', (id) => {
      expect(ProviderRegistry.getSettingsReconciler(id).setEnabled).toBeDefined();
    });
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `npm run test -- --selectProjects integration tests/integration/core/providers/setEnabledRoundTrip.test.ts`
  Expected: PASS — all three `it.each` blocks pass for all four providers (Tasks 2-5 supplied the implementations).

  Note: `@/providers` resolves to `src/providers/index.ts` (Jest `moduleNameMapper` maps `@/` → `src/`). That barrel auto-runs `registerBuiltInProviders()` at module load, so the side-effect import is all that is needed.

- [ ] **Step 3: Commit.**

  ```bash
  git add tests/integration/core/providers/setEnabledRoundTrip.test.ts
  git commit -m "test(core): round-trip setEnabled across all four reconcilers"
  ```

---

## Task 20: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full pre-commit verification chain.**

  Run: `npm run typecheck && npm run lint && npm run test && npm run build`
  Expected: all four exit 0.

- [ ] **Step 2: Verify no `providerEnableUpdaters` references remain.**

  Run: `git grep -n "providerEnableUpdaters\|PROVIDER_ENABLE_UPDATERS\|getProviderEnableUpdater" -- 'src/**' 'tests/**'`
  Expected: empty output.

- [ ] **Step 3: Verify no outside-provider imports remain.**

  Run: `git grep -n "from '.*src/providers/" -- 'src/main.ts' 'src/features/**' 'src/core/**' 'src/app/**' 'src/shared/**' 'src/i18n/**' 'src/utils/**' 'src/style/**'`
  Expected: empty output. (Imports from `src/providers/index.ts` are inside `src/providers/`, exempt.)

- [ ] **Step 4: Verify no hardcoded `['claude','codex','opencode','cursor']` arrays remain in feature/settings code.**

  Run: `git grep -n "'claude'.*'codex'.*'opencode'.*'cursor'" -- 'src/features/**' 'src/core/**' 'src/app/**'`
  Expected: empty output. (Test files may still contain the literal — that is fine.)

- [ ] **Step 5: Verify `main.ts` no longer imports `OPENCODE_PLAN_MODE_ID` / `OPENCODE_SAFE_MODE_ID`.**

  Run: `git grep -n "OPENCODE_PLAN_MODE_ID\|OPENCODE_SAFE_MODE_ID" -- 'src/main.ts'`
  Expected: empty output.

- [ ] **Step 6: Smoke-test the Obsidian plugin manually.**

  Reload the Obsidian dev vault. Open Settings → Claudian. For each provider, toggle Enable off and back on. Verify the corresponding provider settings tab appears and disappears as the toggle changes, and that the toggle state survives a plugin restart (reload Obsidian).

  Open Opencode settings. Confirm the "Selected mode" dropdown lists the same modes as before the refactor.

  Force-set `providerConfigs.opencode.selectedMode` to `'plan'` in `.claudian/claudian-settings.json` (with Obsidian closed). Reopen Obsidian; reload the plugin. Confirm the value is rewritten to the safe-mode id at load time.

- [ ] **Step 7: Final commit (if any cleanup is needed) and push.**

  ```bash
  git status
  # If clean, no further commit needed.
  git log --oneline -20  # sanity check
  ```

  Hand off to the user for PR creation (do not push without an explicit request).

---

## Spec-coverage self-review

Mapping every ADR-0001 Move 1 obligation to the task that implements it:

| Move 1 obligation | Task |
|---|---|
| `setEnabled?` on `ProviderSettingsReconciler` | 1 (type) + 2-5 (impls) |
| Migrate settings-tab toggle off `providerEnableUpdaters.ts`; delete shim | 6 |
| `getAvailableModes?` on `ProviderChatUIConfig` | 7 (type) + 8 (impl) |
| Route `registry/fields/opencode.ts` through accessor; delete `getOpencodeProviderSettings` import | 9 |
| `normalizeOnLoad` for plan→safe; delete `main.ts:64,701-709` | 10 |
| Replace `defaultProviderResolver.ts` ORDER → `getEnabledProviderIds()` (preference-ordered) | 11 |
| Replace `agentBoard.ts` `PROVIDER_IDS`/`PROVIDER_LABELS` | 12 |
| Replace `general.ts` PROVIDERS tuple | 13 |
| Replace `hasAnyProviderEnabled.ts` PROVIDERS array | 14 |
| Splice `SearchResultsView.ts:40` tabOrder | 15 |
| Delete stale ESLint `no-restricted-imports` block (8 paths) | 16 |
| Add scoped boundary rule with three exemptions | 17 |
| Boundary-rule synthetic-violation test | 18 |
| `setEnabled` round-trip integration test | 19 |
| Mode-options accessor regression test | 8 (unit test included) |
| Full verification + manual smoke | 20 |

**Explicitly deferred (not in Phase 0):**
- `FirstRunBanner.ts:4-9` — per-provider UI copy (`blurb`, `cli`), not a pure id list. Move to registration if/when first-run copy becomes provider-owned (Phase 1 candidate).
- ~36 `?? DEFAULT_CHAT_PROVIDER_ID` fallback chains — correct as-is.
- Migration-backfill literals in `ConversationStore.ts:55,104` and `SessionStorage.ts:80` — must stay literal `'claude'` for legacy session metadata.

