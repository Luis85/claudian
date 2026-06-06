---
status: done
date: 2026-06-04
scope: features/tasks, features/chat, app/settings
parent: "[[2026-06-04-commit-and-push-on-accept-design]]"
relations:
  - "[[Agent Kanban Board]]"
tags:
  - tasks
  - git
---

# Commit & push on Accept Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks Accept on a Work-Order in a dirty git-backed vault, show a modal that, on confirm, injects a scoped commit prompt (work-order title + id + objective + checked acceptance criteria) into the work-order's chat conversation so the active provider's agent commits and pushes.

**Architecture:** A new `CommitOnAcceptCoordinator` subscribes to the existing `task:status-changed` event. On `status === 'done'`, it gates on the master toggle, provider opt-in, and `GitStatusWatcher` state, then opens a confirm modal. Confirmed flows go to a new `TaskExecutionSurface.requestCommitTurn(task, prompt)` method. The chat-side `ChatTabExecutionSurface` implementation focuses the work-order's existing conversation tab (reopening if disposed) or opens a fresh task-run tab as fallback, then calls `InputController.sendMessage` with the scoped prompt. No git mutation runs in the plugin — the provider's agent owns staging/commit/push.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Modal`, `Setting`, `Notice`), Jest (`jest-environment-jsdom`), the existing `EventBus`, `TaskNoteStore`, `GitStatusWatcher`, `ChatTabExecutionSurface`, and `ClaudianSettingsStorage`.

**Spec:** [[2026-06-04-commit-and-push-on-accept-design]]

---

## File structure

**Create:**
- `src/features/tasks/commit/scopedCommitPrompt.ts` — pure function `buildScopedCommitPrompt(task, dirtyCount): string`
- `src/features/tasks/commit/CommitOnAcceptModal.ts` — Obsidian `Modal` with checkbox + Skip / Commit & push buttons
- `src/features/tasks/commit/CommitOnAcceptCoordinator.ts` — event subscriber, orchestrator, lifecycle (`start()` / `stop()`)
- `tests/unit/features/tasks/commit/scopedCommitPrompt.test.ts`
- `tests/unit/features/tasks/commit/CommitOnAcceptModal.test.ts`
- `tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts`
- `tests/integration/features/tasks/commit/acceptCommitFlow.integration.test.ts`

**Modify:**
- `src/core/types/settings.ts` — add `promptCommitOnAccept?: boolean`
- `src/app/settings/defaultSettings.ts` — set `promptCommitOnAccept: true`
- `src/features/tasks/execution/TaskExecutionSurface.ts` — extend interface with optional `requestCommitTurn?(task, prompt): Promise<void>`
- `src/features/tasks/execution/ChatTabExecutionSurface.ts` — implement `requestCommitTurn`
- `src/features/chat/ClaudianView.ts` — add public `injectCommitTurnForConversation(opts)` helper used by the surface
- `src/features/settings/registry/fields/agentBoard.ts` — register the toggle field under a new `commitOnAccept` section
- `src/i18n/locales/en.json` — add `tasks.commitOnAccept.*` and `settings.agentBoard.commitOnAccept.*` strings
- `src/main.ts` — instantiate `CommitOnAcceptCoordinator` after `installGitWatcher()` and `ChatTabExecutionSurface`; call `start()`; call `stop()` in `onunload()`
- `tests/unit/features/tasks/execution/ChatTabExecutionSurface.test.ts` — if absent create it; if present extend it (see Task 5)

---

## Task 1: Add settings field and default

**Files:**
- Modify: `src/core/types/settings.ts:160-175` (insert after `firstRunDismissed`)
- Modify: `src/app/settings/defaultSettings.ts:65-75` (insert after `firstRunDismissed`)
- Test: rely on existing settings-defaults coverage; no new test file

- [ ] **Step 1: Add field to `ClaudianSettings` interface**

Edit `src/core/types/settings.ts`. Locate the `firstRunDismissed: boolean;` line (around line 167). Insert directly below it:

```typescript
  /** When true, prompt the user to commit & push after Accepting a Work-Order in a dirty git-backed vault. */
  promptCommitOnAccept?: boolean;
```

- [ ] **Step 2: Add default value**

Edit `src/app/settings/defaultSettings.ts`. Locate the `firstRunDismissed: false,` line (around line 65). Insert directly below it:

```typescript
  promptCommitOnAccept: true,
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts
git commit -m "feat(tasks): add promptCommitOnAccept setting default on"
```

---

## Task 2: Build scoped commit prompt (TDD)

**Files:**
- Create: `src/features/tasks/commit/scopedCommitPrompt.ts`
- Test: `tests/unit/features/tasks/commit/scopedCommitPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/commit/scopedCommitPrompt.test.ts`:

```typescript
import { GIT_COMMIT_PROMPT } from '@/core/prompt/gitCommit';
import { buildScopedCommitPrompt } from '@/features/tasks/commit/scopedCommitPrompt';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'Add commit-on-accept modal',
      status: 'done',
      priority: '2 - normal',
      created: '2026-06-04T10:00:00Z',
      updated: '2026-06-04T11:00:00Z',
      attempts: 1,
    },
    sections: {
      objective: 'Prompt user to commit after Accept.',
      acceptanceCriteria: '- [x] Modal opens on Accept\n- [x] Skip writes setting\n- [ ] Open question',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
    ...overrides,
  };
}

describe('buildScopedCommitPrompt', () => {
  it('embeds work-order id and title', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('Work-Order: wo-1 — Add commit-on-accept modal');
  });

  it('includes Objective verbatim', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('Objective:');
    expect(out).toContain('Prompt user to commit after Accept.');
  });

  it('includes only checked acceptance criteria items', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('- Modal opens on Accept');
    expect(out).toContain('- Skip writes setting');
    expect(out).not.toContain('- Open question');
  });

  it('omits Objective block when empty', () => {
    const task = makeTask({ sections: { ...makeTask().sections, objective: '' } });
    const out = buildScopedCommitPrompt(task, 3);
    expect(out).not.toContain('Objective:');
  });

  it('omits Acceptance criteria block when no items are checked', () => {
    const task = makeTask({ sections: { ...makeTask().sections, acceptanceCriteria: '- [ ] Not done' } });
    const out = buildScopedCommitPrompt(task, 3);
    expect(out).not.toContain('Acceptance criteria completed:');
  });

  it('preserves GIT_COMMIT_PROMPT body verbatim', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain(GIT_COMMIT_PROMPT);
  });

  it('is deterministic for the same input', () => {
    const a = buildScopedCommitPrompt(makeTask(), 3);
    const b = buildScopedCommitPrompt(makeTask(), 3);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "buildScopedCommitPrompt"`

Expected: FAIL — module `@/features/tasks/commit/scopedCommitPrompt` does not exist.

- [ ] **Step 3: Implement `scopedCommitPrompt.ts`**

Create `src/features/tasks/commit/scopedCommitPrompt.ts`:

```typescript
import { GIT_COMMIT_PROMPT } from '../../../core/prompt/gitCommit';
import type { TaskSpec } from '../model/taskTypes';

const CHECKBOX_DONE = /^\s*[-*]\s+\[(x|X)\]\s+(.*)$/;

function extractCheckedAcceptanceItems(acceptanceCriteria: string): string[] {
  const items: string[] = [];
  for (const line of acceptanceCriteria.split(/\r?\n/)) {
    const match = line.match(CHECKBOX_DONE);
    if (match) items.push(match[2].trim());
  }
  return items;
}

/**
 * Composes the scoped commit prompt sent to the work-order's chat conversation.
 * Pure: deterministic for the same TaskSpec + dirtyCount input.
 */
export function buildScopedCommitPrompt(task: TaskSpec, _dirtyCount: number): string {
  const lines: string[] = [GIT_COMMIT_PROMPT, '', 'Scope this commit to the following accepted Work-Order:', ''];

  lines.push(`Work-Order: ${task.frontmatter.id} — ${task.frontmatter.title}`);

  const objective = task.sections.objective.trim();
  if (objective.length > 0) {
    lines.push('', 'Objective:', objective);
  }

  const checkedItems = extractCheckedAcceptanceItems(task.sections.acceptanceCriteria);
  if (checkedItems.length > 0) {
    lines.push('', 'Acceptance criteria completed:');
    for (const item of checkedItems) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "buildScopedCommitPrompt"`

Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/commit/scopedCommitPrompt.ts tests/unit/features/tasks/commit/scopedCommitPrompt.test.ts
git commit -m "feat(tasks): add scoped commit prompt builder"
```

---

## Task 3: Build the confirm modal (TDD)

**Files:**
- Create: `src/features/tasks/commit/CommitOnAcceptModal.ts`
- Test: `tests/unit/features/tasks/commit/CommitOnAcceptModal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/commit/CommitOnAcceptModal.test.ts`:

```typescript
import { CommitOnAcceptModal } from '@/features/tasks/commit/CommitOnAcceptModal';

// jest-environment-jsdom is already configured for the unit project.
// We construct the modal with a faked `App` and drive lifecycle by hand.

function mountModal(opts: { taskTitle: string; dirtyCount: number }) {
  const app = {} as ConstructorParameters<typeof CommitOnAcceptModal>[0];
  const modal = new CommitOnAcceptModal(app, opts);
  // Obsidian's Modal binds onOpen via show(); call directly for the test.
  modal.contentEl = document.createElement('div');
  modal.titleEl = document.createElement('div');
  modal.modalEl = document.createElement('div');
  modal.onOpen();
  return modal;
}

describe('CommitOnAcceptModal', () => {
  it('renders the task title and pluralised file count', () => {
    const modal = mountModal({ taskTitle: 'Refactor X', dirtyCount: 1 });
    expect(modal.contentEl.textContent).toContain('Refactor X');
    expect(modal.contentEl.textContent).toContain('1 file');
    expect(modal.contentEl.textContent).not.toContain('1 files');
  });

  it('renders pluralised count when dirtyCount > 1', () => {
    const modal = mountModal({ taskTitle: 'Refactor X', dirtyCount: 4 });
    expect(modal.contentEl.textContent).toContain('4 files');
  });

  it('resolves { confirmed: true, dontAskAgain: false } when Commit & push is clicked', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    const ctaBtn = modal.contentEl.querySelector(
      '[data-claudian-commit-on-accept="confirm"]',
    ) as HTMLButtonElement;
    ctaBtn.click();
    await expect(promise).resolves.toEqual({ confirmed: true, dontAskAgain: false });
  });

  it('resolves { confirmed: false, dontAskAgain: true } when Skip is clicked with checkbox checked', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    const cb = modal.contentEl.querySelector(
      '[data-claudian-commit-on-accept="dont-ask"]',
    ) as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    const skipBtn = modal.contentEl.querySelector(
      '[data-claudian-commit-on-accept="skip"]',
    ) as HTMLButtonElement;
    skipBtn.click();
    await expect(promise).resolves.toEqual({ confirmed: false, dontAskAgain: true });
  });

  it('resolves { confirmed: false, dontAskAgain: false } when onClose runs without a button click', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    modal.onClose();
    await expect(promise).resolves.toEqual({ confirmed: false, dontAskAgain: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptModal"`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CommitOnAcceptModal.ts`**

Create `src/features/tasks/commit/CommitOnAcceptModal.ts`:

```typescript
import { type App, Modal } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface CommitOnAcceptModalOptions {
  taskTitle: string;
  dirtyCount: number;
}

export interface CommitOnAcceptModalResult {
  confirmed: boolean;
  dontAskAgain: boolean;
}

export class CommitOnAcceptModal extends Modal {
  private resolver: ((result: CommitOnAcceptModalResult) => void) | null = null;
  private resultPromise: Promise<CommitOnAcceptModalResult>;
  private settled = false;
  private dontAskAgain = false;

  constructor(app: App, private readonly options: CommitOnAcceptModalOptions) {
    super(app);
    this.resultPromise = new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Returns a promise resolved when the user picks a button or the modal closes. */
  result(): Promise<CommitOnAcceptModalResult> {
    return this.resultPromise;
  }

  onOpen(): void {
    this.modalEl.addClass('claudian-commit-on-accept-modal');
    this.titleEl.setText(t('tasks.commitOnAccept.title'));

    const filesLabel = this.options.dirtyCount === 1
      ? t('tasks.commitOnAccept.bodyOne', { title: this.options.taskTitle })
      : t('tasks.commitOnAccept.bodyMany', { title: this.options.taskTitle, count: this.options.dirtyCount });
    this.contentEl.createEl('p', { text: filesLabel });

    const checkboxWrap = this.contentEl.createEl('label', {
      cls: 'claudian-commit-on-accept-dont-ask',
    });
    const checkbox = checkboxWrap.createEl('input', {
      type: 'checkbox',
      attr: { 'data-claudian-commit-on-accept': 'dont-ask' },
    });
    checkboxWrap.createSpan({ text: ` ${t('tasks.commitOnAccept.dontAsk')}` });
    checkbox.addEventListener('change', () => {
      this.dontAskAgain = checkbox.checked;
    });

    const buttons = this.contentEl.createDiv({ cls: 'claudian-commit-on-accept-buttons' });

    const skipBtn = buttons.createEl('button', {
      text: t('tasks.commitOnAccept.skip'),
      attr: { type: 'button', 'data-claudian-commit-on-accept': 'skip' },
    });
    skipBtn.addEventListener('click', () => this.resolve({ confirmed: false, dontAskAgain: this.dontAskAgain }));

    const confirmBtn = buttons.createEl('button', {
      text: t('tasks.commitOnAccept.commitAndPush'),
      cls: 'mod-cta',
      attr: { type: 'button', 'data-claudian-commit-on-accept': 'confirm' },
    });
    confirmBtn.addEventListener('click', () => this.resolve({ confirmed: true, dontAskAgain: this.dontAskAgain }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.resolve({ confirmed: false, dontAskAgain: false });
    }
  }

  private resolve(result: CommitOnAcceptModalResult): void {
    if (this.settled) return;
    this.settled = true;
    this.resolver?.(result);
    if (this.containerEl?.isConnected) {
      this.close();
    }
  }
}
```

- [ ] **Step 4: Add i18n strings (English only — other locales fall back)**

Edit `src/i18n/locales/en.json`. Inside the existing `"tasks": { ... }` object (around line 597), before the closing brace of `"tasks"`, add a new key:

```json
    "commitOnAccept": {
      "title": "Commit & push?",
      "bodyOne": "Accepted \"{title}\". 1 file changed in the vault git repo.",
      "bodyMany": "Accepted \"{title}\". {count} files changed in the vault git repo.",
      "dontAsk": "Don't ask again for this vault",
      "skip": "Skip",
      "commitAndPush": "Commit & push",
      "failed": "Commit prompt failed: {error}",
      "settingsSaveFailed": "Failed to save preference. Try again from settings."
    }
```

(Place a comma after the existing closing `}` of `"run"` so JSON stays valid.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptModal"`

Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/commit/CommitOnAcceptModal.ts tests/unit/features/tasks/commit/CommitOnAcceptModal.test.ts src/i18n/locales/en.json
git commit -m "feat(tasks): add commit-on-accept confirm modal"
```

---

## Task 4: Extend `TaskExecutionSurface` interface

**Files:**
- Modify: `src/features/tasks/execution/TaskExecutionSurface.ts`

This task is type-only; no test added.

- [ ] **Step 1: Add the optional method to the interface**

Edit `src/features/tasks/execution/TaskExecutionSurface.ts`. Replace the `TaskExecutionSurface` interface (around line 16) with:

```typescript
export interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  cancelTaskRun?(runId: string): void;
  /**
   * Injects a scoped commit-and-push prompt into the work-order's existing chat
   * conversation. Resolves once the prompt has been queued. Implementations that
   * don't host a chat surface can omit this method.
   */
  requestCommitTurn?(task: TaskSpec, prompt: string): Promise<void>;
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`

Expected: no errors. (Existing `ChatTabExecutionSurface` is fine because the method is optional — implementation comes in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/execution/TaskExecutionSurface.ts
git commit -m "feat(tasks): add optional requestCommitTurn to TaskExecutionSurface"
```

---

## Task 5: Add `ClaudianView.injectCommitTurnForConversation` helper

`ChatTabExecutionSurface.requestCommitTurn` will delegate to this view helper. The view owns the `TabManager`, so it can route to an existing conversation or fall back to a fresh task-run tab.

**Files:**
- Modify: `src/features/chat/ClaudianView.ts` (add public method after `startTaskRunInFreshTab`)

This step is structural; functional tests come in Task 6 against the surface.

- [ ] **Step 1: Add the helper**

Open `src/features/chat/ClaudianView.ts`. Insert this method directly after `startTaskRunInFreshTab` (immediately before `private handleTabClick`, around line 733):

```typescript
  /**
   * Routes a commit-and-push prompt into a work-order's chat. Focuses or reopens
   * the conversation tab when `conversationId` is known and recoverable;
   * otherwise opens a fresh task-run tab on the supplied provider/model and
   * sends the prompt there.
   */
  async injectCommitTurnForConversation(options: {
    conversationId: string | null;
    fallbackProviderId: ProviderId;
    fallbackModel: string;
    prompt: string;
  }): Promise<void> {
    if (!this.tabManager) {
      throw new Error('Chat view is not ready.');
    }

    if (options.conversationId) {
      const existing = this.findTabWithConversation(options.conversationId);
      if (existing) {
        await this.tabManager.openConversation(options.conversationId);
        const ic = existing.controllers.inputController;
        if (!ic) {
          throw new Error('Chat tab is missing an input controller.');
        }
        await ic.sendMessage({ content: options.prompt });
        return;
      }
    }

    const result = await this.startTaskRunInFreshTab({
      providerId: options.fallbackProviderId,
      model: options.fallbackModel,
      prompt: options.prompt,
    });
    if (result.status === 'failed' && result.error) {
      throw new Error(result.error);
    }
  }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/ClaudianView.ts
git commit -m "feat(chat): add injectCommitTurnForConversation helper"
```

---

## Task 6: Implement `ChatTabExecutionSurface.requestCommitTurn` (TDD)

**Files:**
- Modify: `src/features/tasks/execution/ChatTabExecutionSurface.ts`
- Create: `tests/unit/features/tasks/execution/ChatTabExecutionSurface.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/execution/ChatTabExecutionSurface.test.ts`:

```typescript
import type ClaudianPlugin from '@/main';
import { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

function makeTask(overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'Some task',
      status: 'done',
      priority: '2 - normal',
      created: '2026-06-04T10:00:00Z',
      updated: '2026-06-04T11:00:00Z',
      provider: 'claude',
      model: 'opus',
      conversation_id: 'conv-1',
      attempts: 1,
      ...overrides,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

describe('ChatTabExecutionSurface.requestCommitTurn', () => {
  it('delegates to ClaudianView.injectCommitTurnForConversation with the work-order conversation', async () => {
    const injectSpy = jest.fn(async () => undefined);
    const plugin = {
      getView: () => ({ injectCommitTurnForConversation: injectSpy }),
      activateView: jest.fn(async () => undefined),
    } as unknown as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);

    await surface.requestCommitTurn(makeTask(), 'PROMPT');

    expect(injectSpy).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });
  });

  it('activates the chat view when no view is currently present', async () => {
    const injectSpy = jest.fn(async () => undefined);
    let view: unknown = null;
    const plugin = {
      getView: () => view,
      activateView: jest.fn(async () => {
        view = { injectCommitTurnForConversation: injectSpy };
      }),
    } as unknown as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);

    await surface.requestCommitTurn(makeTask(), 'PROMPT');

    expect(plugin.activateView).toHaveBeenCalled();
    expect(injectSpy).toHaveBeenCalled();
  });

  it('passes null conversationId when work-order has no conversation_id', async () => {
    const injectSpy = jest.fn(async () => undefined);
    const plugin = {
      getView: () => ({ injectCommitTurnForConversation: injectSpy }),
      activateView: jest.fn(async () => undefined),
    } as unknown as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);

    await surface.requestCommitTurn(makeTask({ conversation_id: null }), 'PROMPT');

    expect(injectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null, fallbackProviderId: 'claude', fallbackModel: 'opus' }),
    );
  });

  it('rejects when work-order has no provider', async () => {
    const plugin = {} as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);
    await expect(surface.requestCommitTurn(makeTask({ provider: undefined }), 'PROMPT')).rejects.toThrow(
      /provider/i,
    );
  });

  it('rejects when work-order has no model', async () => {
    const plugin = {} as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);
    await expect(surface.requestCommitTurn(makeTask({ model: undefined }), 'PROMPT')).rejects.toThrow(
      /model/i,
    );
  });

  it('rejects when chat view never becomes available', async () => {
    const plugin = {
      getView: () => null,
      activateView: jest.fn(async () => undefined),
    } as unknown as ClaudianPlugin;
    const surface = new ChatTabExecutionSurface(plugin);
    await expect(surface.requestCommitTurn(makeTask(), 'PROMPT')).rejects.toThrow(/chat view/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "ChatTabExecutionSurface.requestCommitTurn"`

Expected: FAIL — method `requestCommitTurn` is undefined on the class.

- [ ] **Step 3: Implement `requestCommitTurn`**

Edit `src/features/tasks/execution/ChatTabExecutionSurface.ts`. Replace the entire file with:

```typescript
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions } from './TaskExecutionSurface';

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle> {
    const { provider, model } = task.frontmatter;
    if (!provider) return this.failed('Work order is missing provider');
    if (!model) return this.failed('Work order is missing model');

    let view = this.plugin.getView();
    if (!view) {
      await this.plugin.activateView();
      view = this.plugin.getView();
    }
    if (!view) return this.failed('Could not open the Claudian chat view.');

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await view.startTaskRunInFreshTab({
      providerId: provider as ProviderId,
      model,
      prompt: options.prompt,
    });

    return {
      status: result.status,
      runId,
      conversationId: result.conversationId,
      sidepanelTabId: result.sidepanelTabId,
      finalAssistantContent: result.finalAssistantContent,
      error: result.error,
    };
  }

  async requestCommitTurn(task: TaskSpec, prompt: string): Promise<void> {
    const { provider, model } = task.frontmatter;
    if (!provider) throw new Error('Work order is missing provider');
    if (!model) throw new Error('Work order is missing model');

    let view = this.plugin.getView();
    if (!view) {
      await this.plugin.activateView();
      view = this.plugin.getView();
    }
    if (!view) throw new Error('Could not open the Claudian chat view.');

    await view.injectCommitTurnForConversation({
      conversationId: task.frontmatter.conversation_id ?? null,
      fallbackProviderId: provider as ProviderId,
      fallbackModel: model,
      prompt,
    });
  }

  private failed(error: string): TaskRunHandle {
    return {
      status: 'failed',
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      finalAssistantContent: '',
      error,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "ChatTabExecutionSurface.requestCommitTurn"`

Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/ChatTabExecutionSurface.ts tests/unit/features/tasks/execution/ChatTabExecutionSurface.test.ts
git commit -m "feat(tasks): implement requestCommitTurn on chat surface"
```

---

## Task 7: Build the coordinator — gating branches (TDD)

This task covers all silent-skip branches so the happy path in Task 8 has solid ground. We mock every collaborator: `EventBus`, the task store reader, `GitStatusWatcher`, `ProviderRegistry`, the modal, and the surface.

**Files:**
- Create: `src/features/tasks/commit/CommitOnAcceptCoordinator.ts`
- Test: `tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts`:

```typescript
import { EventBus } from '@/core/events/EventBus';
import type { TaskEventMap } from '@/features/tasks/events';
import { CommitOnAcceptCoordinator } from '@/features/tasks/commit/CommitOnAcceptCoordinator';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

interface Harness {
  events: EventBus<TaskEventMap>;
  loadTaskSpec: jest.Mock<Promise<TaskSpec>, [string]>;
  getGitStatus: jest.Mock<Promise<{ isRepo: boolean; dirtyCount: number }>, []>;
  isProviderGitEnabled: jest.Mock<boolean, [string]>;
  openModal: jest.Mock<Promise<{ confirmed: boolean; dontAskAgain: boolean }>, [{ taskTitle: string; dirtyCount: number }]>;
  surface: { requestCommitTurn: jest.Mock<Promise<void>, [TaskSpec, string]> };
  settings: { promptCommitOnAccept: boolean };
  saveSettings: jest.Mock<Promise<void>, []>;
  logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock };
  showNotice: jest.Mock<void, [string]>;
  coordinator: CommitOnAcceptCoordinator;
}

function makeTask(over: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'Task A',
      status: 'done',
      priority: '2 - normal',
      created: '2026-06-04T10:00:00Z',
      updated: '2026-06-04T11:00:00Z',
      provider: 'claude',
      model: 'opus',
      conversation_id: 'conv-1',
      attempts: 1,
      ...over,
    },
    sections: { objective: 'Obj', acceptanceCriteria: '- [x] Yes', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

function makeHarness(initialSettings: Partial<Harness['settings']> = {}): Harness {
  const events = new EventBus<TaskEventMap>();
  const settings = { promptCommitOnAccept: true, ...initialSettings };
  const saveSettings = jest.fn(async () => undefined);
  const loadTaskSpec = jest.fn(async () => makeTask());
  const getGitStatus = jest.fn(async () => ({ isRepo: true, dirtyCount: 3 }));
  const isProviderGitEnabled = jest.fn(() => true);
  const openModal = jest.fn(async () => ({ confirmed: false, dontAskAgain: false }));
  const surface = { requestCommitTurn: jest.fn(async () => undefined) };
  const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const showNotice = jest.fn();
  const coordinator = new CommitOnAcceptCoordinator({
    events,
    loadTaskSpec,
    getGitStatus,
    isProviderGitEnabled,
    openModal,
    surface,
    readSettings: () => settings,
    saveSettings,
    logger,
    showNotice,
  });
  coordinator.start();
  return { events, loadTaskSpec, getGitStatus, isProviderGitEnabled, openModal, surface, settings, saveSettings, logger, showNotice, coordinator };
}

describe('CommitOnAcceptCoordinator — silent-skip branches', () => {
  it('ignores non-done statuses', async () => {
    const h = makeHarness();
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'running' });
    await Promise.resolve();
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips when promptCommitOnAccept is false', async () => {
    const h = makeHarness({ promptCommitOnAccept: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await Promise.resolve();
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when provider has opted out', async () => {
    const h = makeHarness();
    h.isProviderGitEnabled.mockReturnValueOnce(false);
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when not a git repo', async () => {
    const h = makeHarness();
    h.getGitStatus.mockResolvedValueOnce({ isRepo: false, dirtyCount: 0 });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when repo is clean', async () => {
    const h = makeHarness();
    h.getGitStatus.mockResolvedValueOnce({ isRepo: true, dirtyCount: 0 });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('warns and silently skips when the task spec fails to load', async () => {
    const h = makeHarness();
    h.loadTaskSpec.mockRejectedValueOnce(new Error('corrupt frontmatter'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('stop() removes the subscription', async () => {
    const h = makeHarness();
    h.coordinator.stop();
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptCoordinator"`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the coordinator (gating only — happy path comes in Task 8)**

Create `src/features/tasks/commit/CommitOnAcceptCoordinator.ts`:

```typescript
import type { EventBus } from '../../../core/events/EventBus';
import type { TaskEventMap } from '../events';
import type { TaskSpec } from '../model/taskTypes';
import { buildScopedCommitPrompt } from './scopedCommitPrompt';

export interface CoordinatorLogger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface CommitOnAcceptDeps {
  events: EventBus<TaskEventMap>;
  loadTaskSpec(path: string): Promise<TaskSpec>;
  getGitStatus(): Promise<{ isRepo: boolean; dirtyCount: number }>;
  isProviderGitEnabled(providerId: string): boolean;
  openModal(opts: { taskTitle: string; dirtyCount: number }): Promise<{ confirmed: boolean; dontAskAgain: boolean }>;
  surface: { requestCommitTurn?(task: TaskSpec, prompt: string): Promise<void> };
  readSettings(): { promptCommitOnAccept?: boolean };
  saveSettings(): Promise<void>;
  logger: CoordinatorLogger;
  showNotice(message: string): void;
}

export class CommitOnAcceptCoordinator {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: CommitOnAcceptDeps) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.events.on('task:status-changed', (payload) => {
      void this.handle(payload);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async handle(payload: TaskEventMap['task:status-changed']): Promise<void> {
    if (payload.status !== 'done') return;

    const settings = this.deps.readSettings();
    if (settings.promptCommitOnAccept === false) {
      this.deps.logger.debug('commitOnAccept skip: toggleOff');
      return;
    }

    let task: TaskSpec;
    try {
      task = await this.deps.loadTaskSpec(payload.path);
    } catch (error) {
      this.deps.logger.warn('commitOnAccept skip: parse failed', error);
      return;
    }

    const provider = task.frontmatter.provider;
    if (provider && !this.deps.isProviderGitEnabled(provider)) {
      this.deps.logger.debug('commitOnAccept skip: providerOptOut');
      return;
    }

    let status: { isRepo: boolean; dirtyCount: number };
    try {
      status = await this.deps.getGitStatus();
    } catch {
      this.deps.logger.debug('commitOnAccept skip: gitStatus failed');
      return;
    }
    if (!status.isRepo) {
      this.deps.logger.debug('commitOnAccept skip: notRepo');
      return;
    }
    if (status.dirtyCount === 0) {
      this.deps.logger.debug('commitOnAccept skip: clean');
      return;
    }

    // Modal + surface dispatch — implemented in Task 8.
    void task;
    void buildScopedCommitPrompt;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptCoordinator"`

Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/commit/CommitOnAcceptCoordinator.ts tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts
git commit -m "feat(tasks): coordinator silent-skip branches"
```

---

## Task 8: Coordinator — modal + dispatch happy path (TDD)

**Files:**
- Modify: `src/features/tasks/commit/CommitOnAcceptCoordinator.ts`
- Modify: `tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts`

- [ ] **Step 1: Add failing tests at the bottom of the existing test file**

Append to `tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts`:

```typescript
describe('CommitOnAcceptCoordinator — happy path and post-modal branches', () => {
  it('opens the modal with the work-order title and dirty count', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).toHaveBeenCalledWith({ taskTitle: 'Task A', dirtyCount: 3 });
  });

  it('forwards the built prompt to the surface on confirm', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(1);
    const [, prompt] = h.surface.requestCommitTurn.mock.calls[0];
    expect(prompt).toContain('Work-Order: wo-1 — Task A');
  });

  it('does not call the surface when the user skips without dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it('writes settings off and skips surface when user skips with dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.settings.promptCommitOnAccept).toBe(false);
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('shows a Notice and logs error when surface rejects', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.surface.requestCommitTurn.mockRejectedValueOnce(new Error('boom'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.error).toHaveBeenCalled();
    expect(h.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Commit prompt failed/));
  });

  it('shows a Notice when settings save fails on dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Failed to save preference/));
  });

  it('handles two rapid accepts as two independent flows', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValue({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).toHaveBeenCalledTimes(2);
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptCoordinator"`

Expected: PASS for the gating tests, FAIL for the happy-path tests (modal never opens; surface never called).

- [ ] **Step 3: Replace `handle` in the coordinator**

Edit `src/features/tasks/commit/CommitOnAcceptCoordinator.ts`. Replace the `handle` method body (and remove the trailing `void task; void buildScopedCommitPrompt;` placeholders) with:

```typescript
  private async handle(payload: TaskEventMap['task:status-changed']): Promise<void> {
    if (payload.status !== 'done') return;

    const settings = this.deps.readSettings();
    if (settings.promptCommitOnAccept === false) {
      this.deps.logger.debug('commitOnAccept skip: toggleOff');
      return;
    }

    let task: TaskSpec;
    try {
      task = await this.deps.loadTaskSpec(payload.path);
    } catch (error) {
      this.deps.logger.warn('commitOnAccept skip: parse failed', error);
      return;
    }

    const provider = task.frontmatter.provider;
    if (provider && !this.deps.isProviderGitEnabled(provider)) {
      this.deps.logger.debug('commitOnAccept skip: providerOptOut');
      return;
    }

    let status: { isRepo: boolean; dirtyCount: number };
    try {
      status = await this.deps.getGitStatus();
    } catch {
      this.deps.logger.debug('commitOnAccept skip: gitStatus failed');
      return;
    }
    if (!status.isRepo) {
      this.deps.logger.debug('commitOnAccept skip: notRepo');
      return;
    }
    if (status.dirtyCount === 0) {
      this.deps.logger.debug('commitOnAccept skip: clean');
      return;
    }

    const choice = await this.deps.openModal({
      taskTitle: task.frontmatter.title,
      dirtyCount: status.dirtyCount,
    });

    if (choice.dontAskAgain) {
      const bag = this.deps.readSettings() as { promptCommitOnAccept?: boolean };
      bag.promptCommitOnAccept = false;
      try {
        await this.deps.saveSettings();
      } catch (error) {
        this.deps.logger.warn('commitOnAccept: settings write failed', error);
        this.deps.showNotice('Failed to save preference. Try again from settings.');
      }
    }

    if (!choice.confirmed) return;

    if (!this.deps.surface.requestCommitTurn) {
      this.deps.logger.debug('commitOnAccept skip: surface unsupported');
      return;
    }

    const prompt = buildScopedCommitPrompt(task, status.dirtyCount);
    try {
      await this.deps.surface.requestCommitTurn(task, prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error('commitOnAccept: surface call failed', error);
      this.deps.showNotice(`Commit prompt failed: ${message}`);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "CommitOnAcceptCoordinator"`

Expected: PASS (14 cases total — 7 gating + 7 happy-path/error).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/commit/CommitOnAcceptCoordinator.ts tests/unit/features/tasks/commit/CommitOnAcceptCoordinator.test.ts
git commit -m "feat(tasks): coordinator modal dispatch and error handling"
```

---

## Task 9: Register settings toggle

**Files:**
- Modify: `src/features/settings/registry/fields/agentBoard.ts`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Add the "Git" section and toggle field**

Edit `src/features/settings/registry/fields/agentBoard.ts`. After the existing `r.registerSection({ id: 'archive', ... })` block (around line 70), add another section:

```typescript
  r.registerSection({
    id: 'commitOnAccept',
    tabId: 'agentBoard',
    label: 'Git',
    order: 55,
    description: 'Prompt to commit and push when a work order is Accepted.',
  });
```

Then at the end of `registerAgentBoardTabFields` (just before the final `}`), register the field:

```typescript
  r.registerField({
    id: 'promptCommitOnAccept',
    tabId: 'agentBoard',
    sectionId: 'commitOnAccept',
    label: 'Prompt to commit and push on Accept',
    description: 'When the vault is a dirty git repo, ask before committing the changes that ship with the accepted work order.',
    type: { kind: 'toggle' },
    default: true,
    keywords: ['git', 'commit', 'push', 'accept'],
  });
```

- [ ] **Step 2: Verify typecheck and registry validation pass**

Run: `npm run typecheck`

Expected: no errors.

Run: `npm run test -- --selectProjects unit -t "registry"`

Expected: PASS (or unchanged from before — no regressions in field registration tests).

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/registry/fields/agentBoard.ts
git commit -m "feat(settings): expose Prompt to commit and push on Accept toggle"
```

---

## Task 10: Wire coordinator into plugin lifecycle

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports and a field for the coordinator**

Edit `src/main.ts`. Add an import near the other `features/tasks` imports (after the existing `ChatTabExecutionSurface` import, around line 50):

```typescript
import { CommitOnAcceptCoordinator } from './features/tasks/commit/CommitOnAcceptCoordinator';
import { CommitOnAcceptModal } from './features/tasks/commit/CommitOnAcceptModal';
import { TaskNoteStore } from './features/tasks/storage/TaskNoteStore';
```

Add `Notice` to the existing `from 'obsidian'` import if it is not already present (it is — leave alone).

Add a private field to `ClaudianPlugin` near the other lifecycle fields (around line 68):

```typescript
  private commitOnAcceptCoordinator: CommitOnAcceptCoordinator | null = null;
```

- [ ] **Step 2: Instantiate after the chat surface is created**

Locate the existing line `const taskExecutionSurface = new ChatTabExecutionSurface(this);` (around line 101). Directly after it, add:

```typescript
    {
      const noteStore = new TaskNoteStore();
      this.commitOnAcceptCoordinator = new CommitOnAcceptCoordinator({
        events: this.events,
        loadTaskSpec: async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!file || !('vault' in file)) {
            throw new Error('Work order file not found');
          }
          const content = await this.app.vault.read(file as Parameters<typeof this.app.vault.read>[0]);
          return noteStore.parse(path, content).task;
        },
        getGitStatus: async () => {
          await this.gitStatusWatcher?.refresh();
          return this.gitStatusWatcher?.getLastStatus() ?? { isRepo: false, dirtyCount: 0 };
        },
        isProviderGitEnabled: (providerId) => {
          try {
            const config = ProviderRegistry.getChatUIConfig(providerId as ProviderId);
            return config.isGitActionsEnabled?.(this.settings) !== false;
          } catch {
            return false;
          }
        },
        openModal: (opts) => {
          const modal = new CommitOnAcceptModal(this.app, opts);
          modal.open();
          return modal.result();
        },
        surface: taskExecutionSurface,
        readSettings: () => this.settings,
        saveSettings: () => this.saveSettings(),
        logger: this.logger.scope('tasks.commitOnAccept'),
        showNotice: (message) => { new Notice(message); },
      });
      this.commitOnAcceptCoordinator.start();
    }
```

- [ ] **Step 3: Stop in `onunload`**

Edit the `onunload(): void` block (around line 186). Replace it with:

```typescript
  onunload(): void {
    this.commitOnAcceptCoordinator?.stop();
    this.commitOnAcceptCoordinator = null;
    this.gitStatusWatcher?.stop();
    this.gitStatusWatcher = null;
    this.lifecycle.shutdownActiveRuntimes();
    void this.lifecycle.persistOpenTabStates();
  }
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 5: Run the unit suite**

Run: `npm run test -- --selectProjects unit`

Expected: full unit suite passes (no regressions; tests added in earlier tasks still green).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(tasks): wire CommitOnAcceptCoordinator into plugin lifecycle"
```

---

## Task 11: Integration test (TDD)

This test wires the real `EventBus`, real `TaskNoteStore`, a fake git status reader, a spy surface, and a spy modal. It drives the flow through the public coordinator API (no UI).

**Files:**
- Create: `tests/integration/features/tasks/commit/acceptCommitFlow.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/features/tasks/commit/acceptCommitFlow.integration.test.ts`:

```typescript
import { EventBus } from '@/core/events/EventBus';
import { CommitOnAcceptCoordinator } from '@/features/tasks/commit/CommitOnAcceptCoordinator';
import type { TaskEventMap } from '@/features/tasks/events';
import { TaskNoteStore } from '@/features/tasks/storage/TaskNoteStore';

const TASK_PATH = 'Agent Board/tasks/wo-1.md';

const TASK_CONTENT = `---
type: claudian-work-order
schema_version: 1
id: wo-1
title: Integration Task
status: done
priority: 2 - normal
created: 2026-06-04T10:00:00Z
updated: 2026-06-04T11:00:00Z
provider: claude
model: opus
conversation_id: conv-1
attempts: 1
---

## Objective
Verify integration

## Acceptance Criteria
- [x] All wired up
- [ ] Skipped item
`;

function setup(opts: { promptCommitOnAccept: boolean; dirtyCount: number; confirm: boolean; dontAskAgain: boolean }) {
  const events = new EventBus<TaskEventMap>();
  const settings: { promptCommitOnAccept: boolean } = { promptCommitOnAccept: opts.promptCommitOnAccept };
  const saveSettings = jest.fn(async () => undefined);
  const noteStore = new TaskNoteStore();
  const surface = { requestCommitTurn: jest.fn(async () => undefined) };
  const openModal = jest.fn(async () => ({ confirmed: opts.confirm, dontAskAgain: opts.dontAskAgain }));
  const coordinator = new CommitOnAcceptCoordinator({
    events,
    loadTaskSpec: async (path) => noteStore.parse(path, TASK_CONTENT).task,
    getGitStatus: async () => ({ isRepo: true, dirtyCount: opts.dirtyCount }),
    isProviderGitEnabled: () => true,
    openModal,
    surface,
    readSettings: () => settings,
    saveSettings,
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    showNotice: jest.fn(),
  });
  coordinator.start();
  return { events, settings, saveSettings, surface, openModal, coordinator };
}

describe('Accept → commit flow (integration)', () => {
  it('drives the surface with a prompt scoped to the work-order on confirm', async () => {
    const h = setup({ promptCommitOnAccept: true, dirtyCount: 3, confirm: true, dontAskAgain: false });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.openModal).toHaveBeenCalledWith({ taskTitle: 'Integration Task', dirtyCount: 3 });
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(1);
    const [, prompt] = h.surface.requestCommitTurn.mock.calls[0];
    expect(prompt).toContain('Work-Order: wo-1 — Integration Task');
    expect(prompt).toContain('Verify integration');
    expect(prompt).toContain('- All wired up');
    expect(prompt).not.toContain('- Skipped item');
  });

  it('does nothing when the toggle is off', async () => {
    const h = setup({ promptCommitOnAccept: false, dirtyCount: 3, confirm: true, dontAskAgain: false });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('persists the toggle off when the user picks "Don\'t ask again" + Skip', async () => {
    const h = setup({ promptCommitOnAccept: true, dirtyCount: 1, confirm: false, dontAskAgain: true });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.settings.promptCommitOnAccept).toBe(false);
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (it should already, since prior tasks implemented everything)**

Run: `npm run test -- --selectProjects integration -t "Accept → commit flow"`

Expected: PASS (3 cases). If a case fails, the gap is in implementation — fix it in the relevant earlier task rather than relaxing the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/commit/acceptCommitFlow.integration.test.ts
git commit -m "test(tasks): integration coverage for commit-on-accept flow"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 2: Run full lint**

Run: `npm run lint`

Expected: 0 errors, 0 warnings.

If errors appear, fix in place (most likely culprits: unused imports, missing `await` on coordinator promises, or `void` returns). Do not introduce `eslint-disable` comments.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`

Expected: all unit and integration projects pass.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: build completes; `main.js` produced; no bundler errors.

- [ ] **Step 5: Optional manual smoke (in Obsidian)**

1. Open a vault that is a dirty git repo.
2. Create or open a Work-Order at status `review`, then click Accept on the board card.
3. Modal opens. Click **Commit & push**.
4. Confirm the work-order's chat tab is focused and a streamed turn appears whose commit message references the work-order title.
5. Re-Accept another work-order; tick "Don't ask again". Confirm no modal appears on subsequent Accepts.
6. Toggle the setting back on from Settings → Agent Board → Git and confirm Accept-time modal returns.

- [ ] **Step 6: Final commit if any verification fixes were needed**

If steps 1–5 surfaced fixes, stage and commit them with a focused message, e.g.:

```bash
git add <files>
git commit -m "fix(tasks): <what>"
```

Otherwise nothing to commit — verification phase is complete.

---

## Self-review checklist (already applied)

**Spec coverage:** every spec section maps to at least one task — settings (Task 1), prompt builder (Task 2), modal (Task 3), surface contract (Task 4), chat-side surface (Tasks 5–6), coordinator gating (Task 7), coordinator dispatch (Task 8), settings UI (Task 9), lifecycle wiring (Task 10), integration (Task 11), final verify (Task 12).

**Placeholder scan:** no TBDs, no "add appropriate error handling" — every step shows the code.

**Type consistency:** `requestCommitTurn`, `injectCommitTurnForConversation`, `promptCommitOnAccept`, `CommitOnAcceptDeps`, `CommitOnAcceptModalResult`, and `TaskExecutionSurface` shape are spelled identically across all tasks.

**Boundary respect:** task code reaches chat only via `TaskExecutionSurface` per `src/features/tasks/CLAUDE.md`. Coordinator deps are injected — it never imports from `features/chat`.
