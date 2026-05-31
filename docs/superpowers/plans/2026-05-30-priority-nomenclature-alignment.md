# Priority Nomenclature Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify priority labels across docs and tasks code to use `0 - urgent`, `1 - high`, `2 - normal`, `3 - low` everywhere.

**Architecture:** Update type union to new 4-level string format with numeric prefix. Replace sort rank map with prefix parsing. Update all dropdowns, presets, and tests. Leave existing work-order notes untouched (user migrates manually).

**Tech Stack:** TypeScript, Obsidian API, Jest/Vitest tests

---

## Phase 1: Type System & Validation

### Task 1: Update TaskPriority type definition

**Files:**
- Modify: `src/features/tasks/model/taskTypes.ts:15`
- Test: `src/features/tasks/model/taskTypes.ts` (type check only, no runtime test)

- [ ] **Step 1: Locate the current type**

File: `src/features/tasks/model/taskTypes.ts` line 15

Current:
```typescript
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
```

- [ ] **Step 2: Update to new nomenclature**

Replace line 15:
```typescript
export type TaskPriority = '0 - urgent' | '1 - high' | '2 - normal' | '3 - low';
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors (type is used consistently; we'll fix all usages in later tasks).

- [ ] **Step 4: Commit type change**

```bash
git add src/features/tasks/model/taskTypes.ts
git commit -m "refactor(tasks): update TaskPriority type to prefixed 4-level scheme"
```

---

### Task 2: Update VALID_PRIORITIES set

**Files:**
- Modify: `src/features/tasks/templates/TemplateNoteStore.ts:8`

- [ ] **Step 1: Locate the set**

File: `src/features/tasks/templates/TemplateNoteStore.ts` line 8

Current:
```typescript
const VALID_PRIORITIES: ReadonlySet<TaskPriority> = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);
```

- [ ] **Step 2: Update set contents**

Replace line 8:
```typescript
const VALID_PRIORITIES: ReadonlySet<TaskPriority> = new Set<TaskPriority>(['0 - urgent', '1 - high', '2 - normal', '3 - low']);
```

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/templates/TemplateNoteStore.ts
git commit -m "refactor(tasks): update VALID_PRIORITIES set to new nomenclature"
```

---

### Task 3: Update templateResolution fallback

**Files:**
- Modify: `src/features/tasks/templates/templateResolution.ts:70`

- [ ] **Step 1: Locate the fallback**

File: `src/features/tasks/templates/templateResolution.ts` line 70

Current:
```typescript
return priority && VALID_PRIORITIES.has(priority) ? priority : 'normal';
```

- [ ] **Step 2: Update fallback value**

Replace line 70:
```typescript
return priority && VALID_PRIORITIES.has(priority) ? priority : '2 - normal';
```

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/templates/templateResolution.ts
git commit -m "refactor(tasks): update templateResolution fallback to new format"
```

---

### Task 4: Update taskCommands default

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts:87`

- [ ] **Step 1: Locate the default**

File: `src/features/tasks/commands/taskCommands.ts` line 87

Current:
```typescript
const priority = args.priority ?? 'normal';
```

- [ ] **Step 2: Update default**

Replace line 87:
```typescript
const priority = args.priority ?? '2 - normal';
```

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts
git commit -m "refactor(tasks): update taskCommands default priority to new format"
```

---

## Phase 2: Sort Logic

### Task 5: Replace rank map with prefix parsing

**Files:**
- Modify: `src/features/tasks/execution/selectNextReadyTask.ts:1-10`
- Test: `tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`

- [ ] **Step 1: Locate the rank map**

File: `src/features/tasks/execution/selectNextReadyTask.ts` lines 1-5

Current:
```typescript
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function selectNextReadyTask(
  tasks: WorkOrder[],
): WorkOrder | undefined {
```

- [ ] **Step 2: Remove rank map and update sort comparator**

Replace the rank map definition and its usage in the sort:

**Before:**
```typescript
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function selectNextReadyTask(
  tasks: WorkOrder[],
): WorkOrder | undefined {
  const ready = tasks.filter((t) => t.frontmatter.status === 'ready');
  if (ready.length === 0) return undefined;

  const sorted = ready.sort((a, b) => {
    const aPriority = PRIORITY_RANK[a.frontmatter.priority] ?? Infinity;
    const bPriority = PRIORITY_RANK[b.frontmatter.priority] ?? Infinity;
    return aPriority - bPriority;
  });
  return sorted[0];
}
```

**After:**
```typescript
function getPriorityRank(priority: TaskPriority): number {
  const rank = parseInt(priority, 10);
  return Number.isNaN(rank) ? Number.POSITIVE_INFINITY : rank;
}

export function selectNextReadyTask(
  tasks: WorkOrder[],
): WorkOrder | undefined {
  const ready = tasks.filter((t) => t.frontmatter.status === 'ready');
  if (ready.length === 0) return undefined;

  const sorted = ready.sort((a, b) => {
    const aPriority = getPriorityRank(a.frontmatter.priority);
    const bPriority = getPriorityRank(b.frontmatter.priority);
    return aPriority - bPriority;
  });
  return sorted[0];
}
```

- [ ] **Step 3: Check existing tests**

Run:
```bash
npm run test -- --testPathPattern=selectNextReadyTask
```

Expected: Tests should still pass (parseint('0') = 0, parseInt('1') = 1, etc.)

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/execution/selectNextReadyTask.ts
git commit -m "refactor(tasks): replace priority rank map with prefix parsing"
```

---

## Phase 3: UI Dropdowns & Presets

### Task 6: Update WorkOrderDetailModal dropdown

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts:34, 144-146`

- [ ] **Step 1: Locate dropdown definition**

File: `src/features/tasks/ui/WorkOrderDetailModal.ts` line 34

Current:
```typescript
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
```

- [ ] **Step 2: Update options array**

Replace line 34:
```typescript
const PRIORITY_OPTIONS: TaskPriority[] = ['0 - urgent', '1 - high', '2 - normal', '3 - low'];
```

- [ ] **Step 3: Locate dropdown render**

File: `src/features/tasks/ui/WorkOrderDetailModal.ts` lines 144-146

Current:
```typescript
PRIORITY_OPTIONS.forEach((priority) => {
  dropdown.addOption(priority, priority);
});
```

No change needed (already renders raw value).

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/WorkOrderDetailModal.ts
git commit -m "refactor(tasks): update WorkOrderDetailModal priority options to new format"
```

---

### Task 7: Update WorkOrderTemplateEditorModal dropdown

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderTemplateEditorModal.ts:12-18`

- [ ] **Step 1: Locate dropdown definition**

File: `src/features/tasks/ui/WorkOrderTemplateEditorModal.ts` lines 12-18

Current:
```typescript
const PRIORITY_OPTIONS: Array<{ value: '' | TaskPriority; label: string }> = [
  { value: '', label: 'Use default' },
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];
```

- [ ] **Step 2: Update to new nomenclature (lowercase labels match stored values)**

Replace lines 12-18:
```typescript
const PRIORITY_OPTIONS: Array<{ value: '' | TaskPriority; label: string }> = [
  { value: '', label: 'Use default' },
  { value: '0 - urgent', label: '0 - urgent' },
  { value: '1 - high', label: '1 - high' },
  { value: '2 - normal', label: '2 - normal' },
  { value: '3 - low', label: '3 - low' },
];
```

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/WorkOrderTemplateEditorModal.ts
git commit -m "refactor(tasks): update WorkOrderTemplateEditorModal priority options to new format"
```

---

### Task 8: Update preset templates

**Files:**
- Modify: `src/features/tasks/templates/presetTemplates.ts:143-186`

- [ ] **Step 1: Locate preset definitions**

File: `src/features/tasks/templates/presetTemplates.ts` lines 143-186

- [ ] **Step 2: Update each preset priority value**

Find and replace all priority values in presets:

**Bug fix preset** (around line 145):
- Find: `priority: 'high',`
- Replace: `priority: '1 - high',`

**Feature preset** (around line 152):
- Find: `priority: 'normal',`
- Replace: `priority: '2 - normal',`

**Refactor preset** (around line 159):
- Find: `priority: 'normal',`
- Replace: `priority: '2 - normal',`

**Research spike preset** (around line 166):
- Find: `priority: 'normal',`
- Replace: `priority: '2 - normal',`

**Documentation preset** (around line 173):
- Find: `priority: 'low',`
- Replace: `priority: '3 - low',`

**Test backfill preset** (around line 180):
- Find: `priority: 'normal',`
- Replace: `priority: '2 - normal',`

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/templates/presetTemplates.ts
git commit -m "refactor(tasks): update preset template priorities to new nomenclature"
```

---

## Phase 4: Tests

### Task 9: Update templateResolution tests

**Files:**
- Modify: `tests/unit/features/tasks/templates/templateResolution.test.ts`

- [ ] **Step 1: Locate test file and current assertions**

File: `tests/unit/features/tasks/templates/templateResolution.test.ts`

Find all assertions with old priority values.

- [ ] **Step 2: Update all priority test values**

Search and replace in this file:
- `'low'` → `'3 - low'`
- `'normal'` → `'2 - normal'`
- `'high'` → `'1 - high'`
- `'urgent'` → `'0 - urgent'`

Example of what to find:
```typescript
expect(resolvePriority({ priority: 'low' })).toBe('low');
expect(resolvePriority({ priority: 'high' })).toBe('high');
expect(resolvePriority({ priority: 'urgent' })).toBe('urgent');
```

Replace with:
```typescript
expect(resolvePriority({ priority: '3 - low' })).toBe('3 - low');
expect(resolvePriority({ priority: '1 - high' })).toBe('1 - high');
expect(resolvePriority({ priority: '0 - urgent' })).toBe('0 - urgent');
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern=templateResolution
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/features/tasks/templates/templateResolution.test.ts
git commit -m "test(tasks): update templateResolution test fixtures to new priority format"
```

---

### Task 10: Update TemplateNoteStore tests

**Files:**
- Modify: `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`

- [ ] **Step 1: Find all priority test values**

File: `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`

Search for frontmatter snippets with `priority:` and assertion lines checking priority.

- [ ] **Step 2: Update all priority values in fixtures and assertions**

Replace all old values:
- `priority: low` → `priority: 3 - low`
- `priority: normal` → `priority: 2 - normal`
- `priority: high` → `priority: 1 - high`
- `priority: urgent` → `priority: 0 - urgent`

Example before:
```typescript
const frontmatter = { priority: 'high', ... };
expect(store.parse(frontmatter).priority).toBe('high');
```

After:
```typescript
const frontmatter = { priority: '1 - high', ... };
expect(store.parse(frontmatter).priority).toBe('1 - high');
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern=TemplateNoteStore
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/features/tasks/templates/TemplateNoteStore.test.ts
git commit -m "test(tasks): update TemplateNoteStore test fixtures to new priority format"
```

---

### Task 11: Update TaskNoteStore tests

**Files:**
- Modify: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

- [ ] **Step 1: Find all priority test values**

File: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

Search for frontmatter and assertions with `priority:`.

- [ ] **Step 2: Update all priority values**

Replace all old values across the file:
- `priority: low` → `priority: 3 - low`
- `priority: normal` → `priority: 2 - normal`
- `priority: high` → `priority: 1 - high`
- `priority: urgent` → `priority: 0 - urgent`

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern=TaskNoteStore
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "test(tasks): update TaskNoteStore test fixtures to new priority format"
```

---

### Task 12: Update taskCommands tests

**Files:**
- Modify: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Find all priority test values**

File: `tests/unit/features/tasks/commands/taskCommands.test.ts`

Search for assertions checking `priority` in markdown output or frontmatter.

- [ ] **Step 2: Update all priority values**

Replace all old values:
- `'low'` → `'3 - low'`
- `'normal'` → `'2 - normal'`
- `'high'` → `'1 - high'`
- `'urgent'` → `'0 - urgent'`

Example before:
```typescript
expect(buildWorkOrderMarkdown(base)).toContain('priority: normal');
```

After:
```typescript
expect(buildWorkOrderMarkdown(base)).toContain('priority: 2 - normal');
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern=taskCommands
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "test(tasks): update taskCommands test fixtures to new priority format"
```

---

### Task 13: Update selectNextReadyTask tests

**Files:**
- Modify: `tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`

- [ ] **Step 1: Find sort/rank assertions**

File: `tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`

Look for tests that verify sort order by priority.

- [ ] **Step 2: Update priority values in test fixtures**

Replace all old values:
- `'low'` → `'3 - low'`
- `'normal'` → `'2 - normal'`
- `'high'` → `'1 - high'`
- `'urgent'` → `'0 - urgent'`

Example before:
```typescript
const tasks = [
  { frontmatter: { priority: 'low' } },
  { frontmatter: { priority: 'high' } },
];
expect(selectNextReadyTask(tasks).frontmatter.priority).toBe('high');
```

After:
```typescript
const tasks = [
  { frontmatter: { priority: '3 - low' } },
  { frontmatter: { priority: '1 - high' } },
];
expect(selectNextReadyTask(tasks).frontmatter.priority).toBe('1 - high');
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern=selectNextReadyTask
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/features/tasks/execution/selectNextReadyTask.test.ts
git commit -m "test(tasks): update selectNextReadyTask test fixtures to new priority format"
```

---

## Phase 5: Docs & Integration Testing

### Task 14: Update Backlog.base

**Files:**
- Modify: `docs/Backlog.base`

- [ ] **Step 1: Check current Backlog.base structure**

File: `docs/Backlog.base`

Current Ideas view has `note.priority: 144` columnSize. Check if Issues view has a matching columnSize.

- [ ] **Step 2: Ensure consistency (if needed)**

If Issues view is missing `note.priority` columnSize, add it:

Find the Issues table section and ensure it has:
```yaml
columnSize:
  note.type: 102
  file.name: 462
  note.priority: 144
```

(If already present, no change needed.)

- [ ] **Step 3: Commit if changed**

```bash
git add docs/Backlog.base
git commit -m "docs: add priority columnSize to Issues view in Backlog.base"
```

(If no changes were made, skip this commit.)

---

### Task 15: Full test suite

**Files:**
- All modified source and test files

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: All tests pass. If any fail, check for missed priority value replacements.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run linter**

```bash
npm run lint
```

Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build succeeds without errors.

- [ ] **Step 5: Commit if any fixes needed**

If you had to fix anything from test failures, commit those fixes:

```bash
git add .
git commit -m "fix(tasks): resolve test failures from priority refactoring"
```

---

### Task 16: Manual smoke test

**Files:**
- Live Obsidian instance with Claudian plugin

- [ ] **Step 1: Start dev mode**

```bash
npm run dev
```

Expected: Dev server starts, plugin loads in Obsidian.

- [ ] **Step 2: Open Agent Board**

In Obsidian, navigate to the Agent Board view.

- [ ] **Step 3: Create a new work-order**

Click "Create work-order" button. Select a template (e.g., "Feature").

- [ ] **Step 4: Check priority dropdown**

In the work-order modal, open the priority dropdown. Verify it shows:
- `0 - urgent`
- `1 - high`
- `2 - normal`
- `3 - low`

- [ ] **Step 5: Select a priority**

Select `1 - high` from dropdown.

- [ ] **Step 6: Save the work-order**

Click "Save" button. Verify the note is created in the vault.

- [ ] **Step 7: Check frontmatter**

Open the created note in editor. Verify frontmatter shows:
```yaml
priority: 1 - high
```

(Not `priority: high` or any other form.)

- [ ] **Step 8: Check board rendering**

Return to Agent Board. Verify the new card displays the priority as `1 - high` (not capitalized, not truncated).

- [ ] **Step 9: Verify sort order**

Create 2-3 more work-orders with different priorities (e.g., `0 - urgent`, `3 - low`). Verify that when all are marked "ready", the board sorts by priority (urgent first, then high, then normal, then low).

- [ ] **Step 10: All good, final commit**

```bash
git log --oneline -10
```

Verify that the last 10 commits include all the refactoring steps above. If everything looks good, push:

```bash
git push
```

Expected: Push succeeds. All commits now on `origin/main`.

---

## Summary

**Total tasks:** 16 (3 type/validation, 1 sort logic, 2 UI, 1 presets, 8 tests, 1 docs, 1 smoke test)

**Estimated time:** 45–90 minutes (includes test runs and smoke testing).

**Key files touched:** ~20 files across src/, tests/, and docs/.

**Output:** Priority nomenclature unified. All tests passing. Agent Board and work-order dropdowns display new format. Existing work-orders on disk remain untouched (user migrates manually if needed).
