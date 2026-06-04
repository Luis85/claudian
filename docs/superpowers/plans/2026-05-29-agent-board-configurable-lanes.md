---
status: done
parent: "[[Agent Kanban Board]]"
---
# Agent Board Configurable Lanes + Board QoL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Board configurable (user-defined lanes, status mapping, per-lane DoR/DoD, prompt injection) and add board quality-of-life (add-to-inbox from the board, inline frontmatter editing in the detail modal, explicit Inbox→Ready promotion).

**Architecture:** Add `src/features/tasks/config/` with a `BoardConfigStore` (load/validate/normalize, fallback to default) and a pure `resolveBoardLayout`. The renderer drops its hardcoded lanes and draws the resolved layout. Config lives in plugin settings, edited via a tasks-owned lane editor called from the Agent Board settings section. The run coordinator receives an injected `renderPrompt` so current-lane DoR/DoD reach the prompt without coupling the coordinator to config.

**Tech Stack:** TypeScript, Obsidian Plugin API, existing `TaskNoteStore`/`TaskStateMachine`/`ProviderRegistry`, Jest, `src/utils/frontmatter.ts`.

---

## Spec

Implements [[2026-05-29-agent-board-configurable-lanes-design]]. Roles, body-section editing, free status dropdown, WIP limits, drag/drop, custom statuses/transitions are out of scope.

## File Structure

Create:
- `src/features/tasks/config/boardConfigTypes.ts` — config + resolved-layout types, `DEFAULT_BOARD_CONFIG`.
- `src/features/tasks/config/BoardConfigStore.ts` — `loadBoardConfig`, `getLaneForStatus`.
- `src/features/tasks/config/resolveBoardLayout.ts` — pure status→lane bucketing with catch-all.
- `src/features/tasks/ui/AgentBoardLaneEditor.ts` — settings lane editor.

Modify:
- `src/core/types/settings.ts` — add `agentBoardConfig?: unknown`.
- `src/features/tasks/prompt/TaskPromptRenderer.ts` — optional lane criteria.
- `src/features/tasks/execution/TaskRunCoordinator.ts` — injected `renderPrompt`.
- `src/features/tasks/storage/TaskNoteStore.ts` — `writeFields`.
- `src/features/tasks/commands/taskCommands.ts` — `status` + `reveal` options.
- `src/features/tasks/ui/AgentBoardRenderer.ts` — consume layout, mark-ready + add-work-order actions.
- `src/features/tasks/ui/WorkOrderDetailModal.ts` — inline frontmatter editors, mark-ready, running read-only.
- `src/features/tasks/ui/AgentBoardView.ts` — load config, resolve layout, inject prompt, add-from-board, modal callbacks.
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — render the lane editor; refresh board on folder change.
- `src/main.ts` — `refreshAgentBoards()`.
- `src/style/features/agent-board.css` — header, lane criteria, lane-editor styles.

No change to `src/app/settings/defaultSettings.ts`: `agentBoardConfig` is left undefined and `loadBoardConfig` falls back to `DEFAULT_BOARD_CONFIG`.

---

### Task 1: Add board config types and settings field

**Files:**
- Create: `src/features/tasks/config/boardConfigTypes.ts`
- Modify: `src/core/types/settings.ts:153`

- [ ] **Step 1: Create config types**

Create `src/features/tasks/config/boardConfigTypes.ts`:

```ts
import { TASK_STATUSES } from '../model/taskStateMachine';
import type { TaskSpec, TaskStatus } from '../model/taskTypes';

export interface BoardLaneConfig {
  id: string;
  title: string;
  statuses: TaskStatus[];
  visible: boolean;
  definitionOfReady: string[];
  definitionOfDone: string[];
}

export interface BoardConfig {
  schemaVersion: 1;
  lanes: BoardLaneConfig[];
}

export interface ResolvedLane {
  id: string;
  title: string;
  tasks: TaskSpec[];
  definitionOfReady: string[];
  definitionOfDone: string[];
  isCatchAll: boolean;
}

export interface ResolvedBoardLayout {
  lanes: ResolvedLane[];
  errors: string[];
}

export const DEFAULT_LANE_TITLES: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  ready: 'Ready',
  running: 'Running',
  needs_input: 'Needs input',
  needs_approval: 'Needs approval',
  review: 'Review',
  needs_fix: 'Needs fix',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  schemaVersion: 1,
  lanes: TASK_STATUSES.map((status) => ({
    id: status,
    title: DEFAULT_LANE_TITLES[status],
    statuses: [status],
    visible: true,
    definitionOfReady: [],
    definitionOfDone: [],
  })),
};
```

- [ ] **Step 2: Add settings field**

In `src/core/types/settings.ts`, after the `agentBoardDefaultModel` line (around line 153), add:

```ts
  // Validated and normalized by BoardConfigStore; stored as raw to keep core free of feature types.
  agentBoardConfig?: unknown;
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/config/boardConfigTypes.ts src/core/types/settings.ts
git commit -m "feat: add Agent Board config types"
```

---

### Task 2: Implement BoardConfigStore

**Files:**
- Create: `src/features/tasks/config/BoardConfigStore.ts`
- Test: `tests/unit/features/tasks/config/BoardConfigStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/config/BoardConfigStore.test.ts`:

```ts
import { getLaneForStatus, loadBoardConfig } from '../../../../../src/features/tasks/config/BoardConfigStore';
import { DEFAULT_BOARD_CONFIG } from '../../../../../src/features/tasks/config/boardConfigTypes';

describe('loadBoardConfig', () => {
  it('returns the default config when none is set', () => {
    expect(loadBoardConfig({})).toEqual({ config: DEFAULT_BOARD_CONFIG, errors: [] });
  });

  it('keeps a valid custom config and normalizes defaults', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'running'], definitionOfReady: ['x'] }],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(errors).toEqual([]);
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[0].visible).toBe(true);
    expect(config.lanes[0].definitionOfDone).toEqual([]);
  });

  it('falls back to default when a status maps to two lanes', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready'] },
        { id: 'b', title: 'B', statuses: ['ready'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.some((e) => e.includes('more than one lane'))).toBe(true);
  });

  it('falls back to default when a lane has no title', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: '', statuses: ['ready'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('drops unknown statuses with a warning but keeps the config', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'bogus'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].statuses).toEqual(['ready']);
    expect(errors.some((e) => e.includes('bogus'))).toBe(true);
  });
});

describe('getLaneForStatus', () => {
  it('finds the lane owning a status, else null', () => {
    expect(getLaneForStatus(DEFAULT_BOARD_CONFIG, 'review')?.id).toBe('review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/config/BoardConfigStore.test.ts
```

Expected: FAIL with a module-not-found error for `BoardConfigStore`.

- [ ] **Step 3: Implement the store**

Create `src/features/tasks/config/BoardConfigStore.ts`:

```ts
import { isTaskStatus } from '../model/taskStateMachine';
import type { TaskStatus } from '../model/taskTypes';
import { DEFAULT_BOARD_CONFIG, type BoardConfig, type BoardLaneConfig } from './boardConfigTypes';

export interface LoadBoardConfigResult {
  config: BoardConfig;
  errors: string[];
}

export function loadBoardConfig(settings: Record<string, unknown>): LoadBoardConfigResult {
  const raw = settings.agentBoardConfig;
  if (!raw || typeof raw !== 'object') {
    return { config: DEFAULT_BOARD_CONFIG, errors: [] };
  }

  const candidate = raw as { lanes?: unknown };
  if (!Array.isArray(candidate.lanes)) {
    return { config: DEFAULT_BOARD_CONFIG, errors: [] };
  }

  const errors: string[] = [];
  const lanes: BoardLaneConfig[] = [];
  const seen = new Set<TaskStatus>();

  for (const laneRaw of candidate.lanes) {
    const lane = normalizeLane(laneRaw, errors);
    if (!lane) {
      return { config: DEFAULT_BOARD_CONFIG, errors };
    }
    for (const status of lane.statuses) {
      if (seen.has(status)) {
        errors.push(`Status "${status}" is mapped to more than one lane.`);
        return { config: DEFAULT_BOARD_CONFIG, errors };
      }
      seen.add(status);
    }
    lanes.push(lane);
  }

  return { config: { schemaVersion: 1, lanes }, errors };
}

export function getLaneForStatus(config: BoardConfig, status: TaskStatus): BoardLaneConfig | null {
  return config.lanes.find((lane) => lane.statuses.includes(status)) ?? null;
}

function normalizeLane(raw: unknown, errors: string[]): BoardLaneConfig | null {
  if (!raw || typeof raw !== 'object') {
    errors.push('Lane entry is not an object.');
    return null;
  }

  const lane = raw as Record<string, unknown>;
  const id = typeof lane.id === 'string' ? lane.id.trim() : '';
  const title = typeof lane.title === 'string' ? lane.title.trim() : '';
  if (!id) {
    errors.push('A lane is missing an id.');
    return null;
  }
  if (!title) {
    errors.push(`Lane "${id}" is missing a title.`);
    return null;
  }

  const statuses: TaskStatus[] = [];
  if (Array.isArray(lane.statuses)) {
    for (const status of lane.statuses) {
      if (isTaskStatus(status)) statuses.push(status);
      else errors.push(`Lane "${id}" has unknown status "${String(status)}" (ignored).`);
    }
  }

  return {
    id,
    title,
    statuses,
    visible: lane.visible === undefined ? true : Boolean(lane.visible),
    definitionOfReady: toStringList(lane.definitionOfReady),
    definitionOfDone: toStringList(lane.definitionOfDone),
  };
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/config/BoardConfigStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/config/BoardConfigStore.ts tests/unit/features/tasks/config/BoardConfigStore.test.ts
git commit -m "feat: load and validate Agent Board config"
```

---

### Task 3: Implement resolveBoardLayout

**Files:**
- Create: `src/features/tasks/config/resolveBoardLayout.ts`
- Test: `tests/unit/features/tasks/config/resolveBoardLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/config/resolveBoardLayout.test.ts`:

```ts
import type { BoardConfig } from '../../../../../src/features/tasks/config/boardConfigTypes';
import { resolveBoardLayout } from '../../../../../src/features/tasks/config/resolveBoardLayout';
import type { TaskBoardModel, TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';

function task(id: string, status: TaskStatus): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    raw: '',
    body: '',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: id,
      status,
      priority: 'normal',
      created: 't',
      updated: 't',
      attempts: 0,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
  };
}

function model(...tasks: TaskSpec[]): TaskBoardModel {
  return { tasks, invalidNotes: [] };
}

const config: BoardConfig = {
  schemaVersion: 1,
  lanes: [
    { id: 'active', title: 'Active', statuses: ['ready', 'running'], visible: true, definitionOfReady: ['Clear'], definitionOfDone: [] },
    { id: 'closed', title: 'Closed', statuses: ['done'], visible: true, definitionOfReady: [], definitionOfDone: [] },
    { id: 'hidden', title: 'Hidden', statuses: ['failed'], visible: false, definitionOfReady: [], definitionOfDone: [] },
  ],
};

describe('resolveBoardLayout', () => {
  it('buckets tasks into matching visible lanes', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready'), task('b', 'running'), task('c', 'done')));
    expect(layout.lanes.map((lane) => lane.id)).toEqual(['active', 'closed']);
    expect(layout.lanes[0].tasks.map((t) => t.frontmatter.id)).toEqual(['a', 'b']);
    expect(layout.lanes[1].tasks.map((t) => t.frontmatter.id)).toEqual(['c']);
    expect(layout.errors).toEqual([]);
  });

  it('routes tasks with no visible lane into a catch-all appended last', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready'), task('z', 'failed'), task('y', 'inbox')));
    const last = layout.lanes[layout.lanes.length - 1];
    expect(last.isCatchAll).toBe(true);
    expect(last.title).toBe('Unsorted');
    expect(last.tasks.map((t) => t.frontmatter.id).sort()).toEqual(['y', 'z']);
    expect(layout.errors.length).toBe(1);
  });

  it('omits the catch-all when every task has a visible lane', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready')));
    expect(layout.lanes.some((lane) => lane.isCatchAll)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/config/resolveBoardLayout.test.ts
```

Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement the resolver**

Create `src/features/tasks/config/resolveBoardLayout.ts`:

```ts
import type { TaskBoardModel, TaskStatus } from '../model/taskTypes';
import type { BoardConfig, ResolvedBoardLayout, ResolvedLane } from './boardConfigTypes';

const CATCH_ALL_ID = 'unsorted';
const CATCH_ALL_TITLE = 'Unsorted';

export function resolveBoardLayout(config: BoardConfig, model: TaskBoardModel): ResolvedBoardLayout {
  const errors: string[] = [];
  const visibleLanes = config.lanes.filter((lane) => lane.visible);

  const buckets = new Map<string, ResolvedLane>();
  const ordered: ResolvedLane[] = visibleLanes.map((lane) => {
    const resolved: ResolvedLane = {
      id: lane.id,
      title: lane.title,
      tasks: [],
      definitionOfReady: lane.definitionOfReady,
      definitionOfDone: lane.definitionOfDone,
      isCatchAll: false,
    };
    buckets.set(lane.id, resolved);
    return resolved;
  });

  const findLane = (status: TaskStatus): ResolvedLane | null => {
    const lane = visibleLanes.find((candidate) => candidate.statuses.includes(status));
    return lane ? buckets.get(lane.id) ?? null : null;
  };

  const catchAll: ResolvedLane = {
    id: CATCH_ALL_ID,
    title: CATCH_ALL_TITLE,
    tasks: [],
    definitionOfReady: [],
    definitionOfDone: [],
    isCatchAll: true,
  };

  for (const task of model.tasks) {
    const lane = findLane(task.frontmatter.status);
    if (lane) lane.tasks.push(task);
    else catchAll.tasks.push(task);
  }

  const lanes = [...ordered];
  if (catchAll.tasks.length > 0) {
    lanes.push(catchAll);
    errors.push('Some work orders have a status with no visible lane and appear under "Unsorted".');
  }

  return { lanes, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/config/resolveBoardLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/config/resolveBoardLayout.ts tests/unit/features/tasks/config/resolveBoardLayout.test.ts
git commit -m "feat: resolve board layout with catch-all"
```

---

### Task 4: Inject lane criteria into the run prompt

**Files:**
- Modify: `src/features/tasks/prompt/TaskPromptRenderer.ts`
- Test: `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts`, inside the `describe('renderTaskPrompt', ...)` block:

```ts
  it('includes definition of ready and done when lane criteria are provided', () => {
    const prompt = renderTaskPrompt(task, { definitionOfReady: ['Objective is clear'], definitionOfDone: ['Tests pass'] });
    expect(prompt).toContain('## Definition of Ready');
    expect(prompt).toContain('- Objective is clear');
    expect(prompt).toContain('## Definition of Done');
    expect(prompt).toContain('- Tests pass');
  });

  it('omits criteria sections when the lane is absent or empty', () => {
    expect(renderTaskPrompt(task)).not.toContain('## Definition of Ready');
    expect(renderTaskPrompt(task, { definitionOfReady: [], definitionOfDone: [] })).not.toContain('## Definition of Done');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
```

Expected: FAIL — the new sections are missing.

- [ ] **Step 3: Implement the optional lane param**

Replace the entire contents of `src/features/tasks/prompt/TaskPromptRenderer.ts` with:

```ts
import type { TaskSpec } from '../model/taskTypes';

export interface TaskPromptLaneCriteria {
  definitionOfReady: string[];
  definitionOfDone: string[];
}

export function renderTaskPrompt(task: TaskSpec, lane?: TaskPromptLaneCriteria): string {
  const provider = task.frontmatter.provider ?? 'unspecified';
  const model = task.frontmatter.model ?? 'unspecified';

  const dor =
    lane && lane.definitionOfReady.length > 0
      ? `\n\n## Definition of Ready\n${lane.definitionOfReady.map((item) => `- ${item}`).join('\n')}`
      : '';
  const dod =
    lane && lane.definitionOfDone.length > 0
      ? `\n\n## Definition of Done\n${lane.definitionOfDone.map((item) => `- ${item}`).join('\n')}`
      : '';

  return `You are executing a Claudian work order. Complete only the task described below and respect all constraints.

## Work Order
Work order path: ${task.path}
Title: ${task.frontmatter.title}
Task ID: ${task.frontmatter.id}
Provider/model: ${provider} / ${model}

## Objective
${task.sections.objective}

## Acceptance Criteria
${task.sections.acceptanceCriteria}

## Context
${task.sections.context}

## Constraints
${task.sections.constraints}${dor}${dod}

## Required Structured Handoff
At the end of your final response, include exactly one strict handoff block in this format:

<claudian_handoff>
summary: Briefly describe what changed.
verification: List the checks you ran and their results.
risks: List remaining risks or write "None".
next_action: State the next concrete action for the human or follow-up agent.
</claudian_handoff>

The handoff fields are required. Do not omit summary, verification, risks, or next_action.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
```

Expected: PASS (the original assertions still pass; no lane → identical output).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/prompt/TaskPromptRenderer.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
git commit -m "feat: inject lane criteria into task prompt"
```

---

### Task 5: Inject renderPrompt into the run coordinator

**Files:**
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts`
- Test: `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`, inside `describe('TaskRunCoordinator', ...)`:

```ts
  it('uses an injected renderPrompt when provided', async () => {
    const surface = new FakeSurface({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });
    const coordinator = new TaskRunCoordinator({
      executionSurface: surface,
      now: () => '2026-05-28T18:10:00+02:00',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      writeTaskStatus: async () => {},
      appendLedger: async () => {},
      writeHandoff: async () => {},
      renderPrompt: () => 'INJECTED PROMPT',
    });

    await coordinator.run(makeTask());
    expect(surface.prompts[0]).toBe('INJECTED PROMPT');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
```

Expected: FAIL — `renderPrompt` is not a known dependency, and the surface receives the default prompt.

- [ ] **Step 3: Add the optional dependency**

In `src/features/tasks/execution/TaskRunCoordinator.ts`, add `renderPrompt` to `TaskRunCoordinatorDeps`:

```ts
export interface TaskRunCoordinatorDeps {
  executionSurface: TaskExecutionSurface;
  now: () => string;
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  writeTaskStatus: (task: TaskSpec, options: WriteTaskStatusOptions) => Promise<void>;
  appendLedger: (task: TaskSpec, entry: TaskLedgerEntry) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  renderPrompt?: (task: TaskSpec) => string;
}
```

Then replace the prompt line inside `run`:

```ts
      const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
```

(The existing `import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';` stays as the default.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
```

Expected: PASS (all prior coordinator tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/TaskRunCoordinator.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git commit -m "feat: allow injected task prompt rendering"
```

---

### Task 6: Add TaskNoteStore.writeFields

**Files:**
- Modify: `src/features/tasks/storage/TaskNoteStore.ts`
- Test: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`, inside `describe('TaskNoteStore', ...)`:

```ts
  it('writes frontmatter fields, bumps updated, and preserves unknown keys and body', () => {
    const written = store.writeFields(
      VALID_NOTE,
      { title: 'Renamed', provider: 'claude', model: 'sonnet', priority: 'high' },
      '2026-06-01T00:00:00.000Z',
    );

    const parsed = store.parse('tasks/task-1.md', written);
    expect(parsed.task.frontmatter.title).toBe('Renamed');
    expect(parsed.task.frontmatter.provider).toBe('claude');
    expect(parsed.task.frontmatter.model).toBe('sonnet');
    expect(parsed.task.frontmatter.priority).toBe('high');
    expect(parsed.task.frontmatter.updated).toBe('2026-06-01T00:00:00.000Z');
    expect(parsed.task.frontmatter.custom_field).toBe('keep-me');
    expect(written).toContain('Intro prose that must stay.');
    expect(written).toContain('Closing prose.');
  });

  it('leaves omitted fields unchanged', () => {
    const written = store.writeFields(VALID_NOTE, { title: 'Only title' }, '2026-06-01T00:00:00.000Z');
    const parsed = store.parse('tasks/task-1.md', written);
    expect(parsed.task.frontmatter.title).toBe('Only title');
    expect(parsed.task.frontmatter.priority).toBe('normal');
    expect(parsed.task.frontmatter.provider).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/storage/TaskNoteStore.test.ts
```

Expected: FAIL — `writeFields` is not a function.

- [ ] **Step 3: Implement writeFields**

In `src/features/tasks/storage/TaskNoteStore.ts`, extend the import to include `TaskPriority`:

```ts
import type { TaskLedgerEntry, TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
```

Add this interface near `WriteStatusOptions`:

```ts
export interface WriteFieldsOptions {
  title?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
}
```

Add this method to the `TaskNoteStore` class, directly after `writeStatus`:

```ts
  writeFields(content: string, fields: WriteFieldsOptions, timestamp: string = new Date().toISOString()): string {
    const parsed = this.parse('', content);
    const frontmatter: Record<string, unknown> = { ...parsed.task.frontmatter };

    if (fields.title !== undefined) frontmatter.title = fields.title;
    if (fields.provider !== undefined) frontmatter.provider = fields.provider;
    if (fields.model !== undefined) frontmatter.model = fields.model;
    if (fields.priority !== undefined) frontmatter.priority = fields.priority;
    frontmatter.updated = timestamp;

    return this.withFrontmatter(frontmatter, parsed.task.body);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/storage/TaskNoteStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/TaskNoteStore.ts tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "feat: edit work order frontmatter fields"
```

---

### Task 7: Parameterize work-order creation with status and reveal

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/features/tasks/commands/taskCommands.test.ts`, inside `describe('buildWorkOrderMarkdown', ...)`:

```ts
  it('emits the requested status, defaulting to ready', () => {
    const base = { id: 't', title: 'T', provider: 'codex', model: 'm', timestamp: '2026-05-28T18:00:00.000Z' };
    expect(buildWorkOrderMarkdown(base)).toContain('status: ready');
    expect(buildWorkOrderMarkdown({ ...base, status: 'inbox' })).toContain('status: inbox');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/commands/taskCommands.test.ts
```

Expected: FAIL — `status: inbox` is never emitted.

- [ ] **Step 3: Thread status and reveal through creation**

In `src/features/tasks/commands/taskCommands.ts`:

Add the import:

```ts
import type { TaskStatus } from '../model/taskTypes';
```

Extend `BuildWorkOrderArgs`:

```ts
interface BuildWorkOrderArgs {
  id: string;
  title: string;
  provider: string;
  model: string;
  timestamp: string;
  status?: TaskStatus;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
}
```

In `buildWorkOrderMarkdown`, destructure and use `status`:

```ts
  const { id, title, provider, model, timestamp, sourcePath, sourceFolderPath } = args;
  const status = args.status ?? 'ready';
```

Then change the frontmatter line from `status: ready` to:

```ts
status: ${status}
```

Add the options type above `createWorkOrder`:

```ts
export interface CreateWorkOrderOptions {
  status?: TaskStatus;
  reveal?: 'note' | 'none';
}
```

Change `createWorkOrder`'s signature and body:

```ts
export async function createWorkOrder(
  plugin: ClaudianPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
```

Pass `status` to the builder call:

```ts
  const markdown = buildWorkOrderMarkdown({
    id,
    title,
    provider,
    model,
    status: options?.status ?? 'ready',
    timestamp: now.toISOString(),
    sourcePath: sourceFile?.path ?? null,
    sourceFolderPath: sourceFolder?.path ?? null,
  });
```

Gate the reveal at the end:

```ts
  const created = await plugin.app.vault.create(filePath, markdown);
  if (created instanceof TFile) {
    if ((options?.reveal ?? 'note') === 'note') {
      await plugin.app.workspace.getLeaf('tab').openFile(created);
    }
    return created;
  }
  return null;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/commands/taskCommands.test.ts
```

Expected: PASS (existing builder tests still pass; default status is `ready`).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat: create work orders with explicit status"
```

---

### Task 8: Add refreshAgentBoards to the plugin

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the method**

In `src/main.ts`, add a method directly after `activateAgentBoardView()` (around line 380):

```ts
  refreshAgentBoards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)) {
      const view = leaf.view;
      if (view instanceof AgentBoardView) {
        void view.refresh();
      }
    }
  }
```

`VIEW_TYPE_CLAUDIAN_AGENT_BOARD` and `AgentBoardView` are already imported in `main.ts`.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: refresh open Agent Boards on demand"
```

---

### Task 9: Render the resolved layout with new card actions

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `src/style/features/agent-board.css`

- [ ] **Step 1: Rewrite the renderer**

Replace the entire contents of `src/features/tasks/ui/AgentBoardRenderer.ts` with:

```ts
import type { ResolvedBoardLayout, ResolvedLane } from '../config/boardConfigTypes';
import type { InvalidTaskNote, TaskSpec } from '../model/taskTypes';

export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onAddWorkOrder(): void;
}

export interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
}

export class AgentBoardRenderer {
  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    container.empty();
    const root = container.createDiv({ cls: 'claudian-agent-board' });

    const header = root.createDiv({ cls: 'claudian-agent-board-header' });
    const addButton = header.createEl('button', { cls: 'mod-cta', text: 'Add work order' });
    addButton.addEventListener('click', () => callbacks.onAddWorkOrder());

    const lanesEl = root.createDiv({ cls: 'claudian-agent-board-lanes' });
    for (const lane of state.layout.lanes) {
      this.renderLane(lanesEl, lane, callbacks);
    }

    if (state.layout.errors.length > 0 || state.invalidNotes.length > 0) {
      this.renderErrors(root, state.layout.errors, state.invalidNotes);
    }
  }

  private renderLane(parent: HTMLElement, lane: ResolvedLane, callbacks: AgentBoardRenderCallbacks): void {
    const laneEl = parent.createDiv({ cls: 'claudian-agent-board-lane' });
    const head = laneEl.createDiv({ cls: 'claudian-agent-board-lane-header' });
    head.createSpan({ text: lane.title });
    head.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(lane.tasks.length) });

    if (lane.definitionOfReady.length > 0 || lane.definitionOfDone.length > 0) {
      this.renderCriteria(laneEl, lane);
    }

    for (const task of lane.tasks) {
      this.renderCard(laneEl, task, callbacks);
    }
  }

  private renderCriteria(laneEl: HTMLElement, lane: ResolvedLane): void {
    const criteria = laneEl.createDiv({ cls: 'claudian-agent-board-lane-criteria' });
    if (lane.definitionOfReady.length > 0) {
      criteria.createDiv({ cls: 'claudian-agent-board-lane-criteria-label', text: 'Ready when' });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfReady) list.createEl('li', { text: item });
    }
    if (lane.definitionOfDone.length > 0) {
      criteria.createDiv({ cls: 'claudian-agent-board-lane-criteria-label', text: 'Done when' });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfDone) list.createEl('li', { text: item });
    }
  }

  private renderCard(parent: HTMLElement, task: TaskSpec, callbacks: AgentBoardRenderCallbacks): void {
    const card = parent.createDiv({ cls: 'claudian-agent-board-card' });
    card.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });

    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({ text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: task.frontmatter.priority });

    card.addEventListener('click', () => callbacks.onOpenDetail(task));

    const actions = card.createDiv({ cls: 'claudian-agent-board-card-actions' });
    if (task.frontmatter.status === 'inbox') {
      this.renderAction(actions, 'Mark ready', () => callbacks.onMarkReady(task));
    }
    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      this.renderAction(actions, 'Run', () => callbacks.onRun(task));
    }
    if (task.frontmatter.status === 'running') {
      this.renderAction(actions, 'Stop', () => callbacks.onStop(task));
    }
    if (task.frontmatter.status === 'review') {
      this.renderAction(actions, 'Accept', () => callbacks.onAccept(task));
      this.renderAction(actions, 'Rework', () => callbacks.onRework(task));
    }
  }

  private renderAction(parent: HTMLElement, label: string, handler: () => void): void {
    const button = parent.createEl('button', { text: label });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
  }

  private renderErrors(parent: HTMLElement, errors: string[], invalidNotes: InvalidTaskNote[]): void {
    const errorsEl = parent.createDiv({ cls: 'claudian-agent-board-errors' });
    if (errors.length > 0) {
      errorsEl.createEl('h4', { text: 'Board notices' });
      for (const message of errors) errorsEl.createDiv({ text: message });
    }
    if (invalidNotes.length > 0) {
      errorsEl.createEl('h4', { text: 'Skipped notes' });
      for (const note of invalidNotes) errorsEl.createDiv({ text: `${note.path}: ${note.error}` });
    }
  }
}
```

- [ ] **Step 2: Add CSS**

Append to `src/style/features/agent-board.css`:

```css
.claudian-agent-board-header {
  display: flex;
  justify-content: flex-end;
  flex: 0 0 auto;
}

.claudian-agent-board-lane-criteria {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  border-bottom: 1px solid var(--background-modifier-border);
  padding-bottom: 6px;
}

.claudian-agent-board-lane-criteria-label {
  font-weight: var(--font-semibold);
  margin-top: 4px;
}

.claudian-agent-board-lane-criteria ul {
  margin: 2px 0 0;
  padding-left: 16px;
}

.claudian-lane-editor-lane {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
}

.claudian-lane-editor-statuses {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0;
}

.claudian-lane-editor-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-ui-smaller);
}
```

- [ ] **Step 3: Verify**

`AgentBoardView` and `WorkOrderDetailModal` will not compile until Tasks 10–12 land, so run a scoped typecheck of the renderer by checking it compiles via the unit suite build is not possible yet. Defer full typecheck to Task 12. For now confirm no syntax errors:

```bash
npm run lint -- src/features/tasks/ui/AgentBoardRenderer.ts
```

Expected: PASS (lint compiles the file). If lint is not path-scoped in this repo, skip and rely on Task 12's `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts src/style/features/agent-board.css
git commit -m "feat: render configurable board lanes"
```

---

### Task 10: Make the detail modal editable

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts`

- [ ] **Step 1: Rewrite the modal**

Replace the entire contents of `src/features/tasks/ui/WorkOrderDetailModal.ts` with:

```ts
import { type App, type DropdownComponent, Modal, Setting } from 'obsidian';

import type { TaskPriority, TaskSpec } from '../model/taskTypes';

export interface WorkOrderFieldUpdate {
  title?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
}

export interface WorkOrderOption {
  value: string;
  label: string;
}

export interface WorkOrderDetailModalCallbacks {
  onOpenNote(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onSaveFields(task: TaskSpec, fields: WorkOrderFieldUpdate): void | Promise<void>;
  getProviderOptions(): WorkOrderOption[];
  getModelOptions(providerId: string): WorkOrderOption[];
}

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

export class WorkOrderDetailModal extends Modal {
  constructor(
    app: App,
    private readonly task: TaskSpec,
    private readonly callbacks: WorkOrderDetailModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    const { task } = this;
    this.setTitle(task.frontmatter.title);
    this.modalEl.addClass('claudian-work-order-modal');

    if (task.frontmatter.status === 'running') {
      this.renderReadOnlyMeta();
    } else {
      this.renderEditors();
    }

    this.renderSection('Objective', task.sections.objective);
    this.renderSection('Acceptance criteria', task.sections.acceptanceCriteria);
    this.renderSection('Run ledger', task.sections.ledger);
    this.renderSection('Handoff', task.sections.handoff);

    this.renderActions();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderReadOnlyMeta(): void {
    const { task } = this;
    const meta = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-meta' });
    meta.createSpan({ text: `Status: ${task.frontmatter.status}` });
    meta.createSpan({ text: `Provider: ${task.frontmatter.provider ?? '—'}` });
    meta.createSpan({ text: `Model: ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: `Priority: ${task.frontmatter.priority}` });
  }

  private renderEditors(): void {
    const { task } = this;

    this.contentEl
      .createDiv({ cls: 'claudian-work-order-modal-meta' })
      .createSpan({ text: `Status: ${task.frontmatter.status}` });

    new Setting(this.contentEl).setName('Title').addText((text) => {
      text.setValue(task.frontmatter.title);
      text.inputEl.addEventListener('blur', () => {
        const value = text.getValue().trim();
        if (value.length > 0 && value !== task.frontmatter.title) {
          void this.callbacks.onSaveFields(task, { title: value });
        }
      });
    });

    let modelDropdown: DropdownComponent | null = null;
    const populateModels = (providerId: string): void => {
      if (!modelDropdown) return;
      modelDropdown.selectEl.empty();
      modelDropdown.addOption('', 'Provider default');
      for (const option of this.callbacks.getModelOptions(providerId)) {
        modelDropdown.addOption(option.value, option.label);
      }
      modelDropdown.setValue(task.frontmatter.model ?? '');
    };

    new Setting(this.contentEl).setName('Provider').addDropdown((dropdown) => {
      for (const option of this.callbacks.getProviderOptions()) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(task.frontmatter.provider ?? '');
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { provider: value, model: '' });
        populateModels(value);
      });
    });

    new Setting(this.contentEl).setName('Model').addDropdown((dropdown) => {
      modelDropdown = dropdown;
      populateModels(task.frontmatter.provider ?? '');
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { model: value });
      });
    });

    new Setting(this.contentEl).setName('Priority').addDropdown((dropdown) => {
      for (const priority of PRIORITY_OPTIONS) {
        dropdown.addOption(priority, priority);
      }
      dropdown.setValue(task.frontmatter.priority);
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { priority: value as TaskPriority });
      });
    });
  }

  private renderActions(): void {
    const { task } = this;
    const actions = new Setting(this.contentEl);

    actions.addButton((btn) =>
      btn.setButtonText('Open note').onClick(() => {
        this.close();
        this.callbacks.onOpenNote(task);
      }),
    );

    if (task.frontmatter.status === 'inbox') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Mark ready')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onMarkReady(task);
          }),
      );
    }

    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Run')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onRun(task);
          }),
      );
    }

    if (task.frontmatter.status === 'running') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Stop')
          .setWarning()
          .onClick(() => {
            this.close();
            this.callbacks.onStop(task);
          }),
      );
    }

    if (task.frontmatter.status === 'review') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Accept')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onAccept(task);
          }),
      );
      actions.addButton((btn) =>
        btn.setButtonText('Rework').onClick(() => {
          this.close();
          this.callbacks.onRework(task);
        }),
      );
    }
  }

  private renderSection(label: string, body: string): void {
    this.contentEl.createEl('h4', { text: label });
    this.contentEl.createEl('pre', {
      cls: 'claudian-work-order-modal-section',
      text: body.length > 0 ? body : '—',
    });
  }
}
```

- [ ] **Step 2: Commit**

(Full typecheck runs in Task 12 once the view wires these callbacks.)

```bash
git add src/features/tasks/ui/WorkOrderDetailModal.ts
git commit -m "feat: edit work order fields in the detail modal"
```

---

### Task 11: Add the lane editor and wire it into settings

**Files:**
- Create: `src/features/tasks/ui/AgentBoardLaneEditor.ts`
- Modify: `src/features/settings/ui/AgentBoardSettingsSection.ts`

- [ ] **Step 1: Create the lane editor**

Create `src/features/tasks/ui/AgentBoardLaneEditor.ts`:

```ts
import { Setting } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { loadBoardConfig } from '../config/BoardConfigStore';
import { DEFAULT_BOARD_CONFIG, type BoardConfig, type BoardLaneConfig } from '../config/boardConfigTypes';
import { TASK_STATUSES } from '../model/taskStateMachine';

function cloneConfig(config: BoardConfig): BoardConfig {
  return JSON.parse(JSON.stringify(config)) as BoardConfig;
}

export function renderAgentBoardLaneEditor(container: HTMLElement, plugin: ClaudianPlugin): void {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  let config = cloneConfig(loadBoardConfig(settings).config);

  const wrap = container.createDiv({ cls: 'claudian-lane-editor' });

  const persist = async (): Promise<void> => {
    plugin.settings.agentBoardConfig = config;
    await plugin.saveSettings();
    plugin.refreshAgentBoards();
  };

  const swap = (a: number, b: number): void => {
    const lanes = config.lanes;
    [lanes[a], lanes[b]] = [lanes[b], lanes[a]];
  };

  const renderLaneBlock = (lane: BoardLaneConfig, index: number): void => {
    const block = wrap.createDiv({ cls: 'claudian-lane-editor-lane' });

    const head = new Setting(block).setName(`Lane ${index + 1}`).setDesc('Title and whether the lane shows on the board.');
    head.addText((text) =>
      text.setValue(lane.title).onChange(async (value) => {
        lane.title = value;
        await persist();
      }),
    );
    head.addToggle((toggle) =>
      toggle.setValue(lane.visible).onChange(async (value) => {
        lane.visible = value;
        await persist();
      }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-up')
        .setTooltip('Move up')
        .onClick(async () => {
          if (index === 0) return;
          swap(index - 1, index);
          await persist();
          rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-down')
        .setTooltip('Move down')
        .onClick(async () => {
          if (index >= config.lanes.length - 1) return;
          swap(index + 1, index);
          await persist();
          rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('trash-2')
        .setTooltip('Remove lane')
        .onClick(async () => {
          config.lanes.splice(index, 1);
          await persist();
          rerender();
        }),
    );

    const statusRow = block.createDiv({ cls: 'claudian-lane-editor-statuses' });
    for (const status of TASK_STATUSES) {
      const label = statusRow.createEl('label', { cls: 'claudian-lane-editor-status' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = lane.statuses.includes(status);
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
          if (!lane.statuses.includes(status)) lane.statuses.push(status);
        } else {
          lane.statuses = lane.statuses.filter((value) => value !== status);
        }
        await persist();
      });
      label.createSpan({ text: status });
    }

    renderCriteria(block, 'Definition of ready', lane.definitionOfReady, async (lines) => {
      lane.definitionOfReady = lines;
      await persist();
    });
    renderCriteria(block, 'Definition of done', lane.definitionOfDone, async (lines) => {
      lane.definitionOfDone = lines;
      await persist();
    });
  };

  const rerender = (): void => {
    wrap.empty();
    config.lanes.forEach((lane, index) => renderLaneBlock(lane, index));

    new Setting(wrap)
      .addButton((btn) =>
        btn.setButtonText('Add lane').onClick(async () => {
          config.lanes.push({
            id: `lane-${config.lanes.length + 1}-${TASK_STATUSES.length}`,
            title: 'New lane',
            statuses: [],
            visible: true,
            definitionOfReady: [],
            definitionOfDone: [],
          });
          await persist();
          rerender();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Reset to default')
          .setWarning()
          .onClick(async () => {
            config = cloneConfig(DEFAULT_BOARD_CONFIG);
            await persist();
            rerender();
          }),
      );
  };

  rerender();
}

function renderCriteria(
  parent: HTMLElement,
  label: string,
  lines: string[],
  onChange: (lines: string[]) => Promise<void>,
): void {
  new Setting(parent).setName(label).addTextArea((area) => {
    area.setValue(lines.join('\n'));
    area.onChange(async (value) => {
      await onChange(
        value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    });
  });
}
```

Note: new lane ids combine the current count with a constant so duplicate clicks before re-render still differ; ids are normalized on save and never shown to the user.

- [ ] **Step 2: Render the editor in settings**

In `src/features/settings/ui/AgentBoardSettingsSection.ts`, add the import:

```ts
import { renderAgentBoardLaneEditor } from '../../tasks/ui/AgentBoardLaneEditor';
```

In the work-order-folder `onChange` handler, refresh the board after saving:

```ts
        .onChange(async (value) => {
          plugin.settings.agentBoardWorkOrderFolder = value.trim();
          await plugin.saveSettings();
          plugin.refreshAgentBoards();
        }),
```

At the very end of `renderAgentBoardSettingsSection`, add:

```ts
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Board lanes" is sentence case; heading helper.
  container.createEl('h4', { text: 'Board lanes' });
  renderAgentBoardLaneEditor(container, plugin);
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardLaneEditor.ts src/features/settings/ui/AgentBoardSettingsSection.ts
git commit -m "feat: edit board lanes in settings"
```

---

### Task 12: Wire config, prompt injection, and QoL into the board view

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Rewrite the view**

Replace the entire contents of `src/features/tasks/ui/AgentBoardView.ts` with:

```ts
import type { TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '../../../core/types/chat';
import type ClaudianPlugin from '../../../main';
import { createWorkOrder } from '../commands/taskCommands';
import { getLaneForStatus, loadBoardConfig } from '../config/BoardConfigStore';
import type { BoardConfig, ResolvedBoardLayout } from '../config/boardConfigTypes';
import { resolveBoardLayout } from '../config/resolveBoardLayout';
import type { TaskExecutionSurface } from '../execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../execution/TaskRunCoordinator';
import { TaskIndexer } from '../indexing/TaskIndexer';
import { canTransitionTaskStatus } from '../model/taskStateMachine';
import type { TaskBoardModel, TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { AgentBoardRenderer } from './AgentBoardRenderer';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';

export class AgentBoardView extends ItemView {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly renderer = new AgentBoardRenderer();
  private model: TaskBoardModel = { tasks: [], invalidNotes: [] };
  private config: BoardConfig = loadBoardConfig({}).config;
  private layout: ResolvedBoardLayout = { lanes: [], errors: [] };
  private refreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
    private readonly executionSurface: TaskExecutionSurface,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN_AGENT_BOARD;
  }

  getDisplayText(): string {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    return 'Agent Board';
  }

  getIcon(): string {
    return 'kanban-square';
  }

  async onOpen(): Promise<void> {
    const { vault } = this.plugin.app;
    this.registerEvent(vault.on('create', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('modify', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('delete', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('rename', (file) => this.onVaultChange(file)));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    this.model = await this.indexer.indexVaultFolder(this.plugin.app.vault, this.folder);
    const { config, errors } = loadBoardConfig(settings);
    this.config = config;
    const layout = resolveBoardLayout(config, this.model);
    layout.errors = [...errors, ...layout.errors];
    this.layout = layout;
    this.render();
  }

  private get folder(): string {
    return (this.plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks').replace(/^\/+|\/+$/g, '');
  }

  private onVaultChange(file: TAbstractFile): void {
    if (!file.path.startsWith(`${this.folder}/`)) return;
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 100);
  }

  private render(): void {
    this.renderer.render(
      this.contentEl,
      { layout: this.layout, invalidNotes: this.model.invalidNotes },
      {
        onOpenDetail: (task) => this.openDetail(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onAccept: (task) => void this.transitionTask(task, 'done', 'Accepted from review.'),
        onRework: (task) => void this.transitionTask(task, 'needs_fix', 'Sent back for rework.'),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
      },
    );
  }

  private openDetail(task: TaskSpec): void {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    new WorkOrderDetailModal(this.plugin.app, task, {
      onOpenNote: (target) => void this.openTask(target),
      onRun: (target) => void this.runTask(target),
      onStop: (target) => this.stopTask(target),
      onAccept: (target) => void this.transitionTask(target, 'done', 'Accepted from review.'),
      onRework: (target) => void this.transitionTask(target, 'needs_fix', 'Sent back for rework.'),
      onMarkReady: (target) => void this.transitionTask(target, 'ready', 'Marked ready.'),
      onSaveFields: (target, fields) => this.saveTaskFields(target, fields),
      getProviderOptions: () =>
        ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
      getModelOptions: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
          ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
          : [],
    }).open();
  }

  private async openTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) {
      await this.plugin.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  private stopTask(task: TaskSpec): void {
    this.executionSurface.cancelTaskRun?.(task.frontmatter.run_id ?? '');
    new Notice(`Requested stop for "${task.frontmatter.title}".`);
  }

  private async saveTaskFields(task: TaskSpec, fields: WorkOrderFieldUpdate): Promise<void> {
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeFields(content, fields));
    await this.refresh();
  }

  private async addWorkOrderFromBoard(): Promise<void> {
    const created = await createWorkOrder(this.plugin, null, { status: 'inbox', reveal: 'none' });
    if (!created) return;
    await this.refresh();
    try {
      const content = await this.plugin.app.vault.read(created);
      const { task } = this.noteStore.parse(created.path, content);
      this.openDetail(task);
    } catch {
      // A freshly created note is well-formed; ignore parse failures defensively.
    }
  }

  private async transitionTask(task: TaskSpec, to: TaskStatus, message: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice('Work order file was not found.');
      await this.refresh();
      return;
    }

    let latest: TaskSpec;
    try {
      const content = await this.plugin.app.vault.read(file);
      latest = this.noteStore.parse(task.path, content).task;
    } catch (error) {
      new Notice(`Cannot update work order: ${error instanceof Error ? error.message : String(error)}`);
      await this.refresh();
      return;
    }

    if (!canTransitionTaskStatus(latest.frontmatter.status, to)) {
      new Notice(`Cannot move "${latest.frontmatter.title}" from ${latest.frontmatter.status} to ${to}.`);
      await this.refresh();
      return;
    }

    const timestamp = new Date().toISOString();
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, { status: to, timestamp }));
    await this.applyNoteChange(task.path, (content) =>
      this.noteStore.appendLedger(content, { timestamp, status: to, message }),
    );
    await this.refresh();
  }

  private async runTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice('Work order file was not found.');
      await this.refresh();
      return;
    }

    let latest: TaskSpec;
    try {
      const content = await this.plugin.app.vault.read(file);
      latest = this.noteStore.parse(task.path, content).task;
    } catch (error) {
      new Notice(`Cannot run work order: ${error instanceof Error ? error.message : String(error)}`);
      await this.refresh();
      return;
    }

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const coordinator = new TaskRunCoordinator({
      executionSurface: this.executionSurface,
      now: () => new Date().toISOString(),
      isProviderEnabled: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.isEnabled(providerId as ProviderId, settings),
      ownsModel: (providerId, model) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, settings),
      writeTaskStatus: (_task, options) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options)),
      appendLedger: (_task, entry) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.appendLedger(content, entry)),
      writeHandoff: (_task, markdown) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
      renderPrompt: (target) =>
        renderTaskPrompt(target, getLaneForStatus(this.config, target.frontmatter.status) ?? undefined),
    });

    const result = await coordinator.run(latest);
    if (!result.ok) {
      new Notice(`Work order run failed: ${result.error}`);
    }
    await this.refresh();
  }

  private async applyNoteChange(path: string, transform: (content: string) => string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.plugin.app.vault.read(file);
    await this.plugin.app.vault.modify(file, transform(content));
  }
}
```

The `TaskPriority` import is used by `WorkOrderFieldUpdate` consumers; keep it imported so future edits stay typed. If lint flags it as unused, remove `TaskPriority` from the import.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: PASS. Fix any unused-import lint error by trimming the import (e.g. drop `TaskPriority` if unused).

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat: wire configurable board and work order editing"
```

---

### Task 13: Full verification and PR handoff

**Files:**
- Modify only files required to fix verification failures.

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all PASS. `npm run build` rebuilds `styles.css` from `src/style`.

- [ ] **Step 2: Confirm clean status**

```bash
git status --short
```

Expected: no uncommitted changes (or only `styles.css` if the build regenerated it — commit it if so).

- [ ] **Step 3: Manual smoke test**

1. Reload the plugin and open Agent Board. Default ten lanes render exactly as before.
2. Settings → Agent Board → Board lanes: rename a lane, hide one, map `review` + `needs_fix` to one lane, add Definition of ready/done lines.
3. The board refreshes immediately to the new layout; lane criteria show under the lane header.
4. Hide the Inbox lane and confirm any inbox items appear under `Unsorted`.
5. Map a status to two lanes; confirm the board falls back to the default lanes and shows a board notice.
6. Reset to default; confirm the original layout returns.
7. Click "Add work order"; confirm a new Inbox card appears and the editable modal opens (no note tab).
8. In the modal, change title (blur), provider, model, priority; confirm the card and the note frontmatter update.
9. Click "Mark ready"; confirm the item moves to Ready and gains a Run action.
10. Run a work order from a lane with Definition of ready/done; confirm the fresh-tab prompt contains the Definition of Ready/Done sections.
11. Open a running work order's modal; confirm editors are read-only.
12. Send a direct chat message without a work order; confirm chat still works.

- [ ] **Step 4: Commit final fixes**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: polish Agent Board configurable lanes"
```

If no files changed, skip this commit.

- [ ] **Step 5: PR summary**

```md
## Summary

- adds configurable Agent Board lanes (titles, order, visibility, status mapping) with per-lane definition of ready/done, edited from settings
- injects the current lane's definition of ready/done into the run prompt as guidance
- adds board quality-of-life: add work order to Inbox from the board, inline frontmatter editing in the detail modal, and explicit Inbox→Ready promotion
- unmapped statuses fall into an "Unsorted" catch-all; duplicate status mapping falls back to the default config with a board notice

## Verification

- npm run typecheck
- npm run lint
- npm run test
- npm run build

## Risks

- settings-driven lane editor is the heaviest surface (reorder + status checkboxes)
- prompt grows with injected criteria; strict handoff parsing is unaffected
- default config renders identically to the previous board (non-regression)
```
```

