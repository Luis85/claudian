---
title: Remove the Orchestrator feature Implementation Plan
date: 2026-06-06
status: ready-for-review
parent: "[[2026-06-06-remove-orchestrator-feature-design]]"
---

# Remove the Orchestrator Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-remove Orchestrator so no active chat, provider, settings, i18n, test, style, or product-doc surface can expose or use it, while stale serialized keys remain inert legacy data.

**Architecture:** Remove Orchestrator vertically: settings/user-facing entry points first, then chat state/UI/service wiring, then provider prompt plumbing, then docs/styles/tests. Preserve normal chat, provider-native plan mode, and Agent Board execution by deleting only Orchestrator-specific seams and proving no active references remain outside archival/spec/plan files.

**Tech Stack:** TypeScript, Jest, Obsidian Plugin API, Claudian provider/runtime abstractions, settings registry, i18n JSON locale files, Markdown product docs.

---

## Branch setup

Implement in a fresh worktree after this plan/spec branch is merged or explicitly chosen as the base.

```powershell
git status --short --branch
git fetch origin main --prune
git worktree add .worktrees/remove-orchestrator-feature -b codex/remove-orchestrator-feature origin/main
cd .worktrees/remove-orchestrator-feature
npm install
```

Expected: clean worktree; dependencies installed or already current.

## File map

Delete Orchestrator-only source:

- `src/core/prompt/orchestratorMode.ts`
- `src/features/chat/rendering/InlineOrchestratorPlan.ts`
- `src/features/chat/rendering/orchestratorPlanParser.ts`
- `src/features/chat/services/OrchestratorService.ts`
- `src/features/chat/ui/OrchestratorGoalModal.ts`
- `src/features/chat/ui/orchestratorModeUi.ts`
- `src/features/settings/registry/fields/orchestrator.ts`
- `src/features/settings/ui/OrchestratorSettingsTab.ts`
- `src/providers/cursor/prompt/cursorOrchestratorPrompt.ts`

Delete Orchestrator-only styles:

- `src/style/features/orchestrator-goal-modal.css`
- `src/style/features/orchestrator-plan.css`
- `src/style/settings/orchestrator-settings.css`
- `src/style/toolbar/orchestrator-toggle.css`

Modify active code:

- Settings: `src/app/settings/defaultSettings.ts`, `src/core/types/settings.ts`, `src/features/settings/ClaudianSettings.ts`, `src/features/settings/registry/featureFlag.ts`, `src/features/settings/registry/registerAll.ts`, `src/features/settings/search/SearchResultsView.ts`
- Chat/types: `src/core/types/chat.ts`, `src/core/runtime/types.ts`, `src/core/types/PluginContext.ts`, `src/app/conversations/ConversationStore.ts`, `src/main.ts`, `src/features/chat/**`
- Providers/prompts: `src/core/prompt/mainAgent.ts`, `src/providers/{claude,codex,opencode,cursor}/**`
- UI/i18n/docs: `src/style/index.css`, `src/style/components/tabs.css`, `src/i18n/types.ts`, `src/i18n/locales/*.json`, Agent Board/product docs

Delete Orchestrator-only tests:

- `tests/unit/core/prompt/orchestratorMode.test.ts`
- `tests/unit/features/chat/rendering/orchestratorPlanParser.test.ts`
- `tests/unit/features/chat/services/OrchestratorService.test.ts`
- `tests/unit/features/settings/registry/fields/orchestrator.test.ts`
- `tests/unit/providers/cursor/prompt/cursorOrchestratorPrompt.test.ts`

Modify tests that currently mention Orchestrator:

- `tests/integration/settings/_portTestHelpers.ts`
- `tests/unit/features/chat/controllers/StreamController.test.ts`
- `tests/unit/features/chat/tabs/TabBar.test.ts`
- `tests/unit/features/settings/registry/featureFlag.test.ts`
- `tests/unit/features/settings/registry/registerAll.test.ts`
- `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`

---

### Task 1: Settings removal tests

**Files:**
- Modify: `tests/unit/features/settings/registry/featureFlag.test.ts`
- Modify: `tests/unit/features/settings/registry/registerAll.test.ts`
- Delete: `tests/unit/features/settings/registry/fields/orchestrator.test.ts`

- [ ] **Step 1: Change feature-flag expectations**

Use this assertion body:

```typescript
import { useRegistryRenderer } from '@/features/settings/registry/featureFlag';

describe('settings registry feature flags', () => {
  it('does not registry-render Orchestrator settings', () => {
    expect(useRegistryRenderer('agentBoard')).toBe(true);
    expect(useRegistryRenderer('diagnostics')).toBe(true);
    expect(useRegistryRenderer('orchestrator')).toBe(false);
  });
});
```

- [ ] **Step 2: Change register-all expectations**

Keep the existing registry reset helper from the current test file, then assert:

```typescript
registerAllSettings();
const registry = getSettingsRegistry();
expect(registry.getTabs().map((tab) => tab.id)).not.toContain('orchestrator');
expect(registry.getFields().map((field) => field.id)).not.toContain('orchestratorEnabled');
expect(registry.getFields().map((field) => field.id)).not.toContain('orchestratorSystemPrompt');
```

If the existing registry API uses different accessor names, keep the file's current accessors and keep these three assertions.

- [ ] **Step 3: Delete the Orchestrator settings-field test**

```powershell
Remove-Item -LiteralPath 'tests/unit/features/settings/registry/fields/orchestrator.test.ts'
```

- [ ] **Step 4: Run focused tests and confirm red**

```powershell
npm run test -- --selectProjects unit -t "settings registry"
```

Expected before implementation: FAIL because Orchestrator is still registered.

- [ ] **Step 5: Commit**

```powershell
git add tests/unit/features/settings/registry/featureFlag.test.ts tests/unit/features/settings/registry/registerAll.test.ts
git add -u tests/unit/features/settings/registry/fields/orchestrator.test.ts
git commit -m "test(settings): expect orchestrator settings removal"
```

---

### Task 2: Remove active settings surface

**Files:**
- Modify: `src/app/settings/defaultSettings.ts`
- Modify: `src/core/types/settings.ts`
- Modify: `src/features/settings/ClaudianSettings.ts`
- Modify: `src/features/settings/registry/featureFlag.ts`
- Modify: `src/features/settings/registry/registerAll.ts`
- Modify: `src/features/settings/search/SearchResultsView.ts`
- Delete: `src/features/settings/registry/fields/orchestrator.ts`
- Delete: `src/features/settings/ui/OrchestratorSettingsTab.ts`

- [ ] **Step 1: Remove defaults and active type fields**

Delete from `defaultSettings.ts`:

```typescript
orchestratorEnabled: true,
orchestratorSystemPrompt: '',
```

Delete from `settings.ts`:

```typescript
orchestratorEnabled?: boolean;
orchestratorSystemPrompt?: string;
```

- [ ] **Step 2: Remove settings tab wiring**

In `ClaudianSettings.ts`, delete the `renderOrchestratorSettingsTab` import, remove `'orchestrator'` from `tabIds`, remove the Orchestrator label branch, and delete the block that renders `orchestratorContent`.

- [ ] **Step 3: Remove registry wiring**

In `registerAll.ts`, delete the Orchestrator import and `registerOrchestratorTabFields()` call.

In `featureFlag.ts`, make the registry set:

```typescript
export const REGISTRY_TABS: ReadonlySet<string> = new Set<string>([
  'agentBoard',
  'diagnostics',
]);
```

- [ ] **Step 4: Delete Orchestrator settings modules**

```powershell
Remove-Item -LiteralPath 'src/features/settings/registry/fields/orchestrator.ts'
Remove-Item -LiteralPath 'src/features/settings/ui/OrchestratorSettingsTab.ts'
```

- [ ] **Step 5: Remove settings search traces**

In `SearchResultsView.ts`, remove Orchestrator from comments/order logic. Expected comment if present:

```typescript
// Tab order: general, <registered providers in registration order>, agentBoard, diagnostics.
```

- [ ] **Step 6: Verify settings no-trace**

```powershell
npm run test -- --selectProjects unit -t "settings registry"
rg -n "orchestrator|Orchestrator" src/app/settings src/core/types/settings.ts src/features/settings
```

Expected: tests PASS; grep has no output.

- [ ] **Step 7: Commit**

```powershell
git add src/app/settings/defaultSettings.ts src/core/types/settings.ts src/features/settings/ClaudianSettings.ts src/features/settings/registry/featureFlag.ts src/features/settings/registry/registerAll.ts src/features/settings/search/SearchResultsView.ts
git add -u src/features/settings/registry/fields/orchestrator.ts src/features/settings/ui/OrchestratorSettingsTab.ts
git commit -m "refactor(settings): remove orchestrator settings surface"
```

---

### Task 3: Chat removal tests

**Files:**
- Modify: `tests/unit/features/chat/controllers/StreamController.test.ts`
- Modify: `tests/unit/features/chat/tabs/TabBar.test.ts`
- Delete: `tests/unit/features/chat/rendering/orchestratorPlanParser.test.ts`
- Delete: `tests/unit/features/chat/services/OrchestratorService.test.ts`

- [ ] **Step 1: Delete Orchestrator-only chat tests**

```powershell
Remove-Item -LiteralPath 'tests/unit/features/chat/rendering/orchestratorPlanParser.test.ts'
Remove-Item -LiteralPath 'tests/unit/features/chat/services/OrchestratorService.test.ts'
```

- [ ] **Step 2: Remove StreamController Orchestrator plan-detection cases**

Delete tests that expect `onOrchestratorPlanDetected` or `extractOrchestratorPlan`. Add one regression using the existing stream helper:

```typescript
it('does not treat old orchestrator plan JSON as a special action surface', async () => {
  const content = '```json\n{"tasks":[{"title":"A","prompt":"Do A"}]}\n```';
  await streamText(content);
  expect(renderedAssistantText()).toContain('"tasks"');
  expect(renderedAssistantText()).toContain('Do A');
});
```

Adapt `streamText` and `renderedAssistantText` to the helper names already present in the file.

- [ ] **Step 3: Remove TabBar Orchestrator styling cases**

Delete parent/worker Orchestrator tab expectations. Add an ordinary streaming-tab assertion with the file's existing render helpers:

```typescript
expect(tab.classList.contains('claudian-tab-working')).toBe(true);
expect(tab.className).not.toContain('orchestrator');
```

- [ ] **Step 4: Run focused tests and confirm red**

```powershell
npm run test -- --selectProjects unit -t "StreamController|TabBar"
```

Expected before implementation: FAIL until active Orchestrator code is removed.

- [ ] **Step 5: Commit**

```powershell
git add tests/unit/features/chat/controllers/StreamController.test.ts tests/unit/features/chat/tabs/TabBar.test.ts
git add -u tests/unit/features/chat/rendering/orchestratorPlanParser.test.ts tests/unit/features/chat/services/OrchestratorService.test.ts
git commit -m "test(chat): expect orchestrator chat surface removal"
```

---

### Task 4: Remove chat Orchestrator state, UI, and services

**Files:**
- Modify: `src/core/types/chat.ts`, `src/core/runtime/types.ts`, `src/core/types/PluginContext.ts`, `src/app/conversations/ConversationStore.ts`, `src/main.ts`
- Modify: `src/features/chat/ClaudianView.ts`, `src/features/chat/state/*`, `src/features/chat/controllers/*`, `src/features/chat/tabs/*`, `src/features/chat/ui/InputToolbar.ts`
- Delete: `src/features/chat/rendering/InlineOrchestratorPlan.ts`, `src/features/chat/rendering/orchestratorPlanParser.ts`, `src/features/chat/services/OrchestratorService.ts`, `src/features/chat/ui/OrchestratorGoalModal.ts`, `src/features/chat/ui/orchestratorModeUi.ts`

- [ ] **Step 1: Remove active type/state fields**

Delete active `orchestratorMode?: boolean` and `pendingOrchestratorMode` fields from chat, runtime, plugin-context, conversation-store, and chat-state types/defaults. Do not add a migration.

- [ ] **Step 2: Remove controller plumbing**

In `ConversationController`, `InputController`, and `StreamController`, delete every branch/property/import for `orchestratorMode`, `pendingOrchestratorMode`, `OrchestratorService`, `extractOrchestratorPlan`, and `InlineOrchestratorPlan`. A send request must no longer include:

```typescript
orchestratorMode: conversation?.orchestratorMode === true
```

- [ ] **Step 3: Remove UI construction and tab exceptions**

Remove `orchestratorToggle`, `syncOrchestratorModeUI`, Orchestrator goal-modal launch code, parent/worker tab styling inputs, and Orchestrator-only worker-tab/max-tab-bypass APIs. Keep normal tab creation and Agent Board chat-tab opening intact.

- [ ] **Step 4: Delete Orchestrator chat modules**

```powershell
Remove-Item -LiteralPath 'src/features/chat/rendering/InlineOrchestratorPlan.ts'
Remove-Item -LiteralPath 'src/features/chat/rendering/orchestratorPlanParser.ts'
Remove-Item -LiteralPath 'src/features/chat/services/OrchestratorService.ts'
Remove-Item -LiteralPath 'src/features/chat/ui/OrchestratorGoalModal.ts'
Remove-Item -LiteralPath 'src/features/chat/ui/orchestratorModeUi.ts'
```

If `assistantReportText.ts` has no references after cleanup, delete it too.

- [ ] **Step 5: Verify chat cleanup**

```powershell
npm run test -- --selectProjects unit -t "StreamController|TabBar"
npm run typecheck
```

Expected: PASS. Typecheck failures for deleted Orchestrator imports must be fixed before commit.

- [ ] **Step 6: Commit**

```powershell
git add src/core/types/chat.ts src/core/runtime/types.ts src/core/types/PluginContext.ts src/app/conversations/ConversationStore.ts src/main.ts src/features/chat
git add -u src/features/chat/rendering/InlineOrchestratorPlan.ts src/features/chat/rendering/orchestratorPlanParser.ts src/features/chat/services/OrchestratorService.ts src/features/chat/ui/OrchestratorGoalModal.ts src/features/chat/ui/orchestratorModeUi.ts
git commit -m "refactor(chat): remove orchestrator mode and UI"
```

---

### Task 5: Provider prompt removal

**Files:**
- Delete: `tests/unit/core/prompt/orchestratorMode.test.ts`, `tests/unit/providers/cursor/prompt/cursorOrchestratorPrompt.test.ts`
- Modify: `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`
- Modify: `src/core/prompt/mainAgent.ts`
- Delete: `src/core/prompt/orchestratorMode.ts`
- Modify: provider runtime/prompt files listed in the file map
- Delete: `src/providers/cursor/prompt/cursorOrchestratorPrompt.ts`

- [ ] **Step 1: Delete prompt-specific tests**

```powershell
Remove-Item -LiteralPath 'tests/unit/core/prompt/orchestratorMode.test.ts'
Remove-Item -LiteralPath 'tests/unit/providers/cursor/prompt/cursorOrchestratorPrompt.test.ts'
```

- [ ] **Step 2: Update Cursor runtime fixtures**

In `CursorChatRuntime.test.ts`, remove `orchestratorSystemPrompt: ''` and any `orchestratorMode` request fixtures. If the test captures the serialized prompt, add:

```typescript
expect(serializedPrompt).not.toContain('orchestrator');
expect(serializedPrompt).not.toContain('parallel workers');
```

- [ ] **Step 3: Remove shared/provider prompt plumbing**

Delete Orchestrator imports/calls from `mainAgent.ts`; delete `orchestratorMode.ts`; remove `currentOrchestratorMode`, `orchestratorMode?: boolean`, `orchestratorPromptOptions`, and Cursor prompt appender calls from Claude, Codex, Opencode, and Cursor runtime/prompt files.

- [ ] **Step 4: Delete Cursor appender module**

```powershell
Remove-Item -LiteralPath 'src/providers/cursor/prompt/cursorOrchestratorPrompt.ts'
```

- [ ] **Step 5: Verify providers**

```powershell
npm run test -- --selectProjects unit -t "CursorChatRuntime|ClaudeChatRuntime|CodexChatRuntime|OpencodeChatRuntime"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/core/prompt/mainAgent.ts src/providers tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts
git add -u src/core/prompt/orchestratorMode.ts src/providers/cursor/prompt/cursorOrchestratorPrompt.ts tests/unit/core/prompt/orchestratorMode.test.ts tests/unit/providers/cursor/prompt/cursorOrchestratorPrompt.test.ts
git commit -m "refactor(providers): remove orchestrator prompt plumbing"
```

---

### Task 6: Styles and i18n cleanup

**Files:**
- Modify/delete style files listed in the file map
- Modify: `src/i18n/types.ts`, `src/i18n/locales/*.json`

- [ ] **Step 1: Remove CSS imports and files**

Delete Orchestrator imports from `src/style/index.css`, delete Orchestrator tab block from `src/style/components/tabs.css`, then run:

```powershell
Remove-Item -LiteralPath 'src/style/features/orchestrator-goal-modal.css'
Remove-Item -LiteralPath 'src/style/features/orchestrator-plan.css'
Remove-Item -LiteralPath 'src/style/settings/orchestrator-settings.css'
Remove-Item -LiteralPath 'src/style/toolbar/orchestrator-toggle.css'
```

- [ ] **Step 2: Remove i18n keys**

Delete Orchestrator translation types and locale keys from `src/i18n/types.ts` and every `src/i18n/locales/*.json`.

- [ ] **Step 3: Verify styles/locales**

```powershell
rg -n "orchestrator|Orchestrator" src/style src/i18n
node -e "const fs=require('fs'); for (const f of fs.readdirSync('src/i18n/locales').filter(f=>f.endsWith('.json'))) JSON.parse(fs.readFileSync('src/i18n/locales/'+f,'utf8')); console.log('locales ok')"
npm run typecheck
```

Expected: grep has no output; `locales ok`; typecheck PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/style/index.css src/style/components/tabs.css src/i18n/types.ts src/i18n/locales
git add -u src/style/features/orchestrator-goal-modal.css src/style/features/orchestrator-plan.css src/style/settings/orchestrator-settings.css src/style/toolbar/orchestrator-toggle.css
git commit -m "refactor(ui): remove orchestrator styles and translations"
```

---

### Task 7: Product docs cleanup

**Files:**
- Modify: `docs/product/features/Agent Kanban Board.md`
- Delete or archive: `docs/product/features/Orchestrator.md`, `docs/product/user-manuals/orchestrator.md`, `docs/examples/orchestrator-e2e-test-prompt.md`
- Modify: `docs/ideas/Integrate the Orchestrator with the Agent Board.md`, `docs/issues/integrate-orchestrator-with-agent-board.md`

- [ ] **Step 1: Remove Agent Board companion links**

In `Agent Kanban Board.md`, remove `[[Orchestrator]]` from frontmatter `related` and remove the `Goes well with` bullet that starts with `[[Orchestrator]]`.

- [ ] **Step 2: Remove active Orchestrator docs**

```powershell
Remove-Item -LiteralPath 'docs/product/features/Orchestrator.md'
Remove-Item -LiteralPath 'docs/product/user-manuals/orchestrator.md'
Remove-Item -LiteralPath 'docs/examples/orchestrator-e2e-test-prompt.md'
```

If archival is preferred, move these to `docs/archive/orchestrator/` with `status: archived`; do not leave them under active product/manual paths.

- [ ] **Step 3: Mark integration records superseded**

Add this sentence near the top of both integration idea/issue records:

```markdown
Superseded by [[2026-06-06-remove-orchestrator-feature-design]]: Orchestrator will be removed instead of integrated with Agent Board.
```

- [ ] **Step 4: Audit docs**

```powershell
rg -n "\[\[Orchestrator\]\]|orchestrator-e2e|Orchestrator" docs
```

Expected remaining matches are limited to archival records, the idea seed, and superpowers spec/plan files. No match should present Orchestrator as an active product feature.

- [ ] **Step 5: Commit**

```powershell
git add 'docs/product/features/Agent Kanban Board.md' 'docs/ideas/Integrate the Orchestrator with the Agent Board.md' 'docs/issues/integrate-orchestrator-with-agent-board.md'
git add -u 'docs/product/features/Orchestrator.md' 'docs/product/user-manuals/orchestrator.md' 'docs/examples/orchestrator-e2e-test-prompt.md'
git commit -m "docs: remove active orchestrator product docs"
```

---

### Task 8: Repository-wide residue audit

**Files:** any active file reported below.

- [ ] **Step 1: Audit source/test residue**

```powershell
rg -n "orchestrator|Orchestrator" src tests
```

Expected: no output, except a deliberately named legacy-tolerance test if one was necessary.

- [ ] **Step 2: Audit settings no-trace gate**

```powershell
rg -n "orchestrator|Orchestrator" src/app/settings src/core/types/settings.ts src/features/settings src/i18n
```

Expected: no output. This is the hard gate for the user's no-settings-trace requirement.

- [ ] **Step 3: Add legacy-load test only if needed**

If conversation loading has a normalizer test seam, add a test proving old `orchestratorMode: true` is ignored:

```typescript
it('ignores legacy orchestratorMode when loading old conversation metadata', () => {
  const loaded = normalizeConversationForTest({
    id: 'legacy-conversation',
    title: 'Legacy',
    providerId: 'claude',
    orchestratorMode: true,
  });
  expect(loaded.id).toBe('legacy-conversation');
  expect('orchestratorMode' in loaded).toBe(false);
});
```

Use the existing normalize/load helper. If there is no seam and loading is plain JSON, skip this test and cover old data in manual smoke.

- [ ] **Step 4: Typecheck and commit residue fixes**

```powershell
npm run typecheck
git status --short
```

Expected: typecheck PASS. If files changed:

```powershell
git add <changed-files>
git commit -m "chore: remove remaining orchestrator references"
```

---

### Task 9: Full verification and manual smoke

**Files:** none unless small fixes are needed.

- [ ] **Step 1: Run full automated gate**

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all four commands exit 0.

- [ ] **Step 2: Manual settings smoke**

Open Claudian settings. Confirm there is no Orchestrator tab. Search settings for `orchestrator`. Confirm there are no Orchestrator search results, labels, toggles, or prompt fields.

- [ ] **Step 3: Manual chat smoke**

Open chat. Confirm there is no Orchestrator toolbar toggle. Send a normal message and confirm response streaming. View or paste an old Orchestrator-looking JSON block and confirm it renders as ordinary text.

- [ ] **Step 4: Manual Agent Board smoke**

Run a ready Agent Board work order. Confirm it opens/uses a normal chat tab and ledger/handoff behavior remains unchanged.

- [ ] **Step 5: Update PR body with verification**

```markdown
## Verification

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`

## Manual smoke

- [x] Settings search has no Orchestrator tab/results/fields.
- [x] Chat has no Orchestrator toggle and normal send/stream works.
- [x] Old Orchestrator-looking JSON renders as ordinary text.
- [x] Agent Board work-order run still opens and completes through normal chat execution.
```

---

## Self-Review

Spec coverage:

- Hard removal: Tasks 2, 4, 5, 6 delete active modules and remove wiring.
- No settings trace: Tasks 1, 2, 6, and 8 remove defaults, types, UI, registry/search, and i18n, then enforce no-output greps.
- Legacy data inert: Tasks 4 and 8 avoid migration and optionally add a legacy-load assertion.
- Chat UI removed: Tasks 3 and 4 remove toggle, goal modal, plan card, parent/worker tab state, and worker-tab bypass.
- Provider prompt paths removed: Task 5 removes shared and provider-specific prompt plumbing.
- Docs direction: Task 7 removes active product docs and Agent Board companion references.
- Verification: Task 9 includes full automated gate and manual smoke.

Red-flag scan: no banned filler terms remain. Conditional steps include concrete commands and expected outcomes.

Type consistency: `orchestratorEnabled`, `orchestratorSystemPrompt`, and `orchestratorMode` are consistently removed active fields; legacy tolerance consistently means ignored unknown data, not migration.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-remove-orchestrator-feature.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

