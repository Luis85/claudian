---
status: done
parent: "[[sidepanel-chat]]"
---
# Git commit & push button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar git button to the chat panel that appears when the vault's git repo has uncommitted changes; clicking it asks the active chat agent to stage, commit, and push with a generated message.

**Architecture:** A `GitService` runs `git status --porcelain` at the vault cwd. A single per-plugin `GitStatusWatcher` polls it (ref-counted, only while subscribed) and notifies subscribers when `{ isRepo, dirtyCount }` changes. Each tab's `InputToolbar` adds a `GitActionButton` that subscribes to the watcher, gates visibility by provider UI config, and on click injects `GIT_COMMIT_PROMPT` through the tab's `InputController` (the agent performs all git work via its own shell tool).

**Tech Stack:** TypeScript, Node `child_process`, Obsidian plugin API, Jest (jsdom + obsidian mock).

---

## File structure

| File | Responsibility | Create/Modify |
|------|----------------|---------------|
| `src/features/chat/services/GitService.ts` | Run `git status --porcelain`, return `{ isRepo, dirtyCount }`; export `GitStatus` type | Create |
| `src/features/chat/services/GitStatusWatcher.ts` | Ref-counted poller around `GitService`; `subscribe`/`refresh`/`stop`; notify-on-change | Create |
| `src/core/prompt/gitCommit.ts` | `GIT_COMMIT_PROMPT` constant | Create |
| `src/features/chat/ui/GitActionButton.ts` | Toolbar button + pure `shouldShowGitButton` helper | Create |
| `src/core/providers/types.ts` | Add optional `isGitActionsEnabled?` to `ProviderChatUIConfig` | Modify |
| `src/features/chat/ui/InputToolbar.ts` | Construct/return `GitActionButton`; add git callbacks to `ToolbarCallbacks` | Modify |
| `src/features/chat/tabs/types.ts` | Add `gitActionButton` to `TabUIComponents` | Modify |
| `src/features/chat/tabs/Tab.ts` | Wire git toolbar callbacks; store button; dispose on tab destroy | Modify |
| `src/features/chat/controllers/StreamController.ts` | Refresh watcher when a turn ends | Modify |
| `src/main.ts` | Create/own `GitStatusWatcher`; register debounced vault-event refresh; dispose on unload | Modify |

**Test files (mirrored):**
- `tests/unit/features/chat/services/GitService.test.ts`
- `tests/unit/features/chat/services/GitStatusWatcher.test.ts`
- `tests/unit/features/chat/ui/GitActionButton.test.ts`

**Note on streaming:** Clicking while a turn is streaming routes through the normal `InputController.sendMessage` path, which queues the message. We do not add a separate disabled-while-streaming state; queuing the commit prompt is the correct, consistent behavior.

---

## Task 1: GitService

**Files:**
- Create: `src/features/chat/services/GitService.ts`
- Test: `tests/unit/features/chat/services/GitService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/chat/services/GitService.test.ts
import { exec } from 'child_process';

import { GitService } from '@/features/chat/services/GitService';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const execMock = exec as jest.MockedFunction<typeof exec>;

function mockExec(error: unknown, stdout: string, stderr = '') {
  execMock.mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(error, stdout, stderr);
    return undefined as any;
  });
}

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService('/test/dir', '/usr/bin');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('runs git status --porcelain at the configured cwd and PATH', async () => {
    mockExec(null, '');
    await service.getStatus();
    expect(execMock).toHaveBeenCalledWith(
      'git status --porcelain',
      expect.objectContaining({
        cwd: '/test/dir',
        env: expect.objectContaining({ PATH: '/usr/bin' }),
      }),
      expect.any(Function),
    );
  });

  it('reports a clean repo as isRepo true with zero dirty files', async () => {
    mockExec(null, '');
    expect(await service.getStatus()).toEqual({ isRepo: true, dirtyCount: 0 });
  });

  it('counts each porcelain line as one changed file (including untracked)', async () => {
    mockExec(null, ' M src/a.ts\n?? new.txt\nA  staged.ts\n');
    expect(await service.getStatus()).toEqual({ isRepo: true, dirtyCount: 3 });
  });

  it('returns isRepo false when not inside a git repo', async () => {
    const err: any = new Error('fatal: not a git repository');
    err.code = 128;
    mockExec(err, '', 'fatal: not a git repository');
    expect(await service.getStatus()).toEqual({ isRepo: false, dirtyCount: 0 });
  });

  it('returns isRepo false when git is not installed', async () => {
    const err: any = new Error('spawn git ENOENT');
    err.code = 'ENOENT';
    mockExec(err, '');
    expect(await service.getStatus()).toEqual({ isRepo: false, dirtyCount: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t GitService`
Expected: FAIL — cannot find module `@/features/chat/services/GitService`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/chat/services/GitService.ts
import { exec } from 'child_process';

export interface GitStatus {
  isRepo: boolean;
  dirtyCount: number;
}

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1024 * 1024; // 1MB

export class GitService {
  constructor(
    private readonly cwd: string,
    private readonly enhancedPath: string,
  ) {}

  getStatus(): Promise<GitStatus> {
    return new Promise((resolve) => {
      exec('git status --porcelain', {
        cwd: this.cwd,
        env: { ...process.env, PATH: this.enhancedPath },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      }, (error, stdout) => {
        if (error) {
          // Not a repo, git missing, or any failure: treat as "no repo".
          resolve({ isRepo: false, dirtyCount: 0 });
          return;
        }
        const dirtyCount = stdout
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .length;
        resolve({ isRepo: true, dirtyCount });
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t GitService`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/services/GitService.ts tests/unit/features/chat/services/GitService.test.ts
git commit -m "feat(chat): add GitService for repo dirty-state detection"
```

---

## Task 2: GitStatusWatcher

**Files:**
- Create: `src/features/chat/services/GitStatusWatcher.ts`
- Test: `tests/unit/features/chat/services/GitStatusWatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/chat/services/GitStatusWatcher.test.ts
import type { GitService, GitStatus } from '@/features/chat/services/GitService';
import { GitStatusWatcher } from '@/features/chat/services/GitStatusWatcher';

function makeService(statuses: GitStatus[]): GitService {
  let i = 0;
  return {
    getStatus: jest.fn(async () => statuses[Math.min(i++, statuses.length - 1)]),
  } as unknown as GitService;
}

describe('GitStatusWatcher', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('notifies a subscriber with the first polled status', async () => {
    const service = makeService([{ isRepo: true, dirtyCount: 2 }]);
    const watcher = new GitStatusWatcher(service, 1000);
    const seen: GitStatus[] = [];
    watcher.subscribe((s) => seen.push(s));
    await watcher.refresh();
    expect(seen).toEqual([{ isRepo: true, dirtyCount: 2 }]);
    watcher.stop();
  });

  it('notifies only when status changes', async () => {
    const service = makeService([
      { isRepo: true, dirtyCount: 1 },
      { isRepo: true, dirtyCount: 1 },
      { isRepo: true, dirtyCount: 3 },
    ]);
    const watcher = new GitStatusWatcher(service, 1000);
    const cb = jest.fn();
    watcher.subscribe(cb);
    await watcher.refresh(); // 1 -> notify
    await watcher.refresh(); // 1 -> no change
    await watcher.refresh(); // 3 -> notify
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ isRepo: true, dirtyCount: 3 });
    watcher.stop();
  });

  it('polls on an interval while subscribed and stops after last unsubscribe', async () => {
    jest.useFakeTimers();
    const service = makeService([{ isRepo: true, dirtyCount: 1 }]);
    const getStatus = service.getStatus as jest.Mock;
    const watcher = new GitStatusWatcher(service, 1000);

    const unsub = watcher.subscribe(() => {});
    // first subscribe triggers an immediate poll
    expect(getStatus).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    expect(getStatus).toHaveBeenCalledTimes(2);

    unsub();
    jest.advanceTimersByTime(5000);
    expect(getStatus).toHaveBeenCalledTimes(2); // no polling after last unsubscribe
  });

  it('exposes the last known status via getStatus()', async () => {
    const service = makeService([{ isRepo: true, dirtyCount: 4 }]);
    const watcher = new GitStatusWatcher(service, 1000);
    expect(watcher.getLastStatus()).toBeNull();
    watcher.subscribe(() => {});
    await watcher.refresh();
    expect(watcher.getLastStatus()).toEqual({ isRepo: true, dirtyCount: 4 });
    watcher.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t GitStatusWatcher`
Expected: FAIL — cannot find module `GitStatusWatcher`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/chat/services/GitStatusWatcher.ts
import type { GitService, GitStatus } from './GitService';

type Subscriber = (status: GitStatus) => void;

const DEFAULT_INTERVAL_MS = 7000;

export class GitStatusWatcher {
  private subscribers = new Set<Subscriber>();
  private lastStatus: GitStatus | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly gitService: GitService,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  getLastStatus(): GitStatus | null {
    return this.lastStatus;
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.lastStatus) {
      cb(this.lastStatus);
    }
    if (this.subscribers.size === 1) {
      this.start();
    }
    return () => this.unsubscribe(cb);
  }

  async refresh(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const next = await this.gitService.getStatus();
      if (!this.lastStatus || !this.statusEquals(this.lastStatus, next)) {
        this.lastStatus = next;
        for (const cb of this.subscribers) {
          cb(next);
        }
      }
    } catch {
      // Keep last good status on transient failures.
    } finally {
      this.polling = false;
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private start(): void {
    void this.refresh();
    if (this.timer === null) {
      this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    }
  }

  private unsubscribe(cb: Subscriber): void {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) {
      this.stop();
    }
  }

  private statusEquals(a: GitStatus, b: GitStatus): boolean {
    return a.isRepo === b.isRepo && a.dirtyCount === b.dirtyCount;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t GitStatusWatcher`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/services/GitStatusWatcher.ts tests/unit/features/chat/services/GitStatusWatcher.test.ts
git commit -m "feat(chat): add GitStatusWatcher polling around GitService"
```

---

## Task 3: GIT_COMMIT_PROMPT

**Files:**
- Create: `src/core/prompt/gitCommit.ts`
- Test: `tests/unit/core/prompt/gitCommit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/core/prompt/gitCommit.test.ts
import { GIT_COMMIT_PROMPT } from '@/core/prompt/gitCommit';

describe('GIT_COMMIT_PROMPT', () => {
  it('instructs the agent to stage, commit with a generated message, and push', () => {
    const lower = GIT_COMMIT_PROMPT.toLowerCase();
    expect(lower).toContain('stage');
    expect(lower).toContain('commit');
    expect(lower).toContain('push');
    expect(lower).toContain('conventional commit');
  });

  it('tells the agent to skip push gracefully when there is no upstream', () => {
    expect(GIT_COMMIT_PROMPT.toLowerCase()).toContain('upstream');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t GIT_COMMIT_PROMPT`
Expected: FAIL — cannot find module `@/core/prompt/gitCommit`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/prompt/gitCommit.ts
export const GIT_COMMIT_PROMPT = [
  'Commit and push the current changes in this git repository.',
  '',
  'Steps:',
  '1. Inspect the working tree with `git status` and `git diff` to understand what changed.',
  '2. Stage the relevant changes.',
  '3. Write a concise Conventional Commit message that accurately reflects the diff.',
  '4. Create the commit.',
  '5. Push to the upstream branch.',
  '',
  'If there is no upstream branch or no remote configured, create the commit anyway and tell me that the push was skipped and why.',
  'When done, report the commit subject, the short hash, and the push result.',
].join('\n');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t GIT_COMMIT_PROMPT`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/gitCommit.ts tests/unit/core/prompt/gitCommit.test.ts
git commit -m "feat(prompt): add GIT_COMMIT_PROMPT template"
```

---

## Task 4: Provider UI-config opt-out hook

**Files:**
- Modify: `src/core/providers/types.ts` (in the `ProviderChatUIConfig` interface, next to `isBangBashEnabled?` around line 299–300)

- [ ] **Step 1: Add the optional contract method**

Find this block in `ProviderChatUIConfig`:

```typescript
  /** Whether the provider enables the shared bang-bash input mode. */
  isBangBashEnabled?(settings: Record<string, unknown>): boolean;
```

Add immediately after it:

```typescript
  /**
   * Whether the provider exposes the git commit & push toolbar action.
   * Default behavior when omitted is enabled (any agent that can run shell
   * commands shows the button). Return false to opt out.
   */
  isGitActionsEnabled?(settings: Record<string, unknown>): boolean;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/core/providers/types.ts
git commit -m "feat(core): add optional isGitActionsEnabled provider UI hook"
```

---

## Task 5: GitActionButton component

**Files:**
- Create: `src/features/chat/ui/GitActionButton.ts`
- Test: `tests/unit/features/chat/ui/GitActionButton.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/chat/ui/GitActionButton.test.ts
import { createMockEl } from '@test/helpers/mockElement';

import type { GitStatus } from '@/features/chat/services/GitService';
import { GitActionButton, shouldShowGitButton } from '@/features/chat/ui/GitActionButton';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

describe('shouldShowGitButton', () => {
  it('shows only when repo present, dirty, and enabled', () => {
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 2 }, true)).toBe(true);
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 0 }, true)).toBe(false);
    expect(shouldShowGitButton({ isRepo: false, dirtyCount: 5 }, true)).toBe(false);
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 2 }, false)).toBe(false);
    expect(shouldShowGitButton(null, true)).toBe(false);
  });
});

describe('GitActionButton', () => {
  function setup(opts?: { enabled?: boolean }) {
    const parent = createMockEl();
    let captured: ((s: GitStatus) => void) | null = null;
    const onCommit = jest.fn();
    const button = new GitActionButton(parent as any, {
      subscribeGitStatus: (cb) => { captured = cb; return () => {}; },
      isGitActionsEnabled: () => opts?.enabled ?? true,
      onGitCommit: onCommit,
    });
    return { parent, button, onCommit, emit: (s: GitStatus) => captured?.(s) };
  }

  it('is hidden until a dirty status arrives', () => {
    const { button } = setup();
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('becomes visible and shows the change count when dirty', () => {
    const { button, emit } = setup();
    emit({ isRepo: true, dirtyCount: 3 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(false);
    expect(button.badgeEl.textContent).toBe('3');
  });

  it('hides again when changes are committed away', () => {
    const { button, emit } = setup();
    emit({ isRepo: true, dirtyCount: 3 });
    emit({ isRepo: true, dirtyCount: 0 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('stays hidden when the provider disables git actions', () => {
    const { button, emit } = setup({ enabled: false });
    emit({ isRepo: true, dirtyCount: 3 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('invokes onGitCommit when clicked', () => {
    const { button, emit, onCommit } = setup();
    emit({ isRepo: true, dirtyCount: 1 });
    button.buttonEl.dispatchEvent('click');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on dispose', () => {
    const parent = createMockEl();
    const unsub = jest.fn();
    const button = new GitActionButton(parent as any, {
      subscribeGitStatus: () => unsub,
      isGitActionsEnabled: () => true,
      onGitCommit: jest.fn(),
    });
    button.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t GitActionButton`
Expected: FAIL — cannot find module `@/features/chat/ui/GitActionButton`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/chat/ui/GitActionButton.ts
import { setIcon } from 'obsidian';

import type { GitStatus } from '../services/GitService';

export interface GitActionCallbacks {
  subscribeGitStatus: (cb: (status: GitStatus) => void) => () => void;
  isGitActionsEnabled: () => boolean;
  onGitCommit: () => void;
}

export function shouldShowGitButton(status: GitStatus | null, enabled: boolean): boolean {
  return Boolean(status && status.isRepo && status.dirtyCount > 0 && enabled);
}

export class GitActionButton {
  readonly containerEl: HTMLElement;
  readonly buttonEl: HTMLElement;
  readonly badgeEl: HTMLElement;
  private readonly unsubscribe: () => void;
  private lastStatus: GitStatus | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: GitActionCallbacks) {
    this.containerEl = parentEl.createDiv({ cls: 'claudian-git-action' });
    this.buttonEl = this.containerEl.createDiv({ cls: 'claudian-git-action-btn' });

    const iconEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-icon' });
    setIcon(iconEl, 'git-commit-horizontal');
    this.badgeEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-badge' });

    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onGitCommit();
    });

    this.unsubscribe = this.callbacks.subscribeGitStatus((status) => {
      this.lastStatus = status;
      this.updateDisplay();
    });

    this.updateDisplay();
  }

  updateDisplay(): void {
    const visible = shouldShowGitButton(this.lastStatus, this.callbacks.isGitActionsEnabled());
    this.containerEl.toggleClass('claudian-hidden', !visible);
    if (visible && this.lastStatus) {
      this.badgeEl.setText(String(this.lastStatus.dirtyCount));
      const count = this.lastStatus.dirtyCount;
      this.containerEl.setAttribute(
        'title',
        `Commit & push ${count} change${count === 1 ? '' : 's'}`,
      );
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t GitActionButton`
Expected: PASS (shouldShowGitButton: 1, GitActionButton: 6).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/GitActionButton.ts tests/unit/features/chat/ui/GitActionButton.test.ts
git commit -m "feat(chat): add GitActionButton toolbar component"
```

---

## Task 6: Wire GitActionButton into the toolbar

**Files:**
- Modify: `src/features/chat/ui/InputToolbar.ts` (`ToolbarCallbacks` interface ~line 49; `createInputToolbar` ~line 1212–1244)

- [ ] **Step 1: Add git callbacks to `ToolbarCallbacks`**

At the top of `InputToolbar.ts`, add the import (with the other relative imports):

```typescript
import { GitActionButton, type GitActionCallbacks } from './GitActionButton';
```

In the `ToolbarCallbacks` interface, add the optional git callbacks after `getCapabilities`:

```typescript
  getCapabilities: () => ProviderCapabilities;
  gitActions?: GitActionCallbacks;
```

- [ ] **Step 2: Construct and return the button from `createInputToolbar`**

Change the return type of `createInputToolbar` to include the button. Update the type block (currently ending with `serviceTierToggle: ServiceTierToggle;`) to add:

```typescript
  serviceTierToggle: ServiceTierToggle;
  gitActionButton: GitActionButton | null;
```

Inside `createInputToolbar`, after `const modeSelector = new ModeSelector(parentEl, callbacks);` add:

```typescript
  const gitActionButton = callbacks.gitActions
    ? new GitActionButton(parentEl, callbacks.gitActions)
    : null;
```

And add `gitActionButton` to the returned object:

```typescript
  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    serviceTierToggle,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
    gitActionButton,
  };
```

- [ ] **Step 3: Verify existing toolbar tests still pass and it compiles**

Run: `npm run typecheck && npm run test -- --selectProjects unit -t InputToolbar`
Expected: PASS — existing `InputToolbar` tests unaffected (`gitActions` is optional, so they construct with `gitActionButton: null`).

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/ui/InputToolbar.ts
git commit -m "feat(chat): expose GitActionButton through createInputToolbar"
```

---

## Task 7: Own the watcher in the plugin

**Files:**
- Modify: `src/main.ts` (class fields ~line 50; `onload` ~line 55; `onunload` ~line 180)

- [ ] **Step 1: Add imports and a watcher field**

Add imports near the other imports in `main.ts`:

```typescript
import { debounce } from 'obsidian';
import { GitService } from './features/chat/services/GitService';
import { GitStatusWatcher } from './features/chat/services/GitStatusWatcher';
import { getEnhancedPath } from './utils/env';
import { getVaultPath } from './utils/path';
```

(If any of these modules are already imported, merge instead of duplicating.)

Add a public field to the `ClaudianPlugin` class, after `storage!`:

```typescript
  gitStatusWatcher: GitStatusWatcher | null = null;
```

- [ ] **Step 2: Create the watcher and register vault-event refresh in `onload`**

Inside `onload`, after `await this.loadSettings();`, add:

```typescript
    const vaultPath = getVaultPath(this.app);
    if (vaultPath) {
      this.gitStatusWatcher = new GitStatusWatcher(
        new GitService(vaultPath, getEnhancedPath()),
      );
      const refreshGit = debounce(
        () => void this.gitStatusWatcher?.refresh(),
        1500,
        true,
      );
      this.registerEvent(this.app.vault.on('modify', refreshGit));
      this.registerEvent(this.app.vault.on('create', refreshGit));
      this.registerEvent(this.app.vault.on('delete', refreshGit));
      this.registerEvent(this.app.vault.on('rename', refreshGit));
    }
```

- [ ] **Step 3: Stop the watcher in `onunload`**

Inside `onunload`, add:

```typescript
    this.gitStatusWatcher?.stop();
    this.gitStatusWatcher = null;
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(chat): own GitStatusWatcher in plugin with vault-event refresh"
```

---

## Task 8: Wire toolbar callbacks per tab

**Files:**
- Modify: `src/features/chat/tabs/types.ts` (`TabUIComponents` ~line 113–129)
- Modify: `src/features/chat/tabs/Tab.ts` (`initializeInputToolbar` ~line 747–899; store component ~line 892–899; `destroyTab` ~line 1580)

- [ ] **Step 1: Add the button to `TabUIComponents`**

In `src/features/chat/tabs/types.ts`, add an import for the type at the top with the other UI imports:

```typescript
import type { GitActionButton } from '../ui/GitActionButton';
```

Add a field to `TabUIComponents`, after `serviceTierToggle`:

```typescript
  serviceTierToggle: ServiceTierToggle | null;
  gitActionButton: GitActionButton | null;
```

- [ ] **Step 2: Initialize the new field wherever `TabUIComponents` objects are built**

Run: `npm run typecheck`
Expected: FAIL — object literals missing `gitActionButton`. For each reported location that builds the `ui` object (look for `serviceTierToggle: null`), add `gitActionButton: null,` alongside it.

- [ ] **Step 3: Pass git callbacks into the toolbar in `initializeInputToolbar`**

In `Tab.ts`, locate the `createInputToolbar(inputToolbar, { ... })` call (~line 770). Add the `gitActions` callback object inside the callbacks object, after `getCapabilities: () => getTabCapabilities(tab, plugin),`:

```typescript
    gitActions: plugin.gitStatusWatcher
      ? {
          subscribeGitStatus: (cb) => plugin.gitStatusWatcher!.subscribe(cb),
          isGitActionsEnabled: () =>
            getTabChatUIConfig(tab, plugin).isGitActionsEnabled?.(
              getTabSettingsSnapshot(tab, plugin),
            ) !== false,
          onGitCommit: () => {
            void tab.controllers.inputController?.sendMessage({ content: GIT_COMMIT_PROMPT });
          },
        }
      : undefined,
```

Add the prompt import at the top of `Tab.ts` with the other imports:

```typescript
import { GIT_COMMIT_PROMPT } from '../../../core/prompt/gitCommit';
```

- [ ] **Step 4: Store the button instance**

After the existing `tab.ui.serviceTierToggle = toolbarComponents.serviceTierToggle;` line (~line 898), add:

```typescript
  tab.ui.gitActionButton = toolbarComponents.gitActionButton;
```

- [ ] **Step 5: Dispose the button when the tab is destroyed**

In `destroyTab` (~line 1580), add disposal alongside other UI teardown:

```typescript
  tab.ui.gitActionButton?.dispose();
  tab.ui.gitActionButton = null;
```

- [ ] **Step 6: Verify it compiles and unit tests pass**

Run: `npm run typecheck && npm run test -- --selectProjects unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/tabs/types.ts src/features/chat/tabs/Tab.ts
git commit -m "feat(chat): wire git toolbar button per tab"
```

---

## Task 9: Refresh after each agent turn

**Files:**
- Modify: `src/features/chat/controllers/StreamController.ts` (`resetStreamingState` ~line 1536)

- [ ] **Step 1: Refresh the watcher when streaming ends**

In `resetStreamingState()`, at the end of the method body (after `state.responseStartTime = null;`), add:

```typescript
    void this.deps.plugin.gitStatusWatcher?.refresh();
```

(`this.deps.plugin` is already used throughout `StreamController`; confirm `plugin` is on `deps` — it is referenced as `this.deps.plugin.settings` elsewhere in this file.)

- [ ] **Step 2: Verify it compiles and unit tests pass**

Run: `npm run typecheck && npm run test -- --selectProjects unit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/controllers/StreamController.ts
git commit -m "feat(chat): refresh git status when a turn completes"
```

---

## Task 10: Style the button + full verification

**Files:**
- Modify: a CSS module under `src/style/` (follow `src/style/CLAUDE.md` for the right file; the toolbar styles live alongside other `claudian-*` toolbar component styles)

- [ ] **Step 1: Add minimal styling for the button**

Add CSS for `.claudian-git-action`, `.claudian-git-action-btn`, and `.claudian-git-action-badge` mirroring the existing toolbar icon-button + badge styling (e.g. the `claudian-mcp-selector` icon/badge rules). Keep it consistent with neighboring toolbar controls.

- [ ] **Step 2: Full verification suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/style
git commit -m "style(chat): style git commit & push toolbar button"
```

- [ ] **Step 4: Manual smoke test (verification-before-completion)**

In a vault that is a git repo: open the chat panel, edit a note, confirm the git button appears in the toolbar with the correct change count within ~7s. Click it; confirm the commit prompt is sent and the agent stages/commits/pushes. Commit the changes via the agent; confirm the button disappears once the tree is clean. In a non-repo vault, confirm the button never appears.

---

## Notes for the implementer

- `@/` maps to `src/`; `@test/` maps to `tests/`. Match the existing import style.
- Tests run per project: `npm run test -- --selectProjects unit`.
- No `console.*` in production code.
- The agent owns all git mutation — the plugin never runs commit/push itself, only `git status --porcelain` for detection.
- The watcher is ref-counted: it only polls while at least one toolbar button is subscribed, so closed/idle panels cost nothing.
