# Work-order Activity Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide work-order run tabs from the visible chat tab row and surface active work orders through a compact chat-header dropdown beside Quick Actions.

**Architecture:** Add provider-neutral work-order activity contracts in `src/core/types/`, keep activity summary and navigation in `features/tasks`, and render the dropdown from `features/chat` without importing tasks. `ClaudianView` reads a plugin-level `workOrderActivity` provider; tasks own indexing, task-event subscriptions, live-tab lookup, and detail-modal fallback.

**Tech Stack:** TypeScript, Obsidian plugin API, existing synchronous `EventBus`, Jest unit tests, modular CSS via `src/style/index.css`.

**Spec:** [[docs/superpowers/specs/2026-06-07-work-order-activity-dropdown-design.md]]

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/types/workOrderActivity.ts` | Shared item, summary, and provider interfaces consumed by chat. |
| `src/features/tasks/ui/workOrderActivitySummary.ts` | Pure active-status filtering, counts, labels, action hints, and urgency sorting. |
| `src/features/tasks/ui/WorkOrderActivityProvider.ts` | Task-owned provider that indexes work orders, listens to events, switches live tabs, and opens modal fallback. |
| `src/features/tasks/ui/WorkOrderDetailModal.ts` | Optional action callbacks so fallback modals are safe when run/stop/archive handlers are unavailable. |
| `src/features/chat/ui/WorkOrderActivityDropdown.ts` | Dropdown UI with count, attention state, row buttons, and keyboard activation. |
| `src/features/chat/ClaudianView.ts` | Mount dropdown beside Quick Actions; render only chat tab badges. |
| `src/main.ts` | Create and dispose the plugin-level activity provider. |
| `src/i18n/locales/*.json`, `src/i18n/types.ts` | Labels, hints, and aria copy. |
| `src/style/components/work-order-activity.css`, `src/style/index.css` | Dropdown styling and CSS build registration. |

---

### Task 1: Shared work-order activity contracts

**Files:**
- Create: `src/core/types/workOrderActivity.ts`
- Create: `tests/unit/core/types/workOrderActivity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/types/workOrderActivity.test.ts`:

```ts
import {
  EMPTY_WORK_ORDER_ACTIVITY_SUMMARY,
  isWorkOrderActivityStatus,
  type WorkOrderActivityItem,
  type WorkOrderActivityProvider,
} from '@/core/types/workOrderActivity';

describe('work-order activity contracts', () => {
  it('recognizes only active dropdown statuses', () => {
    expect(isWorkOrderActivityStatus('running')).toBe(true);
    expect(isWorkOrderActivityStatus('needs_input')).toBe(true);
    expect(isWorkOrderActivityStatus('needs_approval')).toBe(true);
    expect(isWorkOrderActivityStatus('review')).toBe(false);
    expect(isWorkOrderActivityStatus('done')).toBe(false);
  });

  it('exports an immutable empty summary and provider shape', () => {
    const item: WorkOrderActivityItem = {
      id: 'task-1',
      path: 'Agent Board/tasks/task-1.md',
      title: 'Task 1',
      status: 'needs_input',
      labelKey: 'workOrderActivity.status.needsInput',
      actionHintKey: 'workOrderActivity.action.reply',
      sidepanelTabId: 'tab-1',
    };
    const provider: WorkOrderActivityProvider = {
      getSummary: () => ({ items: [item], runningCount: 0, attentionCount: 1 }),
      subscribe: jest.fn(() => jest.fn()),
      openItem: jest.fn(async () => undefined),
      dispose: jest.fn(),
    };

    expect(EMPTY_WORK_ORDER_ACTIVITY_SUMMARY).toEqual({ items: [], runningCount: 0, attentionCount: 0 });
    expect(Object.isFrozen(EMPTY_WORK_ORDER_ACTIVITY_SUMMARY)).toBe(true);
    expect(provider.getSummary().items[0].actionHintKey).toBe('workOrderActivity.action.reply');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/core/types/workOrderActivity.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Add implementation**

Create `src/core/types/workOrderActivity.ts`:

```ts
import type { TranslationKey } from '../../i18n/types';

export type WorkOrderActivityStatus = 'running' | 'needs_input' | 'needs_approval';

export interface WorkOrderActivityItem {
  id: string;
  path: string;
  title: string;
  status: WorkOrderActivityStatus;
  labelKey: TranslationKey;
  actionHintKey: TranslationKey;
  sidepanelTabId?: string | null;
}

export interface WorkOrderActivitySummary {
  items: WorkOrderActivityItem[];
  runningCount: number;
  attentionCount: number;
}

export interface WorkOrderActivityProvider {
  getSummary(): WorkOrderActivitySummary;
  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void;
  openItem(id: string): Promise<void>;
  dispose(): void;
}

export const EMPTY_WORK_ORDER_ACTIVITY_SUMMARY: WorkOrderActivitySummary = Object.freeze({
  items: Object.freeze([]) as WorkOrderActivityItem[],
  runningCount: 0,
  attentionCount: 0,
});

const ACTIVE_STATUSES = new Set<string>(['running', 'needs_input', 'needs_approval']);

export function isWorkOrderActivityStatus(value: unknown): value is WorkOrderActivityStatus {
  return typeof value === 'string' && ACTIVE_STATUSES.has(value);
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/core/types/workOrderActivity.test.ts
git add src/core/types/workOrderActivity.ts tests/unit/core/types/workOrderActivity.test.ts
git commit -m "feat(tasks): add work-order activity contracts"
```

Expected: test PASS; commit created.

---

### Task 2: Active activity summary builder

**Files:**
- Create: `src/features/tasks/ui/workOrderActivitySummary.ts`
- Create: `tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts`:

```ts
import { buildWorkOrderActivitySummary } from '@/features/tasks/ui/workOrderActivitySummary';
import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';

function task(id: string, status: TaskStatus, title = id, sidepanelTabId?: string | null): TaskSpec {
  return {
    path: `Agent Board/tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title,
      status,
      priority: '2 - normal',
      created: '2026-06-07T00:00:00.000Z',
      updated: '2026-06-07T00:00:00.000Z',
      attempts: 0,
      sidepanel_tab_id: sidepanelTabId,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

describe('buildWorkOrderActivitySummary', () => {
  it('filters to active statuses, counts attention, and sorts by urgency', () => {
    const summary = buildWorkOrderActivitySummary([
      task('ready', 'ready'),
      task('running', 'running', 'Running', 'tab-running'),
      task('input', 'needs_input', 'Input', 'tab-input'),
      task('approval', 'needs_approval', 'Approval', 'tab-approval'),
      task('done', 'done'),
    ]);

    expect(summary.items.map((item) => item.id)).toEqual(['input', 'approval', 'running']);
    expect(summary.runningCount).toBe(1);
    expect(summary.attentionCount).toBe(2);
    expect(summary.items[0]).toEqual(expect.objectContaining({
      title: 'Input',
      status: 'needs_input',
      labelKey: 'workOrderActivity.status.needsInput',
      actionHintKey: 'workOrderActivity.action.reply',
      sidepanelTabId: 'tab-input',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Add implementation**

Create `src/features/tasks/ui/workOrderActivitySummary.ts`:

```ts
import type { WorkOrderActivityItem, WorkOrderActivityStatus, WorkOrderActivitySummary } from '../../../core/types/workOrderActivity';
import { isWorkOrderActivityStatus } from '../../../core/types/workOrderActivity';
import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec } from '../model/taskTypes';

const STATUS_RANK: Record<WorkOrderActivityStatus, number> = {
  needs_input: 0,
  needs_approval: 1,
  running: 2,
};

const STATUS_LABEL_KEYS: Record<WorkOrderActivityStatus, TranslationKey> = {
  running: 'workOrderActivity.status.running',
  needs_input: 'workOrderActivity.status.needsInput',
  needs_approval: 'workOrderActivity.status.needsApproval',
};

const ACTION_HINT_KEYS: Record<WorkOrderActivityStatus, TranslationKey> = {
  running: 'workOrderActivity.action.open',
  needs_input: 'workOrderActivity.action.reply',
  needs_approval: 'workOrderActivity.action.review',
};

export function buildWorkOrderActivitySummary(tasks: TaskSpec[]): WorkOrderActivitySummary {
  const items: WorkOrderActivityItem[] = [];
  for (const task of tasks) {
    const status = task.frontmatter.status;
    if (!isWorkOrderActivityStatus(status)) continue;
    items.push({
      id: task.frontmatter.id,
      path: task.path,
      title: task.frontmatter.title,
      status,
      labelKey: STATUS_LABEL_KEYS[status],
      actionHintKey: ACTION_HINT_KEYS[status],
      sidepanelTabId: task.frontmatter.sidepanel_tab_id ?? null,
    });
  }
  items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.title.localeCompare(b.title));
  return {
    items,
    runningCount: items.filter((item) => item.status === 'running').length,
    attentionCount: items.filter((item) => item.status !== 'running').length,
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts
git add src/features/tasks/ui/workOrderActivitySummary.ts tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts
git commit -m "feat(tasks): summarize active work-order activity"
```

Expected: test PASS; commit created.

---

### Task 3: Read-only-safe detail modal callbacks

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts`
- Modify: `tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts`

- [ ] **Step 1: Add failing tests**

Add two tests to `tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts` using its existing `makeTask`, `getButtonTexts`, and `mockApp` helpers:

```ts
it('hides running-only action buttons when optional callbacks are absent', () => {
  const modal = new WorkOrderDetailModal(mockApp, makeTask('readonly-running', 'running'), {
    onOpenNote: jest.fn(),
    getProviderOptions: () => [],
    getModelOptions: () => [],
  });
  modal.onOpen();

  expect(getButtonTexts()).toEqual(['Edit']);
});

it('renders Stop when the optional stop callback is present', () => {
  const modal = new WorkOrderDetailModal(mockApp, makeTask('stoppable-running', 'running'), {
    onOpenNote: jest.fn(),
    onStop: jest.fn(),
    getProviderOptions: () => [],
    getModelOptions: () => [],
  });
  modal.onOpen();

  expect(getButtonTexts()).toContain('Stop');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts
```

Expected: FAIL because current callbacks are required and buttons are not gated.

- [ ] **Step 3: Make callbacks optional and gate buttons**

In `src/features/tasks/ui/WorkOrderDetailModal.ts`, change `WorkOrderDetailModalCallbacks` so these members are optional: `onRun`, `onStop`, `onAccept`, `onRework`, `onMarkReady`, `onReopen`, `onArchive`, and `onSaveFields`.

For each action block, require the callback before rendering. Example:

```ts
if (task.frontmatter.status === 'running' && this.callbacks.onStop) {
  actions.addButton((btn) =>
    btn
      .setButtonText('Stop')
      .setWarning()
      .onClick(() => {
        this.close();
        this.callbacks.onStop?.(task);
      }),
  );
}
```

Apply the same pattern to ready/inbox/review/done/terminal action blocks, and change editor saves to optional calls:

```ts
void this.callbacks.onSaveFields?.(task, { title: value });
void this.callbacks.onSaveFields?.(task, { provider: value, model: '' });
void this.callbacks.onSaveFields?.(task, { model: value });
void this.callbacks.onSaveFields?.(task, { priority: value as TaskPriority });
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts
git add src/features/tasks/ui/WorkOrderDetailModal.ts tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts
git commit -m "refactor(tasks): allow read-only work-order detail modals"
```

Expected: test PASS; commit created.

---

### Task 4: Task-owned activity provider

**Files:**
- Create: `src/features/tasks/ui/WorkOrderActivityProvider.ts`
- Create: `tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing provider tests**

Create `tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts`:

```ts
import { WorkOrderActivityProvider } from '@/features/tasks/ui/WorkOrderActivityProvider';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

const activeTask: TaskSpec = {
  path: 'Agent Board/tasks/task-1.md',
  frontmatter: {
    type: 'claudian-work-order',
    schema_version: 1,
    id: 'task-1',
    title: 'Task 1',
    status: 'running',
    priority: '2 - normal',
    created: '2026-06-07T00:00:00.000Z',
    updated: '2026-06-07T00:00:00.000Z',
    attempts: 0,
    sidepanel_tab_id: 'tab-1',
  },
  sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
  body: '',
  raw: '',
};

function harness(overrides: Record<string, unknown> = {}) {
  const switchToTab = jest.fn(async () => undefined);
  const openDetailModal = jest.fn();
  const plugin: any = {
    settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
    events: { on: jest.fn(() => jest.fn()) },
    getAllViews: jest.fn(() => [{ getTabManager: () => ({ getTab: jest.fn(() => ({})), switchToTab }) }]),
    app: { vault: {}, workspace: {} },
    ...overrides,
  };
  const provider = new WorkOrderActivityProvider(plugin, {
    indexTasks: jest.fn(async () => ({ tasks: [activeTask], invalidNotes: [] })),
    openDetailModal,
  });
  return { provider, switchToTab, openDetailModal };
}

describe('WorkOrderActivityProvider', () => {
  it('refreshes and notifies subscribers', async () => {
    const { provider } = harness();
    const listener = jest.fn();
    provider.subscribe(listener);

    await provider.refresh();

    expect(provider.getSummary().items).toEqual([expect.objectContaining({ id: 'task-1' })]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ runningCount: 1 }));
  });

  it('switches to a live sidepanel tab before opening the modal', async () => {
    const { provider, switchToTab, openDetailModal } = harness();
    await provider.refresh();

    await provider.openItem('task-1');

    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(openDetailModal).not.toHaveBeenCalled();
  });

  it('falls back to detail modal when no live tab is found', async () => {
    const { provider, openDetailModal } = harness({ getAllViews: jest.fn(() => []) });
    await provider.refresh();

    await provider.openItem('task-1');

    expect(openDetailModal).toHaveBeenCalledWith(activeTask);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts
```

Expected: FAIL because the provider is missing.

- [ ] **Step 3: Add implementation**

Create `src/features/tasks/ui/WorkOrderActivityProvider.ts`:

```ts
import { TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { WorkOrderActivityProvider as WorkOrderActivityProviderContract, WorkOrderActivitySummary } from '../../../core/types/workOrderActivity';
import { EMPTY_WORK_ORDER_ACTIVITY_SUMMARY } from '../../../core/types/workOrderActivity';
import { asSettingsBag } from '../../../core/types/settings';
import type ClaudianPlugin from '../../../main';
import { TaskIndexer } from '../indexing/TaskIndexer';
import type { TaskBoardModel, TaskSpec } from '../model/taskTypes';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { buildWorkOrderConversationBindings } from './workOrderConversationBindings';
import { WorkOrderDetailModal } from './WorkOrderDetailModal';
import { buildWorkOrderActivitySummary } from './workOrderActivitySummary';

export interface WorkOrderActivityProviderDeps {
  indexTasks?: () => Promise<TaskBoardModel>;
  openDetailModal?: (task: TaskSpec) => void;
}

export class WorkOrderActivityProvider implements WorkOrderActivityProviderContract {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly listeners = new Set<(summary: WorkOrderActivitySummary) => void>();
  private summary: WorkOrderActivitySummary = EMPTY_WORK_ORDER_ACTIVITY_SUMMARY;
  private disposers: Array<() => void> = [];

  constructor(private readonly plugin: ClaudianPlugin, private readonly deps: WorkOrderActivityProviderDeps = {}) {}

  start(): void {
    const refresh = (): void => { void this.refresh(); };
    this.disposers = [
      this.plugin.events.on('task:run-started', refresh),
      this.plugin.events.on('task:status-changed', refresh),
      this.plugin.events.on('task:needs-input', refresh),
      this.plugin.events.on('task:needs-approval', refresh),
      this.plugin.events.on('task:run-finished', refresh),
      this.plugin.events.on('task:board-config-changed', refresh),
    ];
    void this.refresh();
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.listeners.clear();
  }

  getSummary(): WorkOrderActivitySummary {
    return this.summary;
  }

  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void {
    this.listeners.add(callback);
    callback(this.summary);
    return () => this.listeners.delete(callback);
  }

  async refresh(): Promise<void> {
    const model = await this.indexModel();
    this.summary = buildWorkOrderActivitySummary(model.tasks);
    for (const listener of [...this.listeners]) listener(this.summary);
  }

  async openItem(id: string): Promise<void> {
    const item = this.summary.items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.sidepanelTabId) {
      for (const view of this.plugin.getAllViews()) {
        const manager = view.getTabManager();
        if (!manager?.getTab(item.sidepanelTabId)) continue;
        await manager.switchToTab(item.sidepanelTabId);
        return;
      }
    }
    const model = await this.indexModel();
    const task = model.tasks.find((candidate) => candidate.frontmatter.id === id || candidate.path === item.path);
    if (task) this.openDetailModal(task);
  }

  private async indexModel(): Promise<TaskBoardModel> {
    if (this.deps.indexTasks) return this.deps.indexTasks();
    const settings = asSettingsBag(this.plugin.settings);
    return this.indexer.indexVaultFolder(this.plugin.app.vault, settings.agentBoardWorkOrderFolder ?? 'Agent Board/tasks');
  }

  private openDetailModal(task: TaskSpec): void {
    if (this.deps.openDetailModal) {
      this.deps.openDetailModal(task);
      return;
    }
    const settings = asSettingsBag(this.plugin.settings);
    new WorkOrderDetailModal(this.plugin.app, task, {
      onOpenNote: (target) => this.openNote(target),
      ...buildWorkOrderConversationBindings(this.plugin),
      getProviderOptions: () => ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
      getModelOptions: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
          ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
          : [],
    }).open();
  }

  private async openNote(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file);
  }
}
```

- [ ] **Step 4: Wire plugin ownership**

In `src/main.ts`, add:

```ts
import { WorkOrderActivityProvider } from './features/tasks/ui/WorkOrderActivityProvider';
```

Add a class field:

```ts
workOrderActivity: WorkOrderActivityProvider | null = null;
```

After settings/storage initialization in `onload()`, initialize:

```ts
this.workOrderActivity = new WorkOrderActivityProvider(this);
this.workOrderActivity.start();
this.register(() => {
  this.workOrderActivity?.dispose();
  this.workOrderActivity = null;
});
```

- [ ] **Step 5: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts
npm run typecheck
git add src/features/tasks/ui/WorkOrderActivityProvider.ts tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts src/main.ts
git commit -m "feat(tasks): expose work-order activity provider"
```

Expected: tests/typecheck PASS; commit created.

---

### Task 5: Chat dropdown UI component

**Files:**
- Create: `src/features/chat/ui/WorkOrderActivityDropdown.ts`
- Create: `tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts`:

```ts
import { createMockEl } from '@test/helpers/mockElement';

import type { WorkOrderActivitySummary } from '@/core/types/workOrderActivity';
import { WorkOrderActivityDropdown } from '@/features/chat/ui/WorkOrderActivityDropdown';

const item = {
  id: 'task-1',
  path: 'Agent Board/tasks/task-1.md',
  title: 'Task 1',
  status: 'needs_input' as const,
  labelKey: 'workOrderActivity.status.needsInput' as const,
  actionHintKey: 'workOrderActivity.action.reply' as const,
  sidepanelTabId: 'tab-1',
};

describe('WorkOrderActivityDropdown', () => {
  it('renders nothing with no active items', () => {
    const host = createMockEl();
    new WorkOrderActivityDropdown(host, { summary: { items: [], runningCount: 0, attentionCount: 0 }, onOpenItem: jest.fn() });
    expect(host._children).toHaveLength(0);
  });

  it('renders count, attention state, rows, and delegates selection', async () => {
    const host = createMockEl();
    const onOpenItem = jest.fn(async () => undefined);
    const summary: WorkOrderActivitySummary = { items: [item], runningCount: 0, attentionCount: 1 };
    new WorkOrderActivityDropdown(host, { summary, onOpenItem });

    const toggle = host.querySelector('.claudian-work-order-activity-toggle');
    expect(toggle?.hasClass('claudian-work-order-activity-toggle--attention')).toBe(true);
    expect(host.querySelector('.claudian-work-order-activity-count')?.textContent).toBe('1');

    toggle?.click();
    const row = host.querySelector('.claudian-work-order-activity-item');
    expect(row?.textContent).toContain('Task 1');
    row?.click();
    await Promise.resolve();

    expect(onOpenItem).toHaveBeenCalledWith('task-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts
```

Expected: FAIL because the component is missing.

- [ ] **Step 3: Add component**

Create `src/features/chat/ui/WorkOrderActivityDropdown.ts`:

```ts
import { setIcon } from 'obsidian';

import type { WorkOrderActivitySummary } from '../../../core/types/workOrderActivity';
import { t } from '../../../i18n/i18n';

export interface WorkOrderActivityDropdownProps {
  summary: WorkOrderActivitySummary;
  onOpenItem(id: string): void | Promise<void>;
}

export class WorkOrderActivityDropdown {
  private open = false;

  constructor(private readonly hostEl: HTMLElement, private props: WorkOrderActivityDropdownProps) {
    this.render();
  }

  update(summary: WorkOrderActivitySummary): void {
    this.props = { ...this.props, summary };
    if (summary.items.length === 0) this.open = false;
    this.render();
  }

  destroy(): void {
    this.hostEl.empty();
  }

  private render(): void {
    this.hostEl.empty();
    const { summary } = this.props;
    if (summary.items.length === 0) return;
    const root = this.hostEl.createDiv({ cls: 'claudian-work-order-activity' });
    const classes = ['claudian-header-btn', 'claudian-work-order-activity-toggle'];
    if (summary.attentionCount > 0) classes.push('claudian-work-order-activity-toggle--attention');
    const toggle = root.createDiv({ cls: classes.join(' ') });
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    toggle.setAttribute('aria-label', this.toggleLabel(summary));
    setIcon(toggle.createSpan({ cls: 'claudian-work-order-activity-icon' }), 'clipboard-list');
    toggle.createSpan({ cls: 'claudian-work-order-activity-count', text: String(summary.items.length) });
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.open = !this.open;
      this.render();
    });
    if (this.open) this.renderMenu(root);
  }

  private renderMenu(root: HTMLElement): void {
    const menu = root.createDiv({ cls: 'claudian-work-order-activity-menu' });
    menu.setAttribute('role', 'menu');
    for (const item of this.props.summary.items) {
      const row = menu.createDiv({ cls: 'claudian-work-order-activity-item' });
      row.setAttribute('role', 'menuitem');
      row.setAttribute('tabindex', '0');
      row.createSpan({ cls: 'claudian-work-order-activity-title', text: item.title });
      row.createSpan({ cls: 'claudian-work-order-activity-status', text: t(item.labelKey) });
      row.createSpan({ cls: 'claudian-work-order-activity-action', text: t(item.actionHintKey) });
      row.addEventListener('click', () => {
        this.open = false;
        void this.props.onOpenItem(item.id);
        this.render();
      });
    }
  }

  private toggleLabel(summary: WorkOrderActivitySummary): string {
    if (summary.attentionCount > 0) {
      return t('workOrderActivity.toggleAttention', {
        count: String(summary.items.length),
        attention: String(summary.attentionCount),
      });
    }
    return t('workOrderActivity.toggleRunning', { count: String(summary.items.length) });
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts
git add src/features/chat/ui/WorkOrderActivityDropdown.ts tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts
git commit -m "feat(chat): add work-order activity dropdown component"
```

Expected: test PASS; commit created.

---

### Task 6: Wire dropdown into `ClaudianView`

**Files:**
- Modify: `src/features/chat/ClaudianView.ts`
- Modify: `tests/unit/features/chat/ClaudianView.test.ts`

- [ ] **Step 1: Write failing view tests**

Add to `tests/unit/features/chat/ClaudianView.test.ts`:

```ts
describe('ClaudianView work-order activity', () => {
  it('mounts an activity slot beside Quick Actions', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.containerEl = createMockEl();
    view.containerEl.ownerDocument.createDocumentFragment = () => createMockEl('fragment');
    view.plugin = {
      gitStatusWatcher: null,
      vaultSkillAggregator: null,
      settings: {},
      workOrderActivity: {
        getSummary: () => ({ items: [], runningCount: 0, attentionCount: 0 }),
        subscribe: jest.fn(() => jest.fn()),
        openItem: jest.fn(),
      },
    };
    view.tabManager = { getActiveTab: jest.fn(() => null) };
    view.syncHeaderLogo = jest.fn();
    view.buildHeader(createMockEl());

    const navContent = view.buildNavRowContent();

    expect(navContent.querySelector('.claudian-work-order-activity-slot')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/ClaudianView.test.ts
```

Expected: FAIL because the slot is missing.

- [ ] **Step 3: Mount and dispose dropdown**

In `src/features/chat/ClaudianView.ts`, import:

```ts
import { WorkOrderActivityDropdown } from './ui/WorkOrderActivityDropdown';
```

Add fields:

```ts
private workOrderActivitySlotEl: HTMLElement | null = null;
private workOrderActivityDropdown: WorkOrderActivityDropdown | null = null;
private disposeWorkOrderActivitySubscription: (() => void) | null = null;
```

After the Quick Actions button click listener in `buildNavRowContent()`, add:

```ts
this.workOrderActivitySlotEl = this.headerActionsContent.createDiv({ cls: 'claudian-work-order-activity-slot' });
this.mountWorkOrderActivityDropdown();
```

Add method:

```ts
private mountWorkOrderActivityDropdown(): void {
  if (!this.workOrderActivitySlotEl || !this.plugin.workOrderActivity) return;
  this.disposeWorkOrderActivitySubscription?.();
  this.workOrderActivityDropdown?.destroy();
  this.workOrderActivityDropdown = new WorkOrderActivityDropdown(this.workOrderActivitySlotEl, {
    summary: this.plugin.workOrderActivity.getSummary(),
    onOpenItem: (id) => this.plugin.workOrderActivity?.openItem(id),
  });
  this.disposeWorkOrderActivitySubscription = this.plugin.workOrderActivity.subscribe((summary) => {
    this.workOrderActivityDropdown?.update(summary);
  });
}
```

In both `teardownTabContent()` and `onClose()`, add:

```ts
this.disposeWorkOrderActivitySubscription?.();
this.disposeWorkOrderActivitySubscription = null;
this.workOrderActivityDropdown?.destroy();
this.workOrderActivityDropdown = null;
this.workOrderActivitySlotEl = null;
```

- [ ] **Step 4: Verify direct chat independence**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/ClaudianView.test.ts -t "chat feature never imports the tasks"
npm run test -- --selectProjects unit tests/unit/features/chat/ClaudianView.test.ts
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ClaudianView.ts tests/unit/features/chat/ClaudianView.test.ts
git commit -m "feat(chat): mount work-order activity dropdown"
```

---

### Task 7: Hide work-order tabs from visible badge row

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts`
- Modify: `src/features/chat/ClaudianView.ts`
- Modify: `tests/unit/features/chat/tabs/TabManager.test.ts`
- Modify: `tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts`

- [ ] **Step 1: Update failing tab tests**

Replace the current `orders chat tabs before work-order tabs in getTabBarItems` assertion with:

```ts
expect(manager.getOrderedTabs().map((tab) => tab.kind)).toEqual(['chat', 'chat', 'work-order', 'work-order']);
expect(manager.getTabBarItems().map((item) => item.kind)).toEqual(['chat', 'chat']);
```

Replace `tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts` with a small compatibility test:

```ts
import { createMockEl } from '@test/helpers/mockElement';
import { TabBar } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

const item: TabBarItem = {
  id: 'chat',
  index: 1,
  title: 'Chat',
  providerId: 'claude',
  isActive: false,
  isStreaming: false,
  needsAttention: false,
  canClose: true,
  kind: 'chat',
};

describe('TabBar visible work-order removal', () => {
  it('renders the filtered chat items it receives', () => {
    const host = createMockEl();
    new TabBar(host, { onTabClick: jest.fn(), onTabClose: jest.fn(), onNewTab: jest.fn() }).update([item]);
    expect(host._children).toHaveLength(1);
    expect(host._children[0].getAttribute('data-kind')).toBe('chat');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabManager.test.ts tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts
```

Expected: FAIL because `getTabBarItems()` still returns work-order items.

- [ ] **Step 3: Filter in `TabManager.getTabBarItems()` and update visibility count**

In `src/features/chat/tabs/TabManager.ts`, add the guard:

```ts
for (const tab of this.getOrderedTabs()) {
  if (tab.kind === 'work-order') continue;
  items.push({
    id: tab.id,
    index: index++,
    title: getTabTitle(tab, this.plugin),
    providerId: getTabProviderId(tab, this.plugin),
    isActive: tab.id === this.activeTabId,
    isStreaming: tab.state.isStreaming,
    needsAttention: tab.state.needsAttention,
    canClose: this.tabs.size > 1 || !tab.state.isStreaming,
    kind: tab.kind,
  });
}
```

In `src/features/chat/ClaudianView.ts`, change `updateTabBarVisibility()` to count only chat tabs:

```ts
const tabCount = this.tabManager.countTabsByKind('chat');
const showTabBar = tabCount >= 2;
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabManager.test.ts tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts tests/unit/features/chat/ClaudianView.test.ts
git add src/features/chat/tabs/TabManager.ts src/features/chat/ClaudianView.ts tests/unit/features/chat/tabs/TabManager.test.ts tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts
git commit -m "feat(tabs): hide work-order tabs from visible badge row"
```

Expected: tests PASS; commit created.

---

### Task 8: I18n and CSS

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: all other `src/i18n/locales/*.json`
- Modify: `src/i18n/types.ts`
- Modify: `tests/unit/i18n/locales.test.ts`
- Create: `src/style/components/work-order-activity.css`
- Modify: `src/style/index.css`

- [ ] **Step 1: Add locale test keys**

Add to `localizedKeys` in `tests/unit/i18n/locales.test.ts`:

```ts
'workOrderActivity.toggleRunning',
'workOrderActivity.toggleAttention',
'workOrderActivity.status.running',
'workOrderActivity.status.needsInput',
'workOrderActivity.status.needsApproval',
'workOrderActivity.action.open',
'workOrderActivity.action.reply',
'workOrderActivity.action.review',
```

- [ ] **Step 2: Run locale test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/i18n/locales.test.ts
```

Expected: FAIL because locale keys are missing.

- [ ] **Step 3: Add i18n keys**

Add this top-level object to `src/i18n/locales/en.json`:

```json
"workOrderActivity": {
  "toggleRunning": "{count} active work order(s)",
  "toggleAttention": "{count} active work order(s), {attention} needs attention",
  "status": {
    "running": "Running",
    "needsInput": "Needs input",
    "needsApproval": "Needs approval"
  },
  "action": {
    "open": "Open",
    "reply": "Reply",
    "review": "Review"
  }
}
```

Add the same object shape to the other locale files with these values:

```json
// de.json
"workOrderActivity": { "toggleRunning": "{count} aktive Arbeitsauftrag(e)", "toggleAttention": "{count} aktive Arbeitsauftrag(e), {attention} benötigt Aufmerksamkeit", "status": { "running": "Läuft", "needsInput": "Benötigt Eingabe", "needsApproval": "Benötigt Freigabe" }, "action": { "open": "Öffnen", "reply": "Antworten", "review": "Prüfen" } }

// es.json
"workOrderActivity": { "toggleRunning": "{count} orden(es) de trabajo activa(s)", "toggleAttention": "{count} orden(es) de trabajo activa(s), {attention} requiere atención", "status": { "running": "En ejecución", "needsInput": "Necesita entrada", "needsApproval": "Necesita aprobación" }, "action": { "open": "Abrir", "reply": "Responder", "review": "Revisar" } }

// fr.json
"workOrderActivity": { "toggleRunning": "{count} ordre(s) de travail actif(s)", "toggleAttention": "{count} ordre(s) de travail actif(s), {attention} demande attention", "status": { "running": "En cours", "needsInput": "Demande une réponse", "needsApproval": "Demande approbation" }, "action": { "open": "Ouvrir", "reply": "Répondre", "review": "Examiner" } }

// ja.json
"workOrderActivity": { "toggleRunning": "アクティブな作業指示 {count} 件", "toggleAttention": "アクティブな作業指示 {count} 件、要対応 {attention} 件", "status": { "running": "実行中", "needsInput": "入力が必要", "needsApproval": "承認が必要" }, "action": { "open": "開く", "reply": "返信", "review": "確認" } }

// ko.json
"workOrderActivity": { "toggleRunning": "활성 작업 지시 {count}개", "toggleAttention": "활성 작업 지시 {count}개, 주의 필요 {attention}개", "status": { "running": "실행 중", "needsInput": "입력 필요", "needsApproval": "승인 필요" }, "action": { "open": "열기", "reply": "응답", "review": "검토" } }

// pt.json
"workOrderActivity": { "toggleRunning": "{count} ordem(ns) de trabalho ativa(s)", "toggleAttention": "{count} ordem(ns) de trabalho ativa(s), {attention} precisa de atenção", "status": { "running": "Em execução", "needsInput": "Precisa de resposta", "needsApproval": "Precisa de aprovação" }, "action": { "open": "Abrir", "reply": "Responder", "review": "Revisar" } }

// ru.json
"workOrderActivity": { "toggleRunning": "Активных рабочих заданий: {count}", "toggleAttention": "Активных рабочих заданий: {count}, требуют внимания: {attention}", "status": { "running": "Выполняется", "needsInput": "Нужен ввод", "needsApproval": "Нужно одобрение" }, "action": { "open": "Открыть", "reply": "Ответить", "review": "Проверить" } }

// zh-CN.json
"workOrderActivity": { "toggleRunning": "{count} 个活动工单", "toggleAttention": "{count} 个活动工单，{attention} 个需要处理", "status": { "running": "运行中", "needsInput": "需要输入", "needsApproval": "需要批准" }, "action": { "open": "打开", "reply": "回复", "review": "审阅" } }

// zh-TW.json
"workOrderActivity": { "toggleRunning": "{count} 個活動工作單", "toggleAttention": "{count} 個活動工作單，{attention} 個需要處理", "status": { "running": "執行中", "needsInput": "需要輸入", "needsApproval": "需要核准" }, "action": { "open": "開啟", "reply": "回覆", "review": "審閱" } }
```

Add these union members to `src/i18n/types.ts`:

```ts
| 'workOrderActivity.toggleRunning'
| 'workOrderActivity.toggleAttention'
| 'workOrderActivity.status.running'
| 'workOrderActivity.status.needsInput'
| 'workOrderActivity.status.needsApproval'
| 'workOrderActivity.action.open'
| 'workOrderActivity.action.reply'
| 'workOrderActivity.action.review'
```

- [ ] **Step 4: Add CSS**

Create `src/style/components/work-order-activity.css`:

```css
.claudian-work-order-activity-slot {
  position: relative;
  display: flex;
  align-items: center;
}

.claudian-work-order-activity {
  position: relative;
  display: flex;
  align-items: center;
}

.claudian-work-order-activity-toggle {
  gap: 3px;
}

.claudian-work-order-activity-toggle--attention {
  color: var(--text-accent);
}

.claudian-work-order-activity-count {
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--background-modifier-border);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}

.claudian-work-order-activity-toggle--attention .claudian-work-order-activity-count {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.claudian-work-order-activity-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1000;
  min-width: 240px;
  max-width: min(360px, 80vw);
  padding: 6px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-primary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.claudian-work-order-activity-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "title action" "status action";
  gap: 2px 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.claudian-work-order-activity-item:hover,
.claudian-work-order-activity-item:focus {
  background: var(--background-modifier-hover);
  outline: none;
}

.claudian-work-order-activity-title {
  grid-area: title;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-normal);
  font-size: 12px;
}

.claudian-work-order-activity-status {
  grid-area: status;
  color: var(--text-muted);
  font-size: 11px;
}

.claudian-work-order-activity-action {
  grid-area: action;
  align-self: center;
  color: var(--interactive-accent);
  font-size: 11px;
  font-weight: 600;
}
```

Add this import after `components/tabs.css` in `src/style/index.css`:

```css
@import "./components/work-order-activity.css";
```

- [ ] **Step 5: Verify and commit**

```bash
npm run test -- --selectProjects unit tests/unit/i18n/locales.test.ts
npm run build:css
git add src/i18n/locales src/i18n/types.ts tests/unit/i18n/locales.test.ts src/style/components/work-order-activity.css src/style/index.css
git commit -m "feat(ui): localize and style work-order activity dropdown"
```

Expected: locale test and CSS build PASS; commit created.

---

### Task 9: Final docs and verification

**Files:**
- Modify: `src/features/chat/CLAUDE.md`
- Modify: `src/features/tasks/CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-07-work-order-activity-dropdown-design.md`

- [ ] **Step 1: Update docs**

In `src/features/chat/CLAUDE.md`, add under Gotchas:

```md
- Work-order run tabs are real `TabManager` tabs but hidden from the visible tab badge row. The chat header Work Orders dropdown is the navigation affordance for active work-order tabs; ordinary tab badges render chat tabs only.
```

In `src/features/tasks/CLAUDE.md`, add under Components:

```md
- **`ui/WorkOrderActivityProvider`**: plugin-level activity provider for the chat header dropdown. It indexes active `running` / `needs_input` / `needs_approval` work orders, exposes counts and rows through `core/types/workOrderActivity`, switches to live sidepanel tabs when possible, and falls back to a read-only-safe `WorkOrderDetailModal`.
```

In `docs/superpowers/specs/2026-06-07-work-order-activity-dropdown-design.md`, change:

```yaml
status: implemented
```

- [ ] **Step 2: Run targeted verification**

```bash
npm run test -- --selectProjects unit tests/unit/core/types/workOrderActivity.test.ts tests/unit/features/tasks/ui/workOrderActivitySummary.test.ts tests/unit/features/tasks/ui/WorkOrderActivityProvider.test.ts tests/unit/features/chat/ui/WorkOrderActivityDropdown.test.ts tests/unit/features/chat/ClaudianView.test.ts tests/unit/features/chat/tabs/TabManager.test.ts tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts tests/unit/i18n/locales.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Commit docs**

```bash
git add src/features/chat/CLAUDE.md src/features/tasks/CLAUDE.md docs/superpowers/specs/2026-06-07-work-order-activity-dropdown-design.md
git commit -m "docs: mark work-order activity dropdown implemented"
```

Expected: docs commit created after verification.

---

## Self-review against spec

- Active-only dropdown: Task 2 filters exactly `running`, `needs_input`, and `needs_approval`.
- Row click live-tab first, detail-modal fallback: Task 4 implements sidepanel-tab switch first and modal fallback.
- Work-order tabs hidden from badge row: Task 7 filters visible tab bar items while preserving internal tabs.
- Toggle count and attention state: Tasks 5 and 8 implement count, attention class, labels, and styling.
- Row title/status/action hint: Tasks 2, 5, and 8 provide row content and localized strings.
- Placement beside Quick Actions: Task 6 mounts the slot immediately after Quick Actions.
- Accessibility: Task 5 uses button/menu roles, `aria-haspopup`, `aria-expanded`, keyboard-focusable rows, and text labels.
- Non-goals remain excluded: no mini Agent Board, no terminal/review rows, no queue changes, no auto-close, and no drag/reorder behavior.
