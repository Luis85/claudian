---
status: done
---
# Agent Board Thin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Agent Board vertical slice: Markdown work orders, board UI, fresh-tab auto-run, ledger/handoff writes, and Review transition on valid handoff.

**Architecture:** Add `src/features/tasks/` as an optional feature module that owns work-order parsing, indexing, board UI, prompt rendering, and run coordination. Keep execution behind `TaskExecutionSurface`, with `ChatTabExecutionSurface` as the only MVP adapter, so direct chat remains independent.

**Tech Stack:** TypeScript, Obsidian Plugin API, existing Claudian chat `TabManager`/`InputController`, Jest, existing `src/utils/frontmatter.ts`, provider registry/model UI contracts.

---

## Scope Check

This plan implements the approved thin slice from [[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design.md]]. It excludes custom lane config, drag/drop, workflow-note config, worktrees, headless execution, selection/browser/chat capture, and publish automation.

## File Structure

- Create `src/features/tasks/CLAUDE.md`: task-feature boundaries and local guidance.
- Create `src/features/tasks/model/taskTypes.ts`: status, frontmatter, parsed task, board model, run result types.
- Create `src/features/tasks/model/taskStateMachine.ts`: pure status transition rules.
- Create `src/features/tasks/storage/TaskNoteStore.ts`: parse/create/write work-order Markdown notes.
- Create `src/features/tasks/prompt/TaskPromptRenderer.ts`: render prompt text for auto-sent runs.
- Create `src/features/tasks/execution/TaskHandoffParser.ts`: parse strict `<claudian_handoff>` block.
- Create `src/features/tasks/execution/TaskExecutionSurface.ts`: execution seam interfaces.
- Create `src/features/tasks/execution/TaskRunCoordinator.ts`: validate, run, write ledger/handoff, transition status.
- Create `src/features/tasks/execution/ChatTabExecutionSurface.ts`: adapter from task run to fresh chat tab.
- Create `src/features/tasks/indexing/TaskIndexer.ts`: scan configured task folder into board model.
- Create `src/features/tasks/ui/AgentBoardView.ts`: Obsidian ItemView lifecycle and board wiring.
- Create `src/features/tasks/ui/AgentBoardRenderer.ts`: kanban lanes, cards, detail pane DOM rendering.
- Create `src/features/tasks/commands/taskCommands.ts`: command registration and work-order creation helpers.
- Create `src/features/settings/ui/AgentBoardSettingsSection.ts`: settings UI fields.
- Modify `src/core/types/chat.ts`: export `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`.
- Modify `src/core/types/settings.ts`: add Agent Board settings fields.
- Modify `src/app/settings/defaultSettings.ts`: add default Agent Board settings.
- Modify `src/features/settings/ClaudianSettings.ts`: render Agent Board settings section and hotkey row.
- Modify `src/features/chat/ClaudianView.ts`: expose a helper to create a fresh task-run tab and send a task prompt.
- Modify `src/features/chat/tabs/TabManager.ts`: create fresh tab with explicit provider/model.
- Modify `src/features/chat/tabs/types.ts`: expose the new tab-manager method.
- Modify `src/features/chat/controllers/InputController.ts`: return a programmatic send result without changing normal user-send behavior.
- Modify `src/main.ts`: register Agent Board view, ribbon icon, commands, and task services.
- Modify CSS source: add Agent Board layout styles.

---

### Task 1: Add task domain types and state machine

**Files:**
- Create: `src/features/tasks/CLAUDE.md`
- Create: `src/features/tasks/model/taskTypes.ts`
- Create: `src/features/tasks/model/taskStateMachine.ts`
- Test: `tests/unit/features/tasks/model/taskStateMachine.test.ts`

- [ ] **Step 1: Write the failing state-machine test**

Create `tests/unit/features/tasks/model/taskStateMachine.test.ts`:

```ts
import {
  assertTaskTransition,
  canTransitionTaskStatus,
  TASK_STATUSES,
} from '../../../../../src/features/tasks/model/taskStateMachine';
import type { TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';

describe('TaskStateMachine', () => {
  it('lists the MVP statuses in lane order', () => {
    expect(TASK_STATUSES).toEqual([
      'inbox',
      'ready',
      'running',
      'needs_input',
      'needs_approval',
      'review',
      'needs_fix',
      'done',
      'failed',
      'canceled',
    ]);
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['inbox', 'ready'],
    ['ready', 'running'],
    ['needs_fix', 'running'],
    ['running', 'review'],
    ['running', 'failed'],
    ['running', 'canceled'],
    ['review', 'done'],
    ['review', 'needs_fix'],
    ['needs_fix', 'ready'],
    ['failed', 'ready'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['ready', 'review'],
    ['inbox', 'running'],
    ['done', 'running'],
    ['canceled', 'running'],
    ['failed', 'review'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
    expect(() => assertTaskTransition(from, to)).toThrow(`Illegal task transition: ${from} -> ${to}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/model/taskStateMachine.test.ts
```

Expected: FAIL with a module-not-found error for `taskStateMachine`.

- [ ] **Step 3: Add task types**

Create `src/features/tasks/model/taskTypes.ts`:

```ts
import type { ProviderId } from '../../../core/providers/types';

export type TaskStatus =
  | 'inbox'
  | 'ready'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'review'
  | 'needs_fix'
  | 'done'
  | 'failed'
  | 'canceled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskFrontmatter {
  type: 'claudian-work-order';
  schema_version: 1;
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
  updated: string;
  provider?: ProviderId;
  model?: string;
  run_id?: string | null;
  conversation_id?: string | null;
  sidepanel_tab_id?: string | null;
  started?: string | null;
  finished?: string | null;
  attempts: number;
}

export interface TaskSections {
  objective: string;
  acceptanceCriteria: string;
  context: string;
  constraints: string;
  ledger: string;
  handoff: string;
}

export interface TaskSpec {
  path: string;
  frontmatter: TaskFrontmatter;
  sections: TaskSections;
  body: string;
  raw: string;
}

export interface InvalidTaskNote {
  path: string;
  error: string;
}

export interface TaskBoardModel {
  tasks: TaskSpec[];
  invalidNotes: InvalidTaskNote[];
}

export interface TaskLedgerEntry {
  timestamp: string;
  status: TaskStatus;
  message: string;
}

export interface ParsedHandoff {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
  markdown: string;
}
```

- [ ] **Step 4: Add state machine implementation**

Create `src/features/tasks/model/taskStateMachine.ts`:

```ts
import type { TaskStatus } from './taskTypes';

export const TASK_STATUSES: TaskStatus[] = [
  'inbox',
  'ready',
  'running',
  'needs_input',
  'needs_approval',
  'review',
  'needs_fix',
  'done',
  'failed',
  'canceled',
];

const LEGAL_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ['inbox', new Set(['ready'])],
  ['ready', new Set(['running'])],
  ['running', new Set(['review', 'failed', 'canceled', 'needs_input', 'needs_approval'])],
  ['needs_input', new Set(['running', 'failed', 'canceled'])],
  ['needs_approval', new Set(['running', 'failed', 'canceled'])],
  ['review', new Set(['done', 'needs_fix', 'canceled'])],
  ['needs_fix', new Set(['ready', 'running', 'canceled'])],
  ['done', new Set()],
  ['failed', new Set(['ready'])],
  ['canceled', new Set()],
]);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return LEGAL_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }
}

export function isRunnableTaskStatus(status: TaskStatus): boolean {
  return status === 'ready' || status === 'needs_fix';
}
```

- [ ] **Step 5: Add local feature guidance**

Create `src/features/tasks/CLAUDE.md`:

```md
# Tasks / Agent Board Feature

`features/tasks` owns Markdown work orders, Agent Board UI, task prompt rendering, run coordination, and generated ledger/handoff writes.

## Boundaries

- Task code may call chat only through `TaskExecutionSurface`.
- Direct chat must not depend on tasks.
- Provider-specific behavior stays behind `ChatRuntime`, `ProviderRegistry`, and existing chat controllers/renderers.
- Work-order notes are the durable source of task state for this feature slice.
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/model/taskStateMachine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/CLAUDE.md src/features/tasks/model/taskTypes.ts src/features/tasks/model/taskStateMachine.ts tests/unit/features/tasks/model/taskStateMachine.test.ts
git commit -m "feat: add task state model"
```

---

### Task 2: Implement TaskNoteStore and generated-region writes

**Files:**
- Create: `src/features/tasks/storage/TaskNoteStore.ts`
- Test: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`:

```ts
import { TaskNoteStore } from '../../../../../src/features/tasks/storage/TaskNoteStore';

const VALID_NOTE = `---
type: claudian-work-order
schema_version: 1
id: task-20260528-example
title: Example work order
status: ready
priority: normal
created: 2026-05-28T18:00:00+02:00
updated: 2026-05-28T18:00:00+02:00
provider: codex
model: gpt-5-codex
run_id:
conversation_id:
sidepanel_tab_id:
started:
finished:
attempts: 0
custom_field: keep-me
---
# Example work order

## Objective

Ship the board.

## Acceptance Criteria

- [ ] It runs.

## Context

[[Source Note]]

## Constraints

- Keep chat independent.

## Run Ledger

<!-- claudian:run-ledger-start -->
<!-- claudian:run-ledger-end -->

## Result / Handoff

<!-- claudian:handoff-start -->
<!-- claudian:handoff-end -->
`;

describe('TaskNoteStore', () => {
  const store = new TaskNoteStore();

  it('parses a valid work-order note', () => {
    const parsed = store.parse('Agent Board/tasks/example.md', VALID_NOTE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.task.frontmatter.status).toBe('ready');
    expect(parsed.task.sections.objective).toContain('Ship the board.');
    expect(parsed.task.sections.context).toContain('[[Source Note]]');
  });

  it('updates status while preserving unknown frontmatter and body prose', () => {
    const updated = store.writeStatus(VALID_NOTE, {
      status: 'running',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      timestamp: '2026-05-28T18:10:00+02:00',
    });
    expect(updated).toContain('status: running');
    expect(updated).toContain('run_id: run-1');
    expect(updated).toContain('custom_field: keep-me');
    expect(updated).toContain('Ship the board.');
  });

  it('writes ledger and handoff only inside generated markers', () => {
    const withLedger = store.appendLedger(VALID_NOTE, {
      timestamp: '2026-05-28T18:10:00+02:00',
      status: 'running',
      message: 'Run started.',
    });
    expect(withLedger).toContain('<!-- claudian:run-ledger-start -->\n- 2026-05-28T18:10:00+02:00 — `running` — Run started.\n<!-- claudian:run-ledger-end -->');

    const withHandoff = store.writeHandoff(VALID_NOTE, '## Summary\n\nDone.');
    expect(withHandoff).toContain('<!-- claudian:handoff-start -->\n## Summary\n\nDone.\n<!-- claudian:handoff-end -->');
    expect(withHandoff).toContain('## Objective\n\nShip the board.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/storage/TaskNoteStore.test.ts
```

Expected: FAIL with a module-not-found error for `TaskNoteStore`.

- [ ] **Step 3: Implement TaskNoteStore**

Create `src/features/tasks/storage/TaskNoteStore.ts` with public methods:

```ts
parse(path: string, content: string): TaskParseResult
writeStatus(content: string, options: WriteStatusOptions): string
appendLedger(content: string, entry: TaskLedgerEntry): string
writeHandoff(content: string, markdown: string): string
extractGeneratedRegion(content: string, start: string, end: string): string
```

Use these constants exactly:

```ts
const LEDGER_START = '<!-- claudian:run-ledger-start -->';
const LEDGER_END = '<!-- claudian:run-ledger-end -->';
const HANDOFF_START = '<!-- claudian:handoff-start -->';
const HANDOFF_END = '<!-- claudian:handoff-end -->';
```

Implementation requirements:

- Use `parseFrontmatter` from `src/utils/frontmatter.ts`.
- Use `stringifyYaml` from `obsidian` to render frontmatter.
- Reject notes without frontmatter with `Missing YAML frontmatter`.
- Reject `type` other than `claudian-work-order`.
- Reject `schema_version` other than `1`.
- Preserve unknown frontmatter keys by copying the parsed frontmatter object and updating only orchestrator-owned keys.
- Preserve body text by reusing the parsed body when writing frontmatter.
- Replace only content between generated markers for ledger and handoff writes.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/storage/TaskNoteStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/TaskNoteStore.ts tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "feat: add work order note store"
```

---

### Task 3: Add handoff parser and prompt renderer

**Files:**
- Create: `src/features/tasks/execution/TaskHandoffParser.ts`
- Create: `src/features/tasks/prompt/TaskPromptRenderer.ts`
- Test: `tests/unit/features/tasks/execution/TaskHandoffParser.test.ts`
- Test: `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts`

- [ ] **Step 1: Write parser and renderer tests**

Create `tests/unit/features/tasks/execution/TaskHandoffParser.test.ts`:

```ts
import { parseTaskHandoff } from '../../../../../src/features/tasks/execution/TaskHandoffParser';

describe('TaskHandoffParser', () => {
  it('parses a valid handoff block', () => {
    const result = parseTaskHandoff(`<claudian_handoff>
summary: Implemented board.
verification: npm run test passed.
risks: None known.
next_action: Review the card.
</claudian_handoff>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.summary).toBe('Implemented board.');
    expect(result.handoff.markdown).toContain('## Verification');
  });

  it('rejects missing and incomplete handoffs', () => {
    expect(parseTaskHandoff('No structured ending.')).toEqual({ ok: false, error: 'Missing claudian_handoff block' });
    expect(parseTaskHandoff(`<claudian_handoff>
summary: Done.
verification: Passed.
risks: None.
</claudian_handoff>`)).toEqual({ ok: false, error: 'Missing handoff field: next_action' });
  });
});
```

Create `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts` with a `TaskSpec` fixture and assert the rendered prompt includes the work-order path, title, objective, acceptance criteria, source context, `<claudian_handoff>`, and `next_action:`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskHandoffParser.test.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement `TaskHandoffParser`**

Create `src/features/tasks/execution/TaskHandoffParser.ts`:

```ts
import type { ParsedHandoff } from '../model/taskTypes';

export type TaskHandoffParseResult =
  | { ok: true; handoff: ParsedHandoff }
  | { ok: false; error: string };

const HANDOFF_PATTERN = /<claudian_handoff>\s*([\s\S]*?)\s*<\/claudian_handoff>/i;

function extractField(block: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*([\\s\\S]*?)(?=^summary:|^verification:|^risks:|^next_action:|\\z)`, 'im');
  const value = block.match(pattern)?.[1]?.trim();
  return value ? value : null;
}

export function parseTaskHandoff(content: string): TaskHandoffParseResult {
  const block = content.match(HANDOFF_PATTERN)?.[1];
  if (!block) return { ok: false, error: 'Missing claudian_handoff block' };

  const summary = extractField(block, 'summary');
  if (!summary) return { ok: false, error: 'Missing handoff field: summary' };
  const verification = extractField(block, 'verification');
  if (!verification) return { ok: false, error: 'Missing handoff field: verification' };
  const risks = extractField(block, 'risks');
  if (!risks) return { ok: false, error: 'Missing handoff field: risks' };
  const nextAction = extractField(block, 'next_action');
  if (!nextAction) return { ok: false, error: 'Missing handoff field: next_action' };

  return {
    ok: true,
    handoff: {
      summary,
      verification,
      risks,
      nextAction,
      markdown: `## Summary\n\n${summary}\n\n## Verification\n\n${verification}\n\n## Risks\n\n${risks}\n\n## Next Action\n\n${nextAction}`,
    },
  };
}
```

- [ ] **Step 4: Implement `TaskPromptRenderer`**

Create `src/features/tasks/prompt/TaskPromptRenderer.ts`:

```ts
import type { TaskSpec } from '../model/taskTypes';

export function renderTaskPrompt(task: TaskSpec): string {
  return `You are running a Claudian Agent Board work order.

Work order: ${task.path}
Title: ${task.frontmatter.title}
Task ID: ${task.frontmatter.id}
Provider: ${task.frontmatter.provider ?? 'missing'}
Model: ${task.frontmatter.model ?? 'missing'}

## Objective

${task.sections.objective || '(No objective provided.)'}

## Acceptance Criteria

${task.sections.acceptanceCriteria || '(No acceptance criteria provided.)'}

## Context

${task.sections.context || '(No context provided.)'}

## Constraints

${task.sections.constraints || '(No constraints provided.)'}

## Instructions

- Work visibly in this chat tab.
- Preserve existing direct chat behavior.
- Do not modify unrelated files.
- End your final answer with this exact structured block:

<claudian_handoff>
summary: Briefly state what was completed.
verification: List checks run and their outcomes, or explain why none were run.
risks: List remaining risks or state "None known".
next_action: State the recommended human next step.
</claudian_handoff>`;
}
```

- [ ] **Step 5: Run tests and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskHandoffParser.test.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
git add src/features/tasks/execution/TaskHandoffParser.ts src/features/tasks/prompt/TaskPromptRenderer.ts tests/unit/features/tasks/execution/TaskHandoffParser.test.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
git commit -m "feat: render task prompts and parse handoffs"
```

Expected: tests PASS, then commit succeeds.

---

### Task 4: Add execution seam and run coordinator

**Files:**
- Create: `src/features/tasks/execution/TaskExecutionSurface.ts`
- Create: `src/features/tasks/execution/TaskRunCoordinator.ts`
- Test: `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`

- [ ] **Step 1: Write coordinator tests**

Create `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts` with a fake `TaskExecutionSurface` that returns completed content. Cover:

```ts
it('blocks missing provider', async () => {
  const result = await coordinator.run(makeTask({ provider: undefined }));
  expect(result).toEqual({ ok: false, error: 'Work order is missing provider' });
});

it('transitions ready -> running -> review on valid handoff', async () => {
  expect(statuses).toEqual(['running', 'review']);
});

it('transitions running -> failed on missing handoff', async () => {
  expect(result).toEqual({ ok: false, error: 'Missing claudian_handoff block' });
  expect(statuses).toEqual(['running', 'failed']);
});
```

Use a full `TaskSpec` fixture with `status: 'ready'`, `provider: 'codex'`, `model: 'gpt-5-codex'`, and `attempts: 0`.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Add execution seam**

Create `src/features/tasks/execution/TaskExecutionSurface.ts`:

```ts
import type { TaskSpec } from '../model/taskTypes';

export interface TaskRunOptions {
  prompt: string;
}

export interface TaskRunHandle {
  status: 'completed' | 'failed' | 'canceled';
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  finalAssistantContent: string;
  error?: string;
}

export interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  cancelTaskRun?(runId: string): void;
}
```

- [ ] **Step 4: Implement coordinator**

Create `TaskRunCoordinator` with these injected dependencies:

```ts
executionSurface
now
writeTaskStatus
appendLedger
writeHandoff
isProviderEnabled
ownsModel
```

Required behavior:

- Return `Work order is missing provider` when `task.frontmatter.provider` is empty.
- Return `Work order is missing model` when `task.frontmatter.model` is empty.
- Return `This work order is already running.` when status is `running` or the in-memory active-run set contains the task ID.
- Write `running` before calling `executionSurface.startTaskRun`.
- Parse final assistant content with `parseTaskHandoff`.
- Write handoff and status `review` only on valid handoff.
- Write status `failed` on missing handoff or failed execution.
- Always remove the task ID from the active-run set in `finally`.

- [ ] **Step 5: Run tests and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git add src/features/tasks/execution/TaskExecutionSurface.ts src/features/tasks/execution/TaskRunCoordinator.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git commit -m "feat: coordinate work order runs"
```

Expected: tests PASS, then commit succeeds.

---

### Task 5: Add Agent Board settings

**Files:**
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`
- Create: `src/features/settings/ui/AgentBoardSettingsSection.ts`
- Modify: `src/features/settings/ClaudianSettings.ts`

- [ ] **Step 1: Add settings fields and defaults**

In `ClaudianSettings`, add:

```ts
  // Agent Board
  agentBoardWorkOrderFolder: string;
  agentBoardDefaultProvider: string;
  agentBoardDefaultModel: string;
```

In `DEFAULT_CLAUDIAN_SETTINGS`, add:

```ts
  agentBoardWorkOrderFolder: 'Agent Board/tasks',
  agentBoardDefaultProvider: 'codex',
  agentBoardDefaultModel: '',
```

- [ ] **Step 2: Create settings section renderer**

Create `src/features/settings/ui/AgentBoardSettingsSection.ts` with `renderAgentBoardSettingsSection(container, plugin)`. It must render:

- heading `Agent Board`;
- text input for `agentBoardWorkOrderFolder`;
- dropdown of enabled providers from `ProviderRegistry.getEnabledProviderIds`;
- dropdown of models from `ProviderRegistry.getChatUIConfig(selectedProvider).getModelOptions`.

Each control must save through `plugin.saveSettings()`.

- [ ] **Step 3: Render settings section**

In `src/features/settings/ClaudianSettings.ts`, import:

```ts
import { renderAgentBoardSettingsSection } from './ui/AgentBoardSettingsSection';
```

In `renderGeneralTab`, after chat placement settings, call:

```ts
    renderAgentBoardSettingsSection(container, this.plugin);
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts src/features/settings/ui/AgentBoardSettingsSection.ts src/features/settings/ClaudianSettings.ts
git commit -m "feat: add Agent Board settings"
```

Expected: typecheck PASS, then commit succeeds.

---

### Task 6: Add indexing and work-order creation

**Files:**
- Create: `src/features/tasks/indexing/TaskIndexer.ts`
- Create: `src/features/tasks/commands/taskCommands.ts`
- Test: `tests/unit/features/tasks/indexing/TaskIndexer.test.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Write indexing and creation tests**

`TaskIndexer.test.ts` must assert valid notes land in `tasks` and invalid notes land in `invalidNotes`.

`taskCommands.test.ts` must assert generated markdown contains:

- `type: claudian-work-order`;
- `status: ready`;
- `provider` and `model`;
- wiki-link to source note path without `.md`;
- ledger and handoff markers.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/indexing/TaskIndexer.test.ts tests/unit/features/tasks/commands/taskCommands.test.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement `TaskIndexer`**

Create `src/features/tasks/indexing/TaskIndexer.ts`:

```ts
import type { TFile, Vault } from 'obsidian';
import type { TaskBoardModel } from '../model/taskTypes';
import type { TaskNoteStore } from '../storage/TaskNoteStore';

export interface TaskFileContent {
  path: string;
  content: string;
}

export class TaskIndexer {
  constructor(private readonly noteStore: TaskNoteStore) {}

  indexContents(files: TaskFileContent[]): TaskBoardModel {
    const model: TaskBoardModel = { tasks: [], invalidNotes: [] };
    for (const file of files) {
      const parsed = this.noteStore.parse(file.path, file.content);
      if (parsed.ok) model.tasks.push(parsed.task);
      else model.invalidNotes.push({ path: file.path, error: parsed.error });
    }
    return model;
  }

  async indexVaultFolder(vault: Vault, folder: string): Promise<TaskBoardModel> {
    const normalized = folder.replace(/^\/+|\/+$/g, '');
    const contents: TaskFileContent[] = [];
    for (const file of vault.getMarkdownFiles().filter((candidate: TFile) => candidate.path.startsWith(`${normalized}/`))) {
      contents.push({ path: file.path, content: await vault.read(file) });
    }
    return this.indexContents(contents);
  }
}
```

- [ ] **Step 4: Implement task command helpers**

Create `src/features/tasks/commands/taskCommands.ts` with exported functions:

```ts
createWorkOrder(plugin: ClaudianPlugin, sourceFile?: TFile | null): Promise<TFile | null>
createWorkOrderFromCurrentNote(plugin: ClaudianPlugin): Promise<TFile | null>
```

Also export `__taskCommandTestUtils = { buildWorkOrderMarkdown, slugifyTitle }` for pure tests.

Requirements:

- Use `plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks'`.
- Create the folder if it does not exist.
- Block with a Notice if `agentBoardDefaultProvider` or `agentBoardDefaultModel` is missing.
- Source-note creation must add `Source note: [[path/without-extension]]` in `## Context`.
- Source note must not be modified.

- [ ] **Step 5: Run tests and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/indexing/TaskIndexer.test.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git add src/features/tasks/indexing/TaskIndexer.ts src/features/tasks/commands/taskCommands.ts tests/unit/features/tasks/indexing/TaskIndexer.test.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat: create and index work orders"
```

Expected: tests PASS, then commit succeeds.

---

### Task 7: Add Agent Board view and renderer

**Files:**
- Modify: `src/core/types/chat.ts`
- Create: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Create: `src/features/tasks/ui/AgentBoardView.ts`
- Modify: project CSS source

- [ ] **Step 1: Add view type**

Add to `src/core/types/chat.ts`:

```ts
export const VIEW_TYPE_CLAUDIAN_AGENT_BOARD = 'claudian-agent-board-view';
```

Ensure `src/core/types/index.ts` exports it.

- [ ] **Step 2: Implement `AgentBoardRenderer`**

Create a renderer with built-in lanes:

```ts
['inbox', 'ready', 'running', 'needs_input', 'needs_approval', 'review', 'needs_fix', 'done', 'failed', 'canceled']
```

Cards must show title, provider/model, priority, and actions:

- Open note;
- Run for `ready` and `needs_fix`;
- Stop for `running`.

Detail pane must show objective, acceptance criteria, ledger, handoff, and validation errors.

- [ ] **Step 3: Implement `AgentBoardView`**

Create `src/features/tasks/ui/AgentBoardView.ts` as an `ItemView` that:

- uses `TaskIndexer` and `TaskNoteStore`;
- refreshes from `plugin.settings.agentBoardWorkOrderFolder`;
- listens to vault `create`, `modify`, `delete`, and `rename`;
- opens task notes with `workspace.getLeaf('tab').openFile(file)`;
- runs tasks through `TaskRunCoordinator`;
- writes status, ledger, and handoff by reading the latest file content, applying `TaskNoteStore`, and calling `vault.modify`.

- [ ] **Step 4: Add CSS**

Add styles for:

```css
.claudian-agent-board
.claudian-agent-board-lanes
.claudian-agent-board-lane
.claudian-agent-board-card
.claudian-agent-board-card-actions
.claudian-agent-board-detail
.claudian-agent-board-errors
```

Use Obsidian variables `--background-primary`, `--background-secondary`, `--background-modifier-border`, and `--text-error`.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add src/core/types/chat.ts src/core/types/index.ts src/features/tasks/ui/AgentBoardRenderer.ts src/features/tasks/ui/AgentBoardView.ts styles.css src/style
git commit -m "feat: add Agent Board view"
```

Expected: typecheck PASS. `git add` may report an ignored or missing path for either `styles.css` or `src/style`; add the actual CSS file changed in this repository.

---

### Task 8: Register Agent Board view, ribbon, and commands

**Files:**
- Modify: `src/main.ts`
- Create: `src/features/tasks/execution/ChatTabExecutionSurface.ts`

- [ ] **Step 1: Create temporary execution surface class**

Create `src/features/tasks/execution/ChatTabExecutionSurface.ts`:

```ts
import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions } from './TaskExecutionSurface';

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(_task: TaskSpec, _options: TaskRunOptions): Promise<TaskRunHandle> {
    void this.plugin;
    return {
      status: 'failed',
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      finalAssistantContent: '',
      error: 'ChatTabExecutionSurface is not connected to chat yet',
    };
  }
}
```

- [ ] **Step 2: Register view and commands in main**

In `src/main.ts`, import `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`, `AgentBoardView`, `ChatTabExecutionSurface`, `createWorkOrder`, and `createWorkOrderFromCurrentNote`.

Inside `onload`, instantiate:

```ts
const taskExecutionSurface = new ChatTabExecutionSurface(this);
```

Register:

- view `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`;
- ribbon icon `kanban-square` with label `Open Agent Board`;
- command `open-agent-board`;
- command `create-work-order`;
- command `create-work-order-from-current-note`.

Add method:

```ts
async activateAgentBoardView(): Promise<void>
```

It must mirror `activateView()` but use `VIEW_TYPE_CLAUDIAN_AGENT_BOARD` and `workspace.getLeaf('tab')`.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add src/main.ts src/features/tasks/execution/ChatTabExecutionSurface.ts
git commit -m "feat: register Agent Board commands"
```

Expected: typecheck PASS, then commit succeeds.

---

### Task 9: Connect fresh-tab chat execution

**Files:**
- Modify: `src/features/tasks/execution/ChatTabExecutionSurface.ts`
- Modify: `src/features/chat/ClaudianView.ts`
- Modify: `src/features/chat/tabs/TabManager.ts`
- Modify: `src/features/chat/tabs/types.ts`
- Modify: `src/features/chat/controllers/InputController.ts`

- [ ] **Step 1: Make programmatic sends return a result**

In `InputController.ts`, export:

```ts
export interface ProgrammaticSendResult {
  ok: boolean;
  finalAssistantContent: string;
  error?: string;
}
```

Change `sendMessage` return type to `Promise<ProgrammaticSendResult | void>`.

For `options?.content` calls:

- return `{ ok: false, finalAssistantContent: '', error: 'No content to send' }` when trimmed content and images are empty;
- after stream cleanup, return `{ ok: true, finalAssistantContent: finalAssistantMsg.content }`;
- if canceled, return `{ ok: false, finalAssistantContent: finalAssistantMsg.content, error: 'Canceled' }`.

Normal keyboard/user sends may ignore the returned value.

- [ ] **Step 2: Add fresh task-run tab creation**

In `TabManager.ts`, allow `createTab` options to include `defaultProviderId?: ProviderId`.

Add:

```ts
async createTaskRunTab(options: {
  providerId: ProviderId;
  model: string;
  conversationId?: string | null;
}): Promise<TabData | null>
```

It must call `createTab` with `activate: true`, `draftModel: options.model`, and `defaultProviderId: options.providerId`.

Expose the method in `TabManagerInterface`.

- [ ] **Step 3: Add ClaudianView task-run helper**

In `ClaudianView.ts`, add:

```ts
async startTaskRunInFreshTab(options: {
  providerId: ProviderId;
  model: string;
  prompt: string;
}): Promise<{
  status: 'completed' | 'failed' | 'canceled';
  conversationId: string | null;
  sidepanelTabId: string | null;
  finalAssistantContent: string;
  error?: string;
}>
```

It must create a fresh task-run tab, call `inputController.sendMessage({ content: options.prompt })`, and return the tab ID, conversation ID, final content, and failure/cancel status.

- [ ] **Step 4: Replace `ChatTabExecutionSurface` stub**

Implement `ChatTabExecutionSurface.startTaskRun` to:

- validate task provider/model;
- call `plugin.activateView()`;
- get the chat view with `plugin.getView()`;
- call `view.startTaskRunInFreshTab`;
- return a `TaskRunHandle`.

- [ ] **Step 5: Verify and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/chat/controllers/InputController.test.ts tests/unit/features/chat/tabs/TabManager.test.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
npm run typecheck
git add src/features/tasks/execution/ChatTabExecutionSurface.ts src/features/chat/ClaudianView.ts src/features/chat/tabs/TabManager.ts src/features/chat/tabs/types.ts src/features/chat/controllers/InputController.ts tests/unit/features/chat/controllers/InputController.test.ts tests/unit/features/chat/tabs/TabManager.test.ts
git commit -m "feat: run work orders in fresh chat tabs"
```

Expected: tests and typecheck PASS, then commit succeeds.

---

### Task 10: Wire real validation and refresh behavior

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts`

- [ ] **Step 1: Validate provider/model through provider registry**

In `AgentBoardView.runTask`, inject:

```ts
isProviderEnabled: providerId => ProviderRegistry.isEnabled(providerId as ProviderId, this.plugin.settings as unknown as Record<string, unknown>),
ownsModel: (providerId, model) => ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, this.plugin.settings as unknown as Record<string, unknown>),
```

Before casting, check:

```ts
ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
```

Return a validation error when the provider ID is unknown.

- [ ] **Step 2: Read the latest note before running**

At the start of `runTask`, read the `TFile` from the vault, parse latest content with `TaskNoteStore.parse`, and pass `latest.task` into the coordinator. If parsing fails, show a Notice with the parse error and refresh the board.

- [ ] **Step 3: Verify and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts tests/unit/features/tasks/indexing/TaskIndexer.test.ts
npm run typecheck
git add src/features/tasks/ui/AgentBoardView.ts src/features/tasks/execution/TaskRunCoordinator.ts
git commit -m "fix: validate task provider and model before runs"
```

Expected: tests and typecheck PASS, then commit succeeds.

---

### Task 11: Add non-regression tests

**Files:**
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`
- Modify: `tests/unit/features/chat/ClaudianView.test.ts`

- [ ] **Step 1: Add command-helper test**

Ensure `tests/unit/features/tasks/commands/taskCommands.test.ts` asserts source-note work-order markdown includes generated regions and leaves source content out of the generated work-order body except the wiki-link.

- [ ] **Step 2: Add direct chat independence test**

In `tests/unit/features/chat/ClaudianView.test.ts`, follow existing setup helpers and add:

```ts
it('opens direct chat without Agent Board state', async () => {
  const view = await openTestClaudianView();
  expect(view.getTabManager()).not.toBeNull();
  expect(view.getActiveTab()).toBeTruthy();
});
```

If the helper is named differently in the file, use the existing helper that opens `ClaudianView` and returns the view.

- [ ] **Step 3: Verify and commit**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/commands/taskCommands.test.ts tests/unit/features/chat/ClaudianView.test.ts
git add tests/unit/features/tasks/commands/taskCommands.test.ts tests/unit/features/chat/ClaudianView.test.ts src/features/tasks/commands/taskCommands.ts
git commit -m "test: cover work order creation and chat independence"
```

Expected: tests PASS, then commit succeeds.

---

### Task 12: Final verification and PR handoff

**Files:**
- Modify only files required to fix verification failures.

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Confirm clean status**

```bash
git status --short
```

Expected: no uncommitted changes.

- [ ] **Step 3: Manual smoke test**

1. Reload the plugin in Obsidian.
2. Click the Agent Board ribbon icon.
3. Confirm Agent Board opens.
4. Open a Markdown note.
5. Run command **Create work order from current note**.
6. Confirm a new note appears under `Agent Board/tasks` with provider/model fields.
7. Confirm the board shows the card in Ready.
8. Click Run.
9. Confirm a fresh chat tab opens and auto-sends the prompt.
10. End the agent response with a valid `<claudian_handoff>` block.
11. Confirm the task note has a ledger entry and handoff content inside markers.
12. Confirm the card moves to Review.
13. Open a normal chat tab and send a direct message without a work order.
14. Confirm direct chat streams normally.

- [ ] **Step 4: Commit final fixes**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: polish Agent Board thin slice"
```

If no files changed, skip this commit.

- [ ] **Step 5: PR summary**

Use this PR summary:

```md
## Summary

- adds Agent Board work-order settings, commands, and ribbon entry
- adds Markdown work-order parsing, indexing, ledger/handoff writes, and board UI
- runs work orders through fresh visible chat tabs and moves valid handoffs to Review

## Verification

- npm run typecheck
- npm run lint
- npm run test
- npm run build

## Risks

- strict handoff parsing can fail runs until prompts are tuned
- fresh-tab execution depends on existing chat tab limits and provider readiness
- custom lane config, worktrees, and headless execution remain out of scope
```

