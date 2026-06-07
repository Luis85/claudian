---
status: done
parent: "[[sidepanel-chat]]"
---
# Folder Add-to-Chat + Inline Context Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add a folder to the chat via right-click (single `@folder/` mention), and render the files/folders a sent message references as an "Attached context" card inside that message.

**Architecture:** Folder add mirrors the existing `@`-dropdown folder behavior (insert `@path/` text, no `attachFile` state). The context card is derived at render time from the user message's `@mentions` (validated against the vault) — no `ChatMessage` model change, so it persists for free and works for both providers.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, Jest (`node scripts/run-jest.js`), modular CSS (`scripts/build-css.mjs`).

Spec: `docs/superpowers/specs/2026-05-27-folder-add-and-context-card-design.md`

Run a single test file with: `npm run test -- <path>`

---

### Task 1: Extract `insertMentionAtCursor` + add `insertVaultFolderMention`

**Files:**
- Modify: `src/features/chat/ui/FileContext.ts` (current `insertVaultFileMention` is at lines 221-248)
- Test: `tests/unit/features/chat/ui/FileContextManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these inside the existing top-level `describe` in `tests/unit/features/chat/ui/FileContextManager.test.ts`, using the file's existing manager/input setup (the same construction used by current `insertVaultFileMention` tests — reuse the existing `createManager`-style helper and its `inputEl`/`manager` handles):

```typescript
describe('insertVaultFolderMention', () => {
  it('inserts an @path/ mention and does not attach the folder as a file', () => {
    const { manager, inputEl } = createManager();
    inputEl.value = '';
    inputEl.selectionStart = 0;
    inputEl.selectionEnd = 0;

    const result = manager.insertVaultFolderMention('src/providers');

    expect(result).toBe(true);
    expect(inputEl.value).toBe('@src/providers/ ');
    expect(manager.getAttachedFiles().has('src/providers')).toBe(false);
    expect(manager.getAttachedFiles().size).toBe(0);
  });

  it('returns false for an empty / unnormalizable path (vault root)', () => {
    const { manager } = createManager();
    expect(manager.insertVaultFolderMention('')).toBe(false);
  });
});

describe('insertVaultFileMention (regression)', () => {
  it('still attaches the file to context', () => {
    const { manager, inputEl } = createManager();
    inputEl.value = '';
    inputEl.selectionStart = 0;
    inputEl.selectionEnd = 0;

    const result = manager.insertVaultFileMention('notes.md');

    expect(result).toBe(true);
    expect(inputEl.value).toBe('@notes.md ');
    expect(manager.getAttachedFiles().has('notes.md')).toBe(true);
  });
});
```

> If the existing test file does not expose a `createManager()` helper, define one at the top of the file that builds a `FileContextManager` with a `createMockEl()` input element and the existing `createMockApp()` — matching how the current file constructs the manager — and returns `{ manager, inputEl }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/chat/ui/FileContextManager.test.ts`
Expected: FAIL — `manager.insertVaultFolderMention is not a function`.

- [ ] **Step 3: Refactor and implement in `src/features/chat/ui/FileContext.ts`**

Replace the existing `insertVaultFileMention` method (lines 221-248) with the shared helper plus both public methods:

```typescript
  /** Splices a mention body into the input at the cursor, with smart spacing. */
  private insertMentionAtCursor(body: string): void {
    const start = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const beforeSelection = this.inputEl.value.slice(0, start);
    const afterSelection = this.inputEl.value.slice(end);
    const leadingSpace = beforeSelection.length > 0 && !/\s$/u.test(beforeSelection) ? ' ' : '';
    const trailingSpace = afterSelection.length > 0
      ? (/^\s/u.test(afterSelection) ? '' : ' ')
      : ' ';
    const mention = `${leadingSpace}${body}${trailingSpace}`;

    this.inputEl.value = beforeSelection + mention + afterSelection;
    const cursorPosition = beforeSelection.length + mention.length;
    this.inputEl.selectionStart = cursorPosition;
    this.inputEl.selectionEnd = cursorPosition;

    if (typeof this.inputEl.dispatchEvent === 'function') {
      const EventCtor = this.inputEl.ownerDocument?.defaultView?.Event ?? Event;
      this.inputEl.dispatchEvent(new EventCtor('input', { bubbles: true }));
    }
    this.inputEl.focus();
  }

  /** Inserts a vault @-mention for a file into the chat input. */
  insertVaultFileMention(filePath: string): boolean {
    const normalizedPath = this.normalizePathForVault(filePath);
    if (!normalizedPath) return false;

    // Attach before dispatching `input` so consumers see the updated set.
    this.state.attachFile(normalizedPath);
    this.insertMentionAtCursor(`@${normalizedPath}`);
    return true;
  }

  /** Inserts a vault @-mention for a folder. Folders are not tracked as file chips. */
  insertVaultFolderMention(folderPath: string): boolean {
    const normalizedPath = this.normalizePathForVault(folderPath);
    if (!normalizedPath) return false;

    this.insertMentionAtCursor(`@${normalizedPath}/`);
    return true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/chat/ui/FileContextManager.test.ts`
Expected: PASS (new folder tests + file regression).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/FileContext.ts tests/unit/features/chat/ui/FileContextManager.test.ts
git commit -m "feat(chat): add insertVaultFolderMention for folder context"
```

---

### Task 2: Right-click "Add folder to Claudian chat"

**Files:**
- Modify: `src/main.ts` (imports line 8; `file-menu` handler lines 97-110; add `addFolderToActiveChat` near `addFileToActiveChat` at lines 233-251)

No unit harness exists for `main.ts` plugin registration; this task is verified by typecheck/build plus a manual smoke check.

- [ ] **Step 1: Add the `TFolder` import**

In `src/main.ts`, change line 8 from:

```typescript
import { debounce, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
```
to:
```typescript
import { debounce, MarkdownView, Notice, Plugin, TFile, TFolder } from 'obsidian';
```

- [ ] **Step 2: Branch the `file-menu` handler**

Replace the handler body (lines 97-110) with:

```typescript
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile) {
          menu.addItem((item) => {
            item
              .setTitle('Add file to Claudian chat')
              .setIcon('at-sign')
              .onClick(() => {
                void this.addFileToActiveChat(file);
              });
          });
        } else if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('Add folder to Claudian chat')
              .setIcon('folder')
              .onClick(() => {
                void this.addFolderToActiveChat(file);
              });
          });
        }
      })
    );
```

- [ ] **Step 3: Add `addFolderToActiveChat`**

Immediately after the `addFileToActiveChat` method (after line 251), add:

```typescript
  async addFolderToActiveChat(folder: TFolder): Promise<boolean> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const fileContextManager = activeTab?.ui.fileContextManager;

    if (!activeTab || !fileContextManager) {
      new Notice('Open Claudian chat and enable a provider before adding folder context.');
      return false;
    }

    if (!fileContextManager.insertVaultFolderMention(folder.path)) {
      new Notice(`Could not add folder to chat: ${folder.path}`);
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(`Added ${folder.path}/ to Claudian chat`);
    return true;
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(chat): right-click add folder to chat"
```

---

### Task 3: `extractVaultMentions` utility

**Files:**
- Modify: `src/utils/contextMentionResolver.ts` (export `collectMentionEndCandidates`, currently an unexported function at line 17)
- Create: `src/utils/vaultMentions.ts`
- Test: `tests/unit/utils/vaultMentions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utils/vaultMentions.test.ts`:

```typescript
import { extractVaultMentions } from '@/utils/vaultMentions';

const vault: Record<string, 'file' | 'folder'> = {
  'notes.md': 'file',
  'src/api.ts': 'file',
  'my notes.md': 'file',
  'src/providers': 'folder',
};
const resolve = (p: string) => vault[p] ?? null;

describe('extractVaultMentions', () => {
  it('separates file and folder mentions', () => {
    const r = extractVaultMentions('see @notes.md and @src/providers/ now', resolve);
    expect(r.files).toEqual(['notes.md']);
    expect(r.folders).toEqual(['src/providers']);
  });

  it('greedily matches paths containing spaces', () => {
    const r = extractVaultMentions('open @my notes.md please', resolve);
    expect(r.files).toEqual(['my notes.md']);
  });

  it('ignores @tokens that are not vault entries', () => {
    const r = extractVaultMentions('email me @someone and @nope.txt', resolve);
    expect(r.files).toEqual([]);
    expect(r.folders).toEqual([]);
  });

  it('strips trailing punctuation to find the real file', () => {
    const r = extractVaultMentions('look at @notes.md.', resolve);
    expect(r.files).toEqual(['notes.md']);
  });

  it('de-duplicates repeated mentions', () => {
    const r = extractVaultMentions('@notes.md and again @notes.md', resolve);
    expect(r.files).toEqual(['notes.md']);
  });

  it('only matches mentions at a boundary', () => {
    const r = extractVaultMentions('email user@notes.md', resolve);
    expect(r.files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/utils/vaultMentions.test.ts`
Expected: FAIL — cannot resolve module `@/utils/vaultMentions`.

- [ ] **Step 3: Export the helper and implement the util**

In `src/utils/contextMentionResolver.ts`, change line 17 from:
```typescript
function collectMentionEndCandidates(text: string, pathStart: number): number[] {
```
to:
```typescript
export function collectMentionEndCandidates(text: string, pathStart: number): number[] {
```

Create `src/utils/vaultMentions.ts`:

```typescript
import {
  collectMentionEndCandidates,
  isMentionStart,
  normalizeMentionPath,
} from './contextMentionResolver';

export type VaultMentionKind = 'file' | 'folder';

export interface VaultMentions {
  files: string[];
  folders: string[];
}

/**
 * Extracts vault @-mentions from message text, validating each against the vault.
 * `resolve` returns 'file' | 'folder' for a normalized path, or null if it is not a
 * vault entry. Candidates are tried longest-first so paths with spaces resolve.
 */
export function extractVaultMentions(
  text: string,
  resolve: (normalizedPath: string) => VaultMentionKind | null,
): VaultMentions {
  const files: string[] = [];
  const folders: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < text.length; index++) {
    if (!isMentionStart(text, index)) continue;

    const pathStart = index + 1;
    const candidates = collectMentionEndCandidates(text, pathStart);
    for (const end of candidates) {
      const raw = text.slice(pathStart, end);
      const normalized = normalizeMentionPath(raw);
      if (!normalized) continue;

      const hasTrailingSlash = /\/\s*$/.test(raw);
      const kind = resolve(normalized) ?? (hasTrailingSlash ? 'folder' : null);
      if (!kind) continue;

      const key = `${kind}:${normalized}`;
      if (!seen.has(key)) {
        seen.add(key);
        (kind === 'folder' ? folders : files).push(normalized);
      }
      index = end - 1; // skip past the consumed mention
      break;
    }
  }

  return { files, folders };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/utils/vaultMentions.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/vaultMentions.ts src/utils/contextMentionResolver.ts tests/unit/utils/vaultMentions.test.ts
git commit -m "feat(utils): extractVaultMentions for context-card derivation"
```

---

### Task 4: `MessageContextCard` view component

**Files:**
- Create: `src/features/chat/rendering/MessageContextCard.ts`
- Test: `tests/unit/features/chat/rendering/MessageContextCard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/rendering/MessageContextCard.test.ts`:

```typescript
import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { renderMessageContextCard } from '@/features/chat/rendering/MessageContextCard';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

function findAll(root: MockElement, cls: string): MockElement[] {
  const out: MockElement[] = [];
  const walk = (n: MockElement) => {
    if (n.hasClass(cls)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe('renderMessageContextCard', () => {
  it('returns null and renders nothing when there is no context', () => {
    const container = createMockEl();
    const card = renderMessageContextCard(container, { files: [], folders: [] });
    expect(card).toBeNull();
    expect(findAll(container, 'claudian-context-card')).toHaveLength(0);
  });

  it('renders a row per file and folder with a total count', () => {
    const container = createMockEl();
    renderMessageContextCard(container, {
      files: ['notes.md', 'src/api.ts'],
      folders: ['src/providers'],
    });

    expect(findAll(container, 'claudian-context-card')).toHaveLength(1);
    expect(findAll(container, 'claudian-context-card-row')).toHaveLength(3);
    expect(findAll(container, 'claudian-context-card-row--folder')).toHaveLength(1);

    const label = findAll(container, 'claudian-context-card-header-label')[0];
    expect(label.textContent).toBe('Attached context (3)');

    const names = findAll(container, 'claudian-context-card-row-name').map((n) => n.textContent);
    expect(names).toEqual(['notes.md', 'api.ts', 'providers/']);
  });

  it('invokes onOpenFile when a file row is clicked', () => {
    const container = createMockEl();
    const onOpenFile = jest.fn();
    renderMessageContextCard(container, { files: ['notes.md'], folders: [] }, { onOpenFile });

    const row = findAll(container, 'claudian-context-card-row--file')[0];
    row.dispatchEvent(new Event('click'));
    expect(onOpenFile).toHaveBeenCalledWith('notes.md');
  });
});
```

> If `MockElement` lacks `textContent`/`dispatchEvent`, follow the equivalent assertion style already used in `tests/unit/features/chat/ui/FileContextManager.test.ts` (e.g. read the span via the `setText` mock or a `getText()` helper) — match the existing harness rather than inventing new element APIs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageContextCard.test.ts`
Expected: FAIL — cannot resolve `@/features/chat/rendering/MessageContextCard`.

- [ ] **Step 3: Implement the component**

Create `src/features/chat/rendering/MessageContextCard.ts`:

```typescript
import { setIcon } from 'obsidian';

export interface ContextCardData {
  files: string[];
  folders: string[];
}

export interface MessageContextCardCallbacks {
  onOpenFile?: (path: string) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

/** Renders a display-only "Attached context" card. Returns null when empty. */
export function renderMessageContextCard(
  containerEl: HTMLElement,
  data: ContextCardData,
  callbacks: MessageContextCardCallbacks = {},
): HTMLElement | null {
  const total = data.files.length + data.folders.length;
  if (total === 0) return null;

  const cardEl = containerEl.createDiv({ cls: 'claudian-context-card' });

  const headerEl = cardEl.createDiv({ cls: 'claudian-context-card-header' });
  setIcon(headerEl.createSpan({ cls: 'claudian-context-card-header-icon' }), 'paperclip');
  headerEl
    .createSpan({ cls: 'claudian-context-card-header-label' })
    .setText(`Attached context (${total})`);

  const listEl = cardEl.createDiv({ cls: 'claudian-context-card-list' });

  for (const path of data.files) {
    const rowEl = listEl.createDiv({
      cls: 'claudian-context-card-row claudian-context-card-row--file',
    });
    setIcon(rowEl.createSpan({ cls: 'claudian-context-card-row-icon' }), 'file-text');
    const nameEl = rowEl.createSpan({ cls: 'claudian-context-card-row-name' });
    nameEl.setText(basename(path));
    nameEl.setAttribute('title', path);
    if (callbacks.onOpenFile) {
      rowEl.addClass('claudian-context-card-row--clickable');
      rowEl.addEventListener('click', () => callbacks.onOpenFile?.(path));
    }
  }

  for (const path of data.folders) {
    const rowEl = listEl.createDiv({
      cls: 'claudian-context-card-row claudian-context-card-row--folder',
    });
    setIcon(rowEl.createSpan({ cls: 'claudian-context-card-row-icon' }), 'folder');
    const nameEl = rowEl.createSpan({ cls: 'claudian-context-card-row-name' });
    nameEl.setText(`${basename(path)}/`);
    nameEl.setAttribute('title', path);
  }

  return cardEl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageContextCard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/MessageContextCard.ts tests/unit/features/chat/rendering/MessageContextCard.test.ts
git commit -m "feat(chat): MessageContextCard view component"
```

---

### Task 5: Wire the card into `MessageRenderer`

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts` (imports lines 1-2 and 13; user branches in `addMessage` ~132, `updateLiveUserMessage` ~166, stored render ~263)
- Test: `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing top-level `describe` in `tests/unit/features/chat/rendering/MessageRenderer.test.ts`, reusing the file's existing renderer/`messagesEl` setup and its mock app (configure the mock vault so `getAbstractFileByPath('notes.md')` returns a `TFile` and `getAbstractFileByPath('src/providers')` returns a `TFolder`):

```typescript
describe('user context card', () => {
  it('renders an attached-context card for resolved @mentions in a user message', () => {
    const { renderer, messagesEl } = createRenderer();

    renderer.addMessage({
      id: 'm1',
      role: 'user',
      content: 'explain @src/providers/ using @notes.md',
      timestamp: Date.now(),
    });

    const cards = messagesEl.querySelectorAll('.claudian-context-card');
    expect(cards).toHaveLength(1);
    expect(messagesEl.querySelectorAll('.claudian-context-card-row')).toHaveLength(2);
  });

  it('renders no card when no @mentions resolve to vault entries', () => {
    const { renderer, messagesEl } = createRenderer();

    renderer.addMessage({
      id: 'm2',
      role: 'user',
      content: 'just a plain message',
      timestamp: Date.now(),
    });

    expect(messagesEl.querySelectorAll('.claudian-context-card')).toHaveLength(0);
  });
});
```

> Use the test file's existing renderer factory and mock-app setup. If the mock app's `vault.getAbstractFileByPath` is not configurable, extend the existing mock to return `TFile`/`TFolder` instances by path (mirroring how `FileContextManager.test.ts` builds mock files).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: FAIL — no `.claudian-context-card` rendered.

- [ ] **Step 3: Add imports**

In `src/features/chat/rendering/MessageRenderer.ts` line 2, add `TFile` and `TFolder`:

```typescript
import { MarkdownRenderer, Menu, Notice, setIcon, TFile, TFolder } from 'obsidian';
```

After the existing import block (after line 28), add:

```typescript
import { extractVaultMentions } from '../../../utils/vaultMentions';
import { renderMessageContextCard } from './MessageContextCard';
```

- [ ] **Step 4: Add the private helper**

Add this method to the `MessageRenderer` class (e.g. right after `getSubagentLifecycleAdapter`, near line 96):

```typescript
  private renderUserContextCard(contentEl: HTMLElement, msg: ChatMessage): void {
    if (msg.isRebuiltContext) return;
    const textToShow = msg.displayContent ?? msg.content;
    if (!textToShow) return;

    const mentions = extractVaultMentions(textToShow, (path) => {
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry instanceof TFile) return 'file';
      if (entry instanceof TFolder) return 'folder';
      return null;
    });

    renderMessageContextCard(contentEl, mentions, {
      onOpenFile: (path) => {
        void this.app.workspace.openLinkText(path, '', false);
      },
    });
  }
```

- [ ] **Step 5: Call the helper in all three user-render paths**

In `addMessage` (the `if (msg.role === 'user')` block at ~132), insert the call as the first statement inside the block, before `const textToShow`:

```typescript
    if (msg.role === 'user') {
      this.renderUserContextCard(contentEl, msg);
      const textToShow = msg.displayContent ?? msg.content;
```

In `updateLiveUserMessage` (~164-168), after `contentEl.empty();` and before the text block:

```typescript
    contentEl.empty();
    this.renderUserContextCard(contentEl, msg);

    const textToShow = msg.displayContent ?? msg.content;
```

In the stored render method (the `if (msg.role === 'user')` block at ~263), insert as the first statement inside the block, before `const textToShow`:

```typescript
    if (msg.role === 'user') {
      this.renderUserContextCard(contentEl, msg);
      const textToShow = msg.displayContent ?? msg.content;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts
git commit -m "feat(chat): render attached-context card in user messages"
```

---

### Task 6: Context-card styling

**Files:**
- Create: `src/style/features/context-card.css`
- Modify: `src/style/index.css` (Features section, after line 45)

- [ ] **Step 1: Create the stylesheet**

Create `src/style/features/context-card.css`:

```css
.claudian-context-card {
  margin-bottom: 6px;
  padding: 6px 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-secondary);
  font-size: var(--font-ui-smaller);
}

.claudian-context-card-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  color: var(--text-muted);
}

.claudian-context-card-header-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
}

.claudian-context-card-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.claudian-context-card-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--text-normal);
}

.claudian-context-card-row-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}

.claudian-context-card-row-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.claudian-context-card-row--clickable {
  cursor: pointer;
}

.claudian-context-card-row--clickable:hover {
  background: var(--background-modifier-hover);
}
```

- [ ] **Step 2: Register the module**

In `src/style/index.css`, add after line 45 (`@import "./features/empty-state.css";`):

```css
@import "./features/context-card.css";
```

- [ ] **Step 3: Verify the CSS build**

Run: `npm run build:css`
Expected: completes without error (the missing-`@import` failure mode does not trigger).

- [ ] **Step 4: Commit**

```bash
git add src/style/features/context-card.css src/style/index.css
git commit -m "style(chat): attached-context card styles"
```

---

### Task 7: Full verification

**Files:** none (gate task)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings (project baseline is clean).

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: all suites pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds `main.js` and `styles.css` with no errors.

- [ ] **Step 5: Manual smoke check**

In Obsidian (after reloading the plugin from the `claudian-cursor` folder):
1. Right-click a folder in the file explorer → "Add folder to Claudian chat" → input shows `@<folder>/`.
2. Right-click a file → "Add file to Claudian chat" → input shows `@<file>`.
3. Send a message containing both → the sent message shows an "Attached context" card listing the file and folder; clicking a file row opens it.
4. Reload the conversation → the card still renders (derived from message content).

- [ ] **Step 6: Commit any fixups**

```bash
git add -A
git commit -m "chore: verification fixups for folder add + context card"
```

(Skip if nothing changed.)

---

## Self-Review

**Spec coverage:**
- Folder right-click add (single `@folder/`, no chip) → Tasks 1 + 2. ✓
- Multi-select out of scope → not implemented. ✓
- Inline context card derived from message content → Tasks 3-5. ✓
- Keep mention text inline + additive card → Task 5 renders card above the unchanged text block. ✓
- Greedy space handling, ignore non-resolving tokens, dedupe → Task 3 tests. ✓
- Vault-root edge → Task 1 test (`insertVaultFolderMention('')` → false) + Task 2 notice. ✓
- Styling in style layer, `.claudian-` prefix, registered in barrel → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. Harness-dependent test steps include explicit fallback instructions rather than vague references.

**Type consistency:** `insertVaultFolderMention`/`insertVaultFileMention` (FileContext) used consistently in Tasks 1-2. `extractVaultMentions(text, resolve) → { files, folders }` defined in Task 3 and consumed unchanged in Task 5. `renderMessageContextCard(containerEl, { files, folders }, { onOpenFile })` defined in Task 4 and called identically in Task 5. CSS class names in Task 4/6 match the assertions in Task 4's test (`claudian-context-card`, `-row`, `-row--folder`, `-row--file`, `-header-label`, `-row-name`).
