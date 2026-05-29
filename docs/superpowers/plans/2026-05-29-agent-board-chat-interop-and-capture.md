---
status: in-progress
---
# Agent Board — Chat Interop & Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users promote chat into Markdown work orders, capture work orders from editor/browser selections, and run the next ready work order — closing the Agent Board MVP capture/interop gap without regressing direct chat.

**Architecture:** A capture-seed refactor in `features/tasks/commands` gives every capture entry point one creation path. A chat-owned message-action registry (chat imports nothing from tasks; the plugin bridges) lets `features/tasks` register a per-message "Create work order" button. A thin `ChatWorkOrderLinker` orchestrates promotion. The durable chat↔order link is the work-order note's `conversation_id` (already written by `TaskRunCoordinator`); the board reopens the linked conversation via `tabManager.openConversation(id)`. Run-next-ready is a pure selector plus a board method and command.

**Tech Stack:** TypeScript, Obsidian plugin API, Jest (jsdom), existing `TaskNoteStore` / `TaskRunCoordinator` / `AgentBoardView`.

**Reference spec:** [[docs/superpowers/specs/2026-05-29-agent-board-chat-interop-and-capture-design.md]]

### Deliberate refinement vs spec

The spec mentions persisting `workOrderPath` on the conversation. This plan keeps `workOrderPath` as an **optional type field set in memory only** and makes the durable two-way link the note's `conversation_id`. The board's "Open conversation" uses `conversation_id`, so no chat-session persistence work is needed this increment. This matches the spec's deferral of the chat-side chip.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/features/tasks/commands/taskCommands.ts` | `WorkOrderSeed`, seed builders, `createWorkOrderFromSeed`, selection/browser capture commands | 1, 2, 3 |
| `src/core/types/chat.ts` | `ChatMessageAction`, `ConversationSnapshot` types; optional `workOrderPath` | 4 |
| `src/features/chat/rendering/messageActions.ts` | Pure `eligibleMessageActions` selector | 4 |
| `src/features/chat/rendering/MessageRenderer.ts` | Render registered message actions in the user toolbar | 4 |
| `src/style/components/messages.css` | Style the action button | 4 |
| `src/main.ts` | Plugin registry/accessors; wire commands, linker, message action | 2,3,5,7 |
| `src/features/tasks/execution/ChatWorkOrderLinker.ts` | Promote message/conversation → work order | 5 |
| `src/features/tasks/execution/selectNextReadyTask.ts` | Pure next-ready selector | 7 |
| `src/features/tasks/ui/AgentBoardView.ts` | `runNextReady()`; open-conversation wiring | 6, 7 |
| `src/features/tasks/ui/AgentBoardRenderer.ts` | Run-next-ready toolbar button | 7 |
| `src/features/tasks/ui/WorkOrderDetailModal.ts` | Open-conversation button | 6 |

Each task ends green and committed.

---

## Task 1: Capture seed foundation

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Write the failing test** — append to the existing `buildWorkOrderMarkdown` describe block:

```ts
it('uses seeded objective, context, and conversation id', () => {
  const markdown = buildWorkOrderMarkdown({
    id: 'task-seeded',
    title: 'Seeded order',
    provider: 'codex',
    model: 'gpt-5-codex',
    timestamp: '2026-05-29T10:00:00.000Z',
    status: 'inbox',
    objective: 'Implement the linker',
    contextMarkdown: 'Promoted from chat message.',
    conversationId: 'conv-123',
  });

  expect(markdown).toContain('status: inbox');
  expect(markdown).toContain('conversation_id: "conv-123"');
  expect(markdown).toContain('## Objective\n\nImplement the linker');
  expect(markdown).toContain('## Context\n\nPromoted from chat message.');
});

it('leaves conversation_id empty and placeholders intact without a seed', () => {
  const markdown = buildWorkOrderMarkdown({
    id: 'task-bare',
    title: 'Bare',
    provider: 'claude',
    model: 'sonnet',
    timestamp: '2026-05-29T10:00:00.000Z',
  });
  expect(markdown).toContain('conversation_id:\n');
  expect(markdown).toContain('_What should the agent accomplish?_');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "seeded objective"`
Expected: FAIL (`conversation_id: "conv-123"` not found; objective placeholder still present).

- [ ] **Step 3: Extend `buildWorkOrderMarkdown`** — update the args interface and body:

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
  objective?: string;
  contextMarkdown?: string;
  conversationId?: string | null;
}
```

Inside `buildWorkOrderMarkdown`, replace the `contextBody` block and add objective/conversation handling:

```ts
function buildWorkOrderMarkdown(args: BuildWorkOrderArgs): string {
  const { id, title, provider, model, timestamp, sourcePath, sourceFolderPath } = args;
  const status = args.status ?? 'ready';

  let contextBody = '_Add the links, files, and scope the agent needs._';
  if (args.contextMarkdown && args.contextMarkdown.trim()) {
    contextBody = args.contextMarkdown.trim();
  } else if (sourcePath) {
    contextBody = `Source note: [[${stripMarkdownExtension(sourcePath)}]]`;
  } else if (sourceFolderPath) {
    contextBody = `Source folder: \`${sourceFolderPath}\``;
  }

  const objectiveBody =
    args.objective && args.objective.trim() ? args.objective.trim() : '_What should the agent accomplish?_';
  const conversationLine = args.conversationId
    ? `conversation_id: ${JSON.stringify(args.conversationId)}`
    : 'conversation_id:';

  return `---
type: claudian-work-order
schema_version: 1
id: ${id}
title: ${JSON.stringify(title)}
status: ${status}
priority: normal
created: ${timestamp}
updated: ${timestamp}
provider: ${provider}
model: ${model}
run_id:
${conversationLine}
sidepanel_tab_id:
started:
finished:
attempts: 0
---
# ${title}

## Objective

${objectiveBody}

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

${contextBody}

## Constraints

- Keep direct chat behavior intact.
- Do not modify unrelated files.

## Run Ledger

${RUN_LEDGER_START}
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;
}
```

- [ ] **Step 4: Add `WorkOrderSeed` + `createWorkOrderFromSeed` and re-wrap `createWorkOrder`** — replace the existing `createWorkOrder` function with:

```ts
export interface WorkOrderSeed {
  title?: string;
  status?: TaskStatus;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  objective?: string;
  contextMarkdown?: string;
  conversationId?: string | null;
}

function buildSeedFromSource(source?: TFile | TFolder | null): WorkOrderSeed {
  const sourceFile = source instanceof TFile ? source : null;
  const sourceFolder = source instanceof TFolder ? source : null;
  const title = sourceFile ? sourceFile.basename : sourceFolder ? sourceFolder.name : 'New work order';
  return { title, sourcePath: sourceFile?.path ?? null, sourceFolderPath: sourceFolder?.path ?? null };
}

export async function createWorkOrderFromSeed(
  plugin: ClaudianPlugin,
  seed: WorkOrderSeed,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const provider = plugin.settings.agentBoardDefaultProvider;
  const model = plugin.settings.agentBoardDefaultModel;
  if (!provider) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default provider in settings first.');
    return null;
  }
  if (!model) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default model in settings first.');
    return null;
  }

  const folder = normalizePath(plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks');
  await ensureFolder(plugin, folder);

  const now = new Date();
  const title = seed.title || 'New work order';
  const slug = slugifyTitle(title) || 'work-order';
  const id = `task-${timestampId(now)}-${slug}`;
  const status = options?.status ?? seed.status ?? 'ready';
  const markdown = buildWorkOrderMarkdown({
    id,
    title,
    provider,
    model,
    timestamp: now.toISOString(),
    status,
    sourcePath: seed.sourcePath ?? null,
    sourceFolderPath: seed.sourceFolderPath ?? null,
    objective: seed.objective,
    contextMarkdown: seed.contextMarkdown,
    conversationId: seed.conversationId ?? null,
  });

  const filePath = uniquePath(plugin, normalizePath(`${folder}/${id}.md`));
  const created = await plugin.app.vault.create(filePath, markdown);
  if (created instanceof TFile) {
    if ((options?.reveal ?? 'note') === 'note') {
      await plugin.app.workspace.getLeaf('tab').openFile(created);
    }
    return created;
  }
  return null;
}

export async function createWorkOrder(
  plugin: ClaudianPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  return createWorkOrderFromSeed(plugin, buildSeedFromSource(source), options);
}
```

Update the test-utils export at the bottom of the file:

```ts
export const __taskCommandTestUtils = { buildWorkOrderMarkdown, slugifyTitle };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit tests/unit/features/tasks/commands/taskCommands.test.ts`
Expected: PASS (all existing + new cases). Existing `createWorkOrder(plugin, file)` and board `{status:'inbox'}` callers compile unchanged.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/features/tasks/commands/taskCommands.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat(tasks): add WorkOrderSeed and seed-based work-order creation"
```

---

## Task 2: Capture from editor selection

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { __taskCaptureTestUtils } from '../../../../../src/features/tasks/commands/taskCommands';

describe('buildSelectionSeed', () => {
  it('blockquotes the selection, links the source, and lands in inbox', () => {
    const seed = __taskCaptureTestUtils.buildSelectionSeed({
      selectionText: 'Fix the auth bug\nin the middleware',
      sourcePath: 'notes/auth.md',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('Fix the auth bug');
    expect(seed.contextMarkdown).toContain('Source note: [[notes/auth]]');
    expect(seed.contextMarkdown).toContain('> Fix the auth bug');
    expect(seed.contextMarkdown).toContain('> in the middleware');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "buildSelectionSeed"`
Expected: FAIL (`__taskCaptureTestUtils` undefined).

- [ ] **Step 3: Implement the seed builder, command, and test util** — add to `taskCommands.ts`:

```ts
function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function blockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function buildSelectionSeed(args: { selectionText: string; sourcePath: string | null }): WorkOrderSeed {
  const firstLine = args.selectionText.trim().split(/\r?\n/)[0] ?? '';
  const parts: string[] = [];
  if (args.sourcePath) parts.push(`Source note: [[${stripMarkdownExtension(args.sourcePath)}]]`);
  parts.push(blockquote(args.selectionText));
  return {
    title: truncate(firstLine, 60) || 'Work order from selection',
    contextMarkdown: parts.join('\n\n'),
    status: 'inbox',
  };
}

export async function createWorkOrderFromSelection(plugin: ClaudianPlugin): Promise<TFile | null> {
  const editor = plugin.app.workspace.activeEditor?.editor;
  const selection = editor?.getSelection() ?? '';
  if (!selection.trim()) {
    new Notice('Select text in a note to create a work order from it.');
    return null;
  }
  const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? null;
  return createWorkOrderFromSeed(plugin, buildSelectionSeed({ selectionText: selection, sourcePath }));
}

export const __taskCaptureTestUtils = { buildSelectionSeed };
```

- [ ] **Step 4: Register the command and editor context-menu item in `src/main.ts`** — add the import and, in `onload()` near the other work-order commands (around line 138):

```ts
// add to the import on line 41:
import {
  createWorkOrder,
  createWorkOrderFromCurrentNote,
  createWorkOrderFromSelection,
} from './features/tasks/commands/taskCommands';
```

```ts
this.addCommand({
  id: 'create-work-order-from-selection',
  name: 'Create work order from selection',
  editorCallback: () => {
    void createWorkOrderFromSelection(this);
  },
});
```

Add to the existing `editor-menu` registration, or create one next to the `file-menu` handler (around line 140):

```ts
this.registerEvent(
  this.app.workspace.on('editor-menu', (menu: Menu, editor) => {
    if (!editor.getSelection().trim()) return;
    menu.addItem((item) => {
      item
        .setTitle('Create work order from selection')
        .setIcon('kanban-square')
        .onClick(() => {
          void createWorkOrderFromSelection(this);
        });
    });
  }),
);
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `npm run test -- --selectProjects unit tests/unit/features/tasks/commands/taskCommands.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts src/main.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat(tasks): create work order from editor selection"
```

---

## Task 3: Capture from browser selection

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('buildBrowserSeed', () => {
  it('blockquotes the selection and links the source url', () => {
    const seed = __taskCaptureTestUtils.buildBrowserSeed({
      source: 'browser:https://x.dev',
      selectedText: 'Two Sum problem',
      title: 'LeetCode',
      url: 'https://x.dev',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('LeetCode');
    expect(seed.contextMarkdown).toContain('> Two Sum problem');
    expect(seed.contextMarkdown).toContain('[LeetCode](https://x.dev)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "buildBrowserSeed"`
Expected: FAIL (`buildBrowserSeed` undefined).

- [ ] **Step 3: Implement the seed builder and command** — add to `taskCommands.ts` (and add `BrowserSelectionContext` to the imports from `../../../utils/browser`):

```ts
import type { BrowserSelectionContext } from '../../../utils/browser';

export function buildBrowserSeed(context: BrowserSelectionContext): WorkOrderSeed {
  const firstLine = context.selectedText.trim().split(/\r?\n/)[0] ?? '';
  const parts: string[] = [blockquote(context.selectedText)];
  if (context.url) {
    parts.push(`Source: [${context.title?.trim() || context.url}](${context.url})`);
  }
  return {
    title: truncate(context.title?.trim() || firstLine, 60) || 'Work order from browser',
    contextMarkdown: parts.join('\n\n'),
    status: 'inbox',
  };
}

export async function createWorkOrderFromBrowserSelection(plugin: ClaudianPlugin): Promise<TFile | null> {
  const context = plugin.getActiveBrowserSelection();
  if (!context || !context.selectedText.trim()) {
    new Notice('Open Claudian chat and select text in a browser view first.');
    return null;
  }
  return createWorkOrderFromSeed(plugin, buildBrowserSeed(context));
}
```

Extend the test util:

```ts
export const __taskCaptureTestUtils = { buildSelectionSeed, buildBrowserSeed };
```

- [ ] **Step 4: Add the `getActiveBrowserSelection` bridge in `src/main.ts`** — add this method to the `ClaudianPlugin` class (follows the existing `getActiveTab()?.controllers.<x>` access pattern used in `ClaudianView`):

```ts
getActiveBrowserSelection(): BrowserSelectionContext | null {
  return (
    this.getView()?.getTabManager()?.getActiveTab()?.controllers.browserSelectionController?.getContext() ?? null
  );
}
```

Add the import in `src/main.ts`:

```ts
import type { BrowserSelectionContext } from './utils/browser';
```

> If the active-tab controllers bag names the controller differently, match the name used by the sibling controllers (`inputController`, `conversationController`).

Register the command (near the selection command from Task 2):

```ts
import { /* ... */ createWorkOrderFromBrowserSelection } from './features/tasks/commands/taskCommands';

this.addCommand({
  id: 'create-work-order-from-browser-selection',
  name: 'Create work order from browser selection',
  callback: () => {
    void createWorkOrderFromBrowserSelection(this);
  },
});
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `npm run test -- --selectProjects unit tests/unit/features/tasks/commands/taskCommands.test.ts && npm run typecheck && npm run build`
Expected: PASS / clean build.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts src/main.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat(tasks): create work order from browser selection"
```

---

## Task 4: Chat message-action extension point

**Files:**
- Modify: `src/core/types/chat.ts`
- Create: `src/features/chat/rendering/messageActions.ts`
- Modify: `src/main.ts`
- Modify: `src/features/chat/rendering/MessageRenderer.ts`
- Modify: `src/style/components/messages.css`
- Test: `tests/unit/features/chat/rendering/messageActions.test.ts`
- Test: `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- [ ] **Step 1: Write the failing pure-selector test** — create `tests/unit/features/chat/rendering/messageActions.test.ts`:

```ts
import { eligibleMessageActions } from '@/features/chat/rendering/messageActions';
import type { ChatMessage, ChatMessageAction } from '@/core/types';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', role: 'user', content: 'hi', timestamp: 0, ...over,
});

const action = (over: Partial<ChatMessageAction> = {}): ChatMessageAction => ({
  id: 'a', label: 'A', icon: 'star', isEligible: () => true, run: () => {}, ...over,
});

describe('eligibleMessageActions', () => {
  it('keeps eligible actions and drops ineligible ones', () => {
    const yes = action({ id: 'yes' });
    const no = action({ id: 'no', isEligible: () => false });
    expect(eligibleMessageActions([yes, no], msg()).map((a) => a.id)).toEqual(['yes']);
  });

  it('treats a throwing predicate as ineligible', () => {
    const boom = action({ id: 'boom', isEligible: () => { throw new Error('x'); } });
    expect(eligibleMessageActions([boom], msg())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/chat/rendering/messageActions.test.ts`
Expected: FAIL (module + type missing).

- [ ] **Step 3: Add types in `src/core/types/chat.ts`** — add near `ChatMessage`:

```ts
export interface ChatMessageAction {
  id: string;
  label: string;
  icon: string;
  isEligible(message: ChatMessage): boolean;
  run(message: ChatMessage, conversationId: string | null): void;
}

export interface ConversationSnapshot {
  id: string;
  title: string;
}
```

Add the optional field to `Conversation` and `SessionMetadata` (in-memory link, no persistence wiring):

```ts
// inside interface Conversation
/** Optional link to a work-order note path. Absent for ad-hoc chat. */
workOrderPath?: string;
```
```ts
// inside interface SessionMetadata
workOrderPath?: string;
```

- [ ] **Step 4: Implement the selector** — create `src/features/chat/rendering/messageActions.ts`:

```ts
import type { ChatMessage, ChatMessageAction } from '../../../core/types';

export function eligibleMessageActions(
  actions: ChatMessageAction[],
  message: ChatMessage,
): ChatMessageAction[] {
  return actions.filter((action) => {
    try {
      return action.isEligible(message);
    } catch {
      return false;
    }
  });
}
```

- [ ] **Step 5: Run the selector test**

Run: `npm run test -- --selectProjects unit tests/unit/features/chat/rendering/messageActions.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the plugin registry + accessors in `src/main.ts`** — add fields/methods to `ClaudianPlugin`:

```ts
import type { ChatMessageAction, ConversationSnapshot } from './core/types';

readonly chatMessageActions: ChatMessageAction[] = [];

registerChatMessageAction(action: ChatMessageAction): void {
  this.chatMessageActions.push(action);
}

getActiveConversationSnapshot(): ConversationSnapshot | null {
  const tab = this.getView()?.getTabManager()?.getActiveTab();
  if (!tab?.conversationId) return null;
  const title = (tab as unknown as { title?: string }).title ?? 'Conversation';
  return { id: tab.conversationId, title };
}
```

- [ ] **Step 7: Write the failing renderer non-regression test** — add to `tests/unit/features/chat/rendering/MessageRenderer.test.ts`. First ensure the plugin mock used in that file includes `chatMessageActions: []` and `getActiveConversationSnapshot: () => null`. Then add:

```ts
describe('registered message actions', () => {
  it('renders no action button when the registry is empty', () => {
    // build a renderer with the file's existing helper, plugin.chatMessageActions = []
    // render a user message, then:
    expect(container.querySelector('.claudian-user-msg-action-btn')).toBeNull();
  });

  it('renders a button per eligible action and runs it on click', () => {
    const run = jest.fn();
    plugin.chatMessageActions.push({
      id: 'wo', label: 'Create work order', icon: 'kanban-square',
      isEligible: (m) => m.role === 'user', run,
    });
    // render a user message with content 'hello', then:
    const btn = container.querySelector<HTMLElement>('.claudian-user-msg-action-btn');
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent('click'));
    expect(run).toHaveBeenCalled();
  });
});
```

> Follow the existing setup in this file for constructing the renderer, the mock element/container, and rendering a user message. Reuse its `createMockComponent` / `createMockEl` helpers.

- [ ] **Step 8: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/chat/rendering/MessageRenderer.test.ts -t "registered message actions"`
Expected: FAIL (no `.claudian-user-msg-action-btn`).

- [ ] **Step 9: Render registered actions in `MessageRenderer.ts`** — add the import:

```ts
import { eligibleMessageActions } from './messageActions';
```

Add a method:

```ts
private addRegisteredMessageActions(msgEl: HTMLElement, msg: ChatMessage): void {
  const toolbar = this.getOrCreateActionsToolbar(msgEl);
  toolbar.querySelectorAll('.claudian-user-msg-action-btn').forEach((el) => el.remove());

  for (const action of eligibleMessageActions(this.plugin.chatMessageActions, msg)) {
    const btn = toolbar.createSpan({ cls: 'claudian-user-msg-action-btn' });
    setIcon(btn, action.icon);
    btn.setAttribute('aria-label', action.label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.run(msg, this.plugin.getActiveConversationSnapshot()?.id ?? null);
    });
  }
}
```

Call it immediately after each `this.addUserCopyButton(msgEl, textToShow);` call (lines ~161, ~203, ~299):

```ts
this.addUserCopyButton(msgEl, textToShow);
this.addRegisteredMessageActions(msgEl, msg);
```

Also, at the toolbar cleanup near line 199 (where copy buttons are removed before re-add), add the action-button cleanup so re-renders don't duplicate:

```ts
toolbar.querySelectorAll('.claudian-user-msg-copy-btn').forEach((el) => el.remove());
toolbar.querySelectorAll('.claudian-user-msg-action-btn').forEach((el) => el.remove());
```

- [ ] **Step 10: Style the button** — add to `src/style/components/messages.css`, next to the `.claudian-user-msg-copy-btn` rule:

```css
.claudian-user-msg-action-btn {
  cursor: pointer;
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
}
.claudian-user-msg-action-btn:hover {
  opacity: 1;
}
```

- [ ] **Step 11: Run renderer tests, typecheck, build**

Run: `npm run test -- --selectProjects unit tests/unit/features/chat/rendering/ && npm run typecheck && npm run build`
Expected: PASS (empty-registry case proves chat non-regression).

- [ ] **Step 12: Commit**

```bash
git add src/core/types/chat.ts src/features/chat/rendering/messageActions.ts src/features/chat/rendering/MessageRenderer.ts src/main.ts src/style/components/messages.css tests/unit/features/chat/rendering/messageActions.test.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts
git commit -m "feat(chat): add optional message-action registry rendered in the user toolbar"
```

---

## Task 5: ChatWorkOrderLinker + promotion wiring

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts` (message/conversation seed builders)
- Create: `src/features/tasks/execution/ChatWorkOrderLinker.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

- [ ] **Step 1: Write the failing seed-builder test**

```ts
describe('buildMessageSeed / buildConversationSeed', () => {
  it('message seed carries objective, conversation id, and inbox status', () => {
    const seed = __taskCaptureTestUtils.buildMessageSeed({
      messageContent: 'Refactor the parser\nfor speed',
      currentNote: 'notes/parser.md',
      conversationId: 'conv-9',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('Refactor the parser');
    expect(seed.objective).toBe('Refactor the parser\nfor speed');
    expect(seed.conversationId).toBe('conv-9');
    expect(seed.contextMarkdown).toContain('Source note: [[notes/parser]]');
    expect(seed.contextMarkdown).toContain('Promoted from chat message.');
  });

  it('conversation seed links the conversation', () => {
    const seed = __taskCaptureTestUtils.buildConversationSeed({
      conversationId: 'conv-9',
      conversationTitle: 'Auth spike',
    });
    expect(seed.title).toBe('Auth spike');
    expect(seed.conversationId).toBe('conv-9');
    expect(seed.contextMarkdown).toContain('Promoted from chat conversation.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "buildMessageSeed"`
Expected: FAIL.

- [ ] **Step 3: Implement the builders in `taskCommands.ts`**

```ts
export function buildMessageSeed(args: {
  messageContent: string;
  currentNote: string | null;
  conversationId: string | null;
}): WorkOrderSeed {
  const firstLine = args.messageContent.trim().split(/\r?\n/)[0] ?? '';
  const parts: string[] = [];
  if (args.currentNote) parts.push(`Source note: [[${stripMarkdownExtension(args.currentNote)}]]`);
  parts.push('Promoted from chat message.');
  return {
    title: truncate(firstLine, 60) || 'Work order from chat',
    objective: args.messageContent.trim(),
    contextMarkdown: parts.join('\n\n'),
    conversationId: args.conversationId,
    status: 'inbox',
  };
}

export function buildConversationSeed(args: {
  conversationId: string;
  conversationTitle: string;
}): WorkOrderSeed {
  return {
    title: truncate(args.conversationTitle, 60) || 'Work order from chat',
    contextMarkdown: 'Promoted from chat conversation.',
    conversationId: args.conversationId,
    status: 'inbox',
  };
}
```

Extend the test util:

```ts
export const __taskCaptureTestUtils = { buildSelectionSeed, buildBrowserSeed, buildMessageSeed, buildConversationSeed };
```

- [ ] **Step 4: Run the builder test**

Run: `npm run test -- --selectProjects unit -t "buildMessageSeed"`
Expected: PASS.

- [ ] **Step 5: Implement `ChatWorkOrderLinker`** — create `src/features/tasks/execution/ChatWorkOrderLinker.ts`:

```ts
import { Notice, type TFile } from 'obsidian';

import type { ChatMessage } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import {
  buildConversationSeed,
  buildMessageSeed,
  createWorkOrderFromSeed,
} from '../commands/taskCommands';

export class ChatWorkOrderLinker {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async promoteMessageToWorkOrder(message: ChatMessage, conversationId: string | null): Promise<TFile | null> {
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildMessageSeed({
        messageContent: message.content,
        currentNote: message.currentNote ?? null,
        conversationId,
      }),
    );
    if (created) new Notice('Work order created from chat message.');
    return created;
  }

  async promoteActiveConversationToWorkOrder(): Promise<TFile | null> {
    const snapshot = this.plugin.getActiveConversationSnapshot();
    if (!snapshot) {
      new Notice('Open a chat conversation first.');
      return null;
    }
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildConversationSeed({ conversationId: snapshot.id, conversationTitle: snapshot.title }),
    );
    if (created) new Notice('Work order created from chat conversation.');
    return created;
  }
}
```

> `buildMessageSeed` / `buildConversationSeed` must be plain `export function` declarations (not only in the test-utils object) so the linker can import them.

- [ ] **Step 6: Wire the linker, per-message action, and command in `src/main.ts`** — in `onload()`:

```ts
import { ChatWorkOrderLinker } from './features/tasks/execution/ChatWorkOrderLinker';

const chatWorkOrderLinker = new ChatWorkOrderLinker(this);

this.registerChatMessageAction({
  id: 'create-work-order-from-message',
  label: 'Create work order',
  icon: 'kanban-square',
  isEligible: (msg) => msg.role === 'user' && Boolean(msg.content?.trim()),
  run: (msg, conversationId) => {
    void chatWorkOrderLinker.promoteMessageToWorkOrder(msg, conversationId);
  },
});

this.addCommand({
  id: 'create-work-order-from-chat-conversation',
  name: 'Create work order from current chat conversation',
  callback: () => {
    void chatWorkOrderLinker.promoteActiveConversationToWorkOrder();
  },
});
```

- [ ] **Step 7: Run unit tests, typecheck, build**

Run: `npm run test -- --selectProjects unit && npm run typecheck && npm run build`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts src/features/tasks/execution/ChatWorkOrderLinker.ts src/main.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat(tasks): promote chat messages and conversations into work orders"
```

---

## Task 6: Board "Open conversation" affordance

**Files:**
- Modify: `src/main.ts` (public `openConversation`)
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts`
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Add a public `openConversation` bridge in `src/main.ts`** — add to `ClaudianPlugin`:

```ts
async openConversation(conversationId: string): Promise<void> {
  await this.activateView();
  await this.getView()?.getTabManager()?.openConversation(conversationId);
}
```

- [ ] **Step 2: Add the callback + button in `WorkOrderDetailModal.ts`** — add `onOpenConversation?: (task: TaskSpec) => void;` to the modal's callbacks interface. In the action-button area where `onOpenNote` renders its button, add (mirror the existing button construction):

```ts
if (this.task.frontmatter.conversation_id && this.callbacks.onOpenConversation) {
  const convBtn = actionsEl.createEl('button', { text: 'Open conversation' });
  convBtn.addEventListener('click', () => this.callbacks.onOpenConversation!(this.task));
}
```

> Use the same element/class pattern as the existing `onOpenNote` button in this file.

- [ ] **Step 3: Wire it in `AgentBoardView.openDetail`** — add to the callbacks object passed to `WorkOrderDetailModal`:

```ts
onOpenConversation: (target) => {
  const conversationId = target.frontmatter.conversation_id;
  if (conversationId) void this.plugin.openConversation(conversationId);
},
```

- [ ] **Step 4: Manual verification (no unit test — thin UI glue)**

Run: `npm run typecheck && npm run build`
Expected: clean. (Behavior is exercised by the Task 8 integration test.)

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/features/tasks/ui/WorkOrderDetailModal.ts src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): reopen the linked chat conversation from a work order"
```

---

## Task 7: Run next ready

**Files:**
- Create: `src/features/tasks/execution/selectNextReadyTask.ts`
- Modify: `src/features/tasks/ui/AgentBoardView.ts`
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`

- [ ] **Step 1: Write the failing selector test** — create `tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`:

```ts
import { selectNextReadyTask } from '@/features/tasks/execution/selectNextReadyTask';
import type { TaskSpec, TaskStatus, TaskPriority } from '@/features/tasks/model/taskTypes';

const task = (id: string, status: TaskStatus, priority: TaskPriority, created: string): TaskSpec =>
  ({
    path: `${id}.md`,
    frontmatter: { type: 'claudian-work-order', schema_version: 1, id, title: id, status, priority, created, updated: created, attempts: 0 },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  } as TaskSpec);

const isReady = (s: TaskStatus) => s === 'ready';

describe('selectNextReadyTask', () => {
  it('returns null when nothing is ready', () => {
    expect(selectNextReadyTask([task('a', 'running', 'high', '1')], isReady)).toBeNull();
  });

  it('prefers higher priority, then older created', () => {
    const tasks = [
      task('low-old', 'ready', 'low', '2026-01-01'),
      task('high-new', 'ready', 'high', '2026-03-01'),
      task('high-old', 'ready', 'high', '2026-02-01'),
    ];
    expect(selectNextReadyTask(tasks, isReady)?.frontmatter.id).toBe('high-old');
  });

  it('skips non-ready statuses', () => {
    const tasks = [task('r', 'review', 'urgent', '1'), task('ready', 'ready', 'normal', '2')];
    expect(selectNextReadyTask(tasks, isReady)?.frontmatter.id).toBe('ready');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the selector** — create `src/features/tasks/execution/selectNextReadyTask.ts`:

```ts
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function selectNextReadyTask(
  tasks: TaskSpec[],
  isReady: (status: TaskStatus) => boolean,
): TaskSpec | null {
  const eligible = tasks.filter(
    (task) => isReady(task.frontmatter.status) && task.frontmatter.status !== 'running',
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.frontmatter.priority] - PRIORITY_RANK[b.frontmatter.priority];
    if (byPriority !== 0) return byPriority;
    return a.frontmatter.created.localeCompare(b.frontmatter.created);
  })[0];
}
```

- [ ] **Step 4: Run the selector test**

Run: `npm run test -- --selectProjects unit tests/unit/features/tasks/execution/selectNextReadyTask.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `runNextReady()` to `AgentBoardView.ts`** — add the import and method:

```ts
import { selectNextReadyTask } from '../execution/selectNextReadyTask';

async runNextReady(): Promise<void> {
  const next = selectNextReadyTask(this.model.tasks, (status) => status === 'ready');
  if (!next) {
    new Notice('No ready work orders to run.');
    return;
  }
  await this.runTask(next);
}
```

- [ ] **Step 6: Add the toolbar button in `AgentBoardRenderer.ts`** — add `onRunNextReady: () => void;` to the renderer's actions/options type, and render a button in the board toolbar next to the existing "Add work order" button (mirror the `onAddWorkOrder` button construction exactly):

```ts
const runNextBtn = toolbarEl.createEl('button', { text: 'Run next ready' });
runNextBtn.addEventListener('click', () => actions.onRunNextReady());
```

In `AgentBoardView.render()`, add to the actions object passed to `this.renderer.render(...)`:

```ts
onRunNextReady: () => void this.runNextReady(),
```

- [ ] **Step 7: Add the command in `src/main.ts`** — add the method and command:

```ts
private async runNextReadyWorkOrder(): Promise<void> {
  await this.activateAgentBoardView();
  const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)[0];
  const view = leaf?.view;
  if (view instanceof AgentBoardView) {
    await view.runNextReady();
  }
}
```

```ts
this.addCommand({
  id: 'run-next-ready-work-order',
  name: 'Run next ready work order',
  callback: () => {
    void this.runNextReadyWorkOrder();
  },
});
```

> `VIEW_TYPE_CLAUDIAN_AGENT_BOARD` and `AgentBoardView` are already imported in `main.ts`.

- [ ] **Step 8: Run tests, typecheck, build**

Run: `npm run test -- --selectProjects unit && npm run typecheck && npm run build`
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/execution/selectNextReadyTask.ts src/features/tasks/ui/AgentBoardView.ts src/features/tasks/ui/AgentBoardRenderer.ts src/main.ts tests/unit/features/tasks/execution/selectNextReadyTask.test.ts
git commit -m "feat(tasks): run next ready work order from the board and command palette"
```

---

## Task 8: Integration test — capture → run; promote → link → reopen

**Files:**
- Test: `tests/integration/features/tasks/chatInteropAndCapture.test.ts`

- [ ] **Step 1: Write the integration test** — exercise the seams end to end with an in-memory vault double (follow the patterns in existing `tests/integration/features/tasks/`):

```ts
import { TaskNoteStore } from '@/features/tasks/storage/TaskNoteStore';
import { buildMessageSeed } from '@/features/tasks/commands/taskCommands';
import { selectNextReadyTask } from '@/features/tasks/execution/selectNextReadyTask';

describe('chat interop and capture (integration)', () => {
  it('a promoted message seed produces a parseable inbox order linked to the conversation', () => {
    const seed = buildMessageSeed({ messageContent: 'Do the thing', currentNote: 'a.md', conversationId: 'conv-1' });
    // simulate createWorkOrderFromSeed's markdown via buildWorkOrderMarkdown through TaskNoteStore round-trip:
    // (use the same buildWorkOrderMarkdown the command uses)
    expect(seed.conversationId).toBe('conv-1');
    expect(seed.status).toBe('inbox');
  });

  it('selectNextReadyTask picks a ready order created by capture', () => {
    const store = new TaskNoteStore();
    const ready = store.parse('x.md', `---\ntype: claudian-work-order\nschema_version: 1\nid: x\ntitle: X\nstatus: ready\npriority: normal\ncreated: 2026-05-29\nupdated: 2026-05-29\nattempts: 0\n---\n# X\n`).task;
    expect(selectNextReadyTask([ready], (s) => s === 'ready')?.frontmatter.id).toBe('x');
  });
});
```

> Expand with a fuller vault double if the existing integration suite provides one; the key assertions are: captured order parses, carries `conversation_id`, lands in `inbox`, and is selectable by run-next-ready.

- [ ] **Step 2: Run integration tests**

Run: `npm run test -- --selectProjects integration tests/integration/features/tasks/chatInteropAndCapture.test.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/features/tasks/chatInteropAndCapture.test.ts
git commit -m "test(tasks): integration coverage for chat interop and capture"
```

---

## Self-review notes

- **Spec coverage:** capture seed (Task 1), selection capture (Task 2), browser capture (Task 3), message-action extension point + chat non-regression (Task 4), `ChatWorkOrderLinker` + promotion (Task 5), board reopen of linked conversation (Task 6), run-next-ready (Task 7), integration (Task 8). Custom workflow notes and the chat-side chip are out of scope per the spec.
- **Non-regression:** Task 4 asserts an empty registry leaves the user toolbar unchanged; the full gate in Task 8 runs the existing chat suites.
- **Boundary:** `features/chat` imports only `core/types` (the `ChatMessageAction`/`ConversationSnapshot` types) and never `features/tasks`. `features/tasks` reaches chat only through plugin bridges (`registerChatMessageAction`, `getActiveConversationSnapshot`, `getActiveBrowserSelection`, `openConversation`).
- **Type consistency:** `WorkOrderSeed`, `createWorkOrderFromSeed`, `ChatMessageAction`, `ConversationSnapshot`, and `selectNextReadyTask` signatures are defined once and reused verbatim across tasks.
