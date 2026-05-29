---
status: done
---
# Composer Context Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw `@path` mention text in the chat composer with removable pills (current note + files + folders) shown above the textarea, Cursor-style, folding the attachments into the message content at send.

**Architecture:** Pills are the composer's source of truth (`FileContextState` tracks files + folders; current note stays in `currentNotePath`). Adding a file/folder (right-click or `@` dropdown) creates a pill, never inserts text. At send, `InputController` appends `@path`/`@folder/` for each pill to the content fed to the provider (`turnRequest.text`), leaving `displayContent` as clean prose. The in-thread context card derives from `msg.content` (which carries the folded mentions).

**Tech Stack:** TypeScript, Obsidian API, Jest (`node scripts/run-jest.js`), modular CSS.

Spec: `docs/superpowers/specs/2026-05-28-composer-context-pills-design.md`. Run one test file with `npm run test -- <path>`.

**Callback contracts introduced (used across tasks — keep names consistent):**
- `FileChipsView` callbacks: `onRemove(path: string, kind: 'current' | 'file' | 'folder')`, `onOpenFile(path: string)`.
- `FileChipsView.renderPills({ currentNote: string | null; files: string[]; folders: string[] })`.
- `MentionDropdownController` callback: `onAddContextPill(path: string, kind: 'file' | 'folder')`.
- `FileContextManager`: `attachFileAsPill(path): boolean`, `attachFolderAsPill(path): boolean`, `getAttachedMentionSuffix(): string`.
- `FileContextState`: `attachFolder(path)`, `detachFolder(path)`, `getAttachedFolders(): Set<string>`, `setAttachedFolders(paths: string[])`.

---

### Task 1: Folder state in `FileContextState`

**Files:**
- Modify: `src/features/chat/ui/file-context/state/FileContextState.ts`
- Test: `tests/unit/features/chat/ui/file-context/state/FileContextState.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/features/chat/ui/file-context/state/FileContextState.test.ts`:

```typescript
describe('attachedFolders', () => {
  it('attaches, reports, and detaches folders independently of files', () => {
    const state = new FileContextState();
    state.attachFile('a.md');
    state.attachFolder('src/providers');
    expect(state.getAttachedFolders().has('src/providers')).toBe(true);
    expect(state.getAttachedFiles().has('src/providers')).toBe(false);
    state.detachFolder('src/providers');
    expect(state.getAttachedFolders().size).toBe(0);
    expect(state.getAttachedFiles().has('a.md')).toBe(true);
  });

  it('clearAttachments clears folders too', () => {
    const state = new FileContextState();
    state.attachFolder('src');
    state.clearAttachments();
    expect(state.getAttachedFolders().size).toBe(0);
  });

  it('setAttachedFolders replaces the folder set', () => {
    const state = new FileContextState();
    state.attachFolder('old');
    state.setAttachedFolders(['x', 'y']);
    expect([...state.getAttachedFolders()].sort()).toEqual(['x', 'y']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/ui/file-context/state/FileContextState.test.ts`
Expected: FAIL — `state.attachFolder is not a function`.

- [ ] **Step 3: Implement**

In `src/features/chat/ui/file-context/state/FileContextState.ts`, add the field next to `attachedFiles`:

```typescript
  private attachedFolders: Set<string> = new Set();
```

Add these methods (next to the file equivalents):

```typescript
  getAttachedFolders(): Set<string> {
    return new Set(this.attachedFolders);
  }

  setAttachedFolders(folders: string[]): void {
    this.attachedFolders.clear();
    for (const folder of folders) {
      this.attachedFolders.add(folder);
    }
  }

  attachFolder(path: string): void {
    this.attachedFolders.add(path);
  }

  detachFolder(path: string): void {
    this.attachedFolders.delete(path);
  }
```

Add `this.attachedFolders.clear();` to **every** existing method that clears `attachedFiles`: `resetForNewConversation`, `resetForLoadedConversation`, and `clearAttachments`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/features/chat/ui/file-context/state/FileContextState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/file-context/state/FileContextState.ts tests/unit/features/chat/ui/file-context/state/FileContextState.test.ts
git commit -m "feat(chat): track attached folders in FileContextState"
```

---

### Task 2: Pill tray in `FileChipsView`

**Files:**
- Modify: `src/features/chat/ui/file-context/view/FileChipsView.ts`
- Test: `tests/unit/features/chat/ui/file-context/view/FileChipsView.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `tests/unit/features/chat/ui/file-context/view/FileChipsView.test.ts`:

```typescript
import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { FileChipsView } from '@/features/chat/ui/file-context/view/FileChipsView';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

function findAll(root: MockElement, cls: string): MockElement[] {
  const out: MockElement[] = [];
  const walk = (n: MockElement) => { if (n.hasClass(cls)) out.push(n); n.children.forEach(walk); };
  walk(root);
  return out;
}

describe('FileChipsView.renderPills', () => {
  it('renders current-note, file, and folder pills, deduping the current note', () => {
    const container = createMockEl();
    const view = new FileChipsView(container, { onRemove: jest.fn(), onOpenFile: jest.fn() });

    view.renderPills({ currentNote: 'note.md', files: ['note.md', 'a.ts'], folders: ['src'] });

    // note.md is both current and attached -> one pill (current), plus a.ts, plus src = 3
    expect(findAll(container, 'claudian-file-chip')).toHaveLength(3);
    expect(findAll(container, 'claudian-file-chip--current')).toHaveLength(1);
    expect(findAll(container, 'claudian-file-chip--folder')).toHaveLength(1);
  });

  it('hides the tray when empty', () => {
    const container = createMockEl();
    const view = new FileChipsView(container, { onRemove: jest.fn(), onOpenFile: jest.fn() });
    view.renderPills({ currentNote: null, files: [], folders: [] });
    expect(findAll(container, 'claudian-file-chip')).toHaveLength(0);
  });

  it('fires onRemove with the right kind and does not open folders', () => {
    const container = createMockEl();
    const onRemove = jest.fn();
    const onOpenFile = jest.fn();
    const view = new FileChipsView(container, { onRemove, onOpenFile });
    view.renderPills({ currentNote: null, files: ['a.ts'], folders: ['src'] });

    const folderPill = findAll(container, 'claudian-file-chip--folder')[0];
    folderPill.dispatchEvent(new Event('click'));
    expect(onOpenFile).not.toHaveBeenCalled();

    const removeBtn = findAll(folderPill, 'claudian-file-chip-remove')[0];
    removeBtn.dispatchEvent(new Event('click'));
    expect(onRemove).toHaveBeenCalledWith('src', 'folder');
  });
});
```

> First read `tests/helpers/mockElement.ts` and the existing `FileContextManager.test.ts` to confirm `MockElement` supports `dispatchEvent(new Event('click'))`, `hasClass`, `children`, `createDiv`/`createSpan`, `setText`, `setAttribute`, `addClass`, `addEventListener`. Adapt the click/find approach to the harness if needed (keep the same intent and assertions).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/ui/file-context/view/FileChipsView.test.ts`
Expected: FAIL — `view.renderPills is not a function`.

- [ ] **Step 3: Implement**

Replace the contents of `src/features/chat/ui/file-context/view/FileChipsView.ts` with:

```typescript
import { setIcon } from 'obsidian';

export type PillKind = 'current' | 'file' | 'folder';

export interface FileChipsViewCallbacks {
  onRemove: (path: string, kind: PillKind) => void;
  onOpenFile: (path: string) => void;
}

export interface PillData {
  currentNote: string | null;
  files: string[];
  folders: string[];
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export class FileChipsView {
  private containerEl: HTMLElement;
  private callbacks: FileChipsViewCallbacks;
  private fileIndicatorEl: HTMLElement;

  constructor(containerEl: HTMLElement, callbacks: FileChipsViewCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;

    const firstChild = this.containerEl.firstChild;
    this.fileIndicatorEl = this.containerEl.createDiv({ cls: 'claudian-file-indicator' });
    if (firstChild) {
      this.containerEl.insertBefore(this.fileIndicatorEl, firstChild);
    }
  }

  destroy(): void {
    this.fileIndicatorEl.remove();
  }

  renderPills(data: PillData): void {
    this.fileIndicatorEl.empty();

    const current = data.currentNote;
    // Dedupe: a file equal to the current note renders once, as the current pill.
    const files = data.files.filter((p) => p !== current);

    const total = (current ? 1 : 0) + files.length + data.folders.length;
    if (total === 0) {
      this.fileIndicatorEl.removeClass('claudian-visible-flex');
      this.fileIndicatorEl.addClass('claudian-hidden');
      return;
    }

    this.fileIndicatorEl.addClass('claudian-visible-flex');
    this.fileIndicatorEl.removeClass('claudian-hidden');

    if (current) {
      this.renderPill(current, 'current', 'file-text', basename(current), true);
    }
    for (const path of files) {
      this.renderPill(path, 'file', 'file-text', basename(path), true);
    }
    for (const path of data.folders) {
      this.renderPill(path, 'folder', 'folder', `${basename(path)}/`, false);
    }
  }

  private renderPill(
    path: string,
    kind: PillKind,
    iconName: string,
    label: string,
    openable: boolean,
  ): void {
    const chipEl = this.fileIndicatorEl.createDiv({
      cls: `claudian-file-chip claudian-file-chip--${kind}`,
    });

    const iconEl = chipEl.createSpan({ cls: 'claudian-file-chip-icon' });
    setIcon(iconEl, iconName);

    const nameEl = chipEl.createSpan({ cls: 'claudian-file-chip-name' });
    nameEl.setText(label);
    nameEl.setAttribute('title', path);

    const removeEl = chipEl.createSpan({ cls: 'claudian-file-chip-remove' });
    removeEl.setText('×');
    removeEl.setAttribute('aria-label', 'Remove');

    if (openable) {
      chipEl.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.claudian-file-chip-remove')) {
          this.callbacks.onOpenFile(path);
        }
      });
    }

    removeEl.addEventListener('click', () => {
      this.callbacks.onRemove(path, kind);
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/features/chat/ui/file-context/view/FileChipsView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/file-context/view/FileChipsView.ts tests/unit/features/chat/ui/file-context/view/FileChipsView.test.ts
git commit -m "feat(chat): render context pill tray in FileChipsView"
```

---

### Task 3: Pill methods, wiring, sync, and mention suffix in `FileContextManager`

**Files:**
- Modify: `src/features/chat/ui/FileContext.ts`
- Test: `tests/unit/features/chat/ui/FileContextManager.test.ts`

This task adapts the manager to the new `FileChipsView` API, adds pill add/remove, folder rename/delete sync, reset, and the send-time mention suffix. It removes the obsolete `insertVaultFileMention`/`insertVaultFolderMention`/`insertMentionAtCursor` text-insertion methods (superseded by pills).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/features/chat/ui/FileContextManager.test.ts` (reuse the existing `createManager()` helper):

```typescript
describe('context pills', () => {
  it('attachFileAsPill tracks the file without inserting text', () => {
    const { manager, inputEl } = createManager();
    inputEl.value = 'hello';
    expect(manager.attachFileAsPill('a.ts')).toBe(true);
    expect(inputEl.value).toBe('hello');
    expect(manager.getAttachedFiles().has('a.ts')).toBe(true);
  });

  it('attachFolderAsPill tracks the folder; returns false on empty path', () => {
    const { manager } = createManager();
    expect(manager.attachFolderAsPill('src/providers')).toBe(true);
    expect(manager.getAttachedFolders().has('src/providers')).toBe(true);
    expect(manager.attachFolderAsPill('')).toBe(false);
  });

  it('getAttachedMentionSuffix appends file and folder mentions, excluding the current note', () => {
    const { manager } = createManager();
    manager.setCurrentNote('note.md');
    manager.attachFileAsPill('note.md'); // same as current note -> excluded
    manager.attachFileAsPill('a.ts');
    manager.attachFolderAsPill('src');
    expect(manager.getAttachedMentionSuffix()).toBe(' @a.ts @src/');
  });

  it('returns empty suffix when nothing is attached', () => {
    const { manager } = createManager();
    expect(manager.getAttachedMentionSuffix()).toBe('');
  });
});
```

> Add `getAttachedFolders()` passthrough to the manager if the tests need it (mirror `getAttachedFiles()`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/ui/FileContextManager.test.ts`
Expected: FAIL — `manager.attachFileAsPill is not a function`.

- [ ] **Step 3: Implement in `src/features/chat/ui/FileContext.ts`**

3a. Replace the `chipsView` callbacks (currently `onRemoveAttachment`/`onOpenFile`) in the constructor with the new `onRemove(path, kind)` shape:

```typescript
    this.chipsView = new FileChipsView(this.chipsContainerEl, {
      onRemove: (path, kind) => {
        if (kind === 'current') {
          if (path === this.currentNotePath) this.currentNotePath = null;
          this.state.detachFile(path);
        } else if (kind === 'folder') {
          this.state.detachFolder(path);
        } else {
          this.state.detachFile(path);
        }
        this.refreshChips();
      },
      onOpenFile: (filePath) => {
        void (async (): Promise<void> => {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof TFile)) {
            new Notice(`Could not open file: ${filePath}`);
            return;
          }
          try {
            await this.app.workspace.getLeaf().openFile(file);
          } catch (error) {
            new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      },
    });
```

3b. Add the `onAddContextPill` callback to the `mentionDropdown` options (alongside the existing ones), and keep `onAttachFile` (still used by external-context items):

```typescript
        onAddContextPill: (path, kind) => {
          if (kind === 'folder') this.attachFolderAsPill(path);
          else this.attachFileAsPill(path);
        },
```

3c. Add the public pill methods and the mention suffix builder (place near the old mention methods):

```typescript
  /** Adds a file pill (no text inserted). Returns false if the path can't be normalized. */
  attachFileAsPill(filePath: string): boolean {
    const normalizedPath = this.normalizePathForVault(filePath);
    if (!normalizedPath) return false;
    this.state.attachFile(normalizedPath);
    this.refreshChips();
    return true;
  }

  /** Adds a folder pill (no text inserted). Returns false if the path can't be normalized. */
  attachFolderAsPill(folderPath: string): boolean {
    const normalizedPath = this.normalizePathForVault(folderPath);
    if (!normalizedPath) return false;
    this.state.attachFolder(normalizedPath);
    this.refreshChips();
    return true;
  }

  getAttachedFolders(): Set<string> {
    return this.state.getAttachedFolders();
  }

  /**
   * Mentions to fold into the sent content for attached files/folders.
   * Excludes the current note (sent via currentNotePath). Returns '' when empty.
   */
  getAttachedMentionSuffix(): string {
    const parts: string[] = [];
    for (const file of this.state.getAttachedFiles()) {
      if (file !== this.currentNotePath) parts.push(`@${file}`);
    }
    for (const folder of this.state.getAttachedFolders()) {
      parts.push(`@${folder}/`);
    }
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
  }
```

3d. Rename `refreshCurrentNoteChip` to `refreshChips` and have it render the full tray. Update ALL callers (`setCurrentNote`, `autoAttachActiveFile`, `handleFileOpen`, `resetForNewConversation`, `resetForLoadedConversation`, `handleFileRenamed`, `handleFileDeleted`) to call `refreshChips`:

```typescript
  private refreshChips(): void {
    this.chipsView.renderPills({
      currentNote: this.currentNotePath,
      files: [...this.state.getAttachedFiles()],
      folders: [...this.state.getAttachedFolders()],
    });
    this.callbacks.onChipsChanged?.();
  }
```

3e. Add folder rename/delete sync. Extend the existing vault `rename`/`delete` event handlers to also handle `TFolder`. Import `TFolder` (`import { Notice, TFile, TFolder } from 'obsidian';`). In the constructor's event registrations:

```typescript
    this.deleteEventRef = this.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.handleFileDeleted(file.path);
      else if (file instanceof TFolder) this.handleFolderDeleted(file.path);
    });

    this.renameEventRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) this.handleFileRenamed(oldPath, file.path);
      else if (file instanceof TFolder) this.handleFolderRenamed(oldPath, file.path);
    });
```

Add the handlers:

```typescript
  private handleFolderRenamed(oldPath: string, newPath: string): void {
    const normalizedOld = this.normalizePathForVault(oldPath);
    const normalizedNew = this.normalizePathForVault(newPath);
    if (!normalizedOld || !this.state.getAttachedFolders().has(normalizedOld)) return;
    this.state.detachFolder(normalizedOld);
    if (normalizedNew) this.state.attachFolder(normalizedNew);
    this.refreshChips();
  }

  private handleFolderDeleted(deletedPath: string): void {
    const normalized = this.normalizePathForVault(deletedPath);
    if (!normalized || !this.state.getAttachedFolders().has(normalized)) return;
    this.state.detachFolder(normalized);
    this.refreshChips();
  }
```

3f. Remove the obsolete text-insertion methods `insertVaultFileMention`, `insertVaultFolderMention`, and the private `insertMentionAtCursor` (superseded by pills). Remove `onAttachFile: (filePath) => this.state.attachFile(filePath)` from the mention dropdown options ONLY if it is no longer referenced after Task 4 — keep it for now since the external-context `context-file` case still uses it (verify in Task 4).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/features/chat/ui/FileContextManager.test.ts`
Expected: PASS. (Update or remove any old tests that referenced `insertVaultFileMention`/`insertVaultFolderMention` — they are gone.)

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/FileContext.ts tests/unit/features/chat/ui/FileContextManager.test.ts
git commit -m "feat(chat): context pill add/remove, folder sync, and send mention suffix"
```

---

### Task 4: `@` dropdown selects to pills

**Files:**
- Modify: `src/shared/mention/MentionDropdownController.ts`
- Test: `tests/unit/shared/mention/MentionDropdownController.test.ts` (create if absent; otherwise add a describe block)

- [ ] **Step 1: Write the failing test**

Add to the controller's test file a case that selects a vault file and a vault folder and asserts the `@query` is stripped and `onAddContextPill` is called. Use the file's existing harness for constructing the controller and driving a selection; if none exists, model it on how `FileContextManager.test.ts` constructs the dropdown. Assert intent:

```typescript
describe('vault mention selects to pills', () => {
  it('strips the @query and emits onAddContextPill for a file', () => {
    const { controller, inputEl, onAddContextPill } = setupWithItems([
      { type: 'file', name: 'a.ts', path: 'src/a.ts' },
    ]);
    inputEl.value = 'hi @a';
    inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
    controller.showMentionDropdown('a');           // populate + render
    controller.selectFirstForTest();               // or simulate Enter/click per harness
    expect(onAddContextPill).toHaveBeenCalledWith('src/a.ts', 'file');
    expect(inputEl.value).toBe('hi ');             // @a removed
  });

  it('emits onAddContextPill with folder kind and strips the query', () => {
    const { controller, inputEl, onAddContextPill } = setupWithItems([
      { type: 'folder', name: 'src', path: 'src' },
    ]);
    inputEl.value = '@sr';
    inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
    controller.showMentionDropdown('sr');
    controller.selectFirstForTest();
    expect(onAddContextPill).toHaveBeenCalledWith('src', 'folder');
    expect(inputEl.value).toBe('');
  });
});
```

> Read `MentionDropdownController.ts` to find the real way to trigger a selection in tests (the `onItemClick`/`selectMentionItem` path, or a keyboard handler). Use whatever the harness exposes; if a test seam is missing, drive selection through the public `handleKeydown` Enter path that other tests use. Match `mockElement` APIs. Keep intent: file/folder select → `onAddContextPill(path, kind)` + `@query` removed + no `@text` inserted.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/shared/mention/MentionDropdownController.test.ts`
Expected: FAIL — `onAddContextPill` never called (current code inserts text).

- [ ] **Step 3: Implement**

In `src/shared/mention/MentionDropdownController.ts`:

3a. Add to the callbacks interface (near `onAttachFile`):

```typescript
  onAddContextPill: (path: string, kind: 'file' | 'folder') => void;
```

3b. In `selectMentionItem`, change the `case 'folder'` to strip the query and emit a pill:

```typescript
      case 'folder': {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path) ?? selectedItem.path;
        this.insertReplacement(beforeAt, '', afterCursor);
        this.callbacks.onAddContextPill(normalizedPath, 'folder');
        break;
      }
```

3c. Change the `default` case (which handles vault `file` items) to strip the query and emit a pill instead of inserting `@path`:

```typescript
      default: {
        const rawPath = selectedItem.file?.path ?? selectedItem.path;
        const normalizedPath = this.callbacks.normalizePathForVault(rawPath);
        if (normalizedPath) {
          this.insertReplacement(beforeAt, '', afterCursor);
          this.callbacks.onAddContextPill(normalizedPath, 'file');
        }
        break;
      }
```

Leave the `mcp-server`, `agent`, `agent-folder`, `context-folder`, and `context-file` cases unchanged (external-context `context-file` still uses `onAttachFile`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/shared/mention/MentionDropdownController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/mention/MentionDropdownController.ts tests/unit/shared/mention/MentionDropdownController.test.ts
git commit -m "feat(mention): vault file/folder selection adds a context pill"
```

---

### Task 5: Right-click adds pills

**Files:**
- Modify: `src/main.ts` (`addFileToActiveChat` ~233-251, `addFolderToActiveChat`)
- Test: `tests/integration/main.test.ts`

- [ ] **Step 1: Update the tests**

In `tests/integration/main.test.ts`, change the `addFileToActiveChat` and `addFolderToActiveChat` internals tests so they assert the new pill calls. Replace the assertions that expect `insertVaultFileMention`/`insertVaultFolderMention` with `attachFileAsPill`/`attachFolderAsPill`:

```typescript
  it('adds the selected file as a pill to the active chat', async () => {
    const attachFileAsPill = jest.fn().mockReturnValue(true);
    const fileContextManager = { attachFileAsPill } as any;
    // ... wire mock view/tab so activeTab.ui.fileContextManager === fileContextManager (mirror existing setup)
    const ok = await plugin.addFileToActiveChat(makeTFile('notes.md'));
    expect(attachFileAsPill).toHaveBeenCalledWith('notes.md');
    expect(ok).toBe(true);
  });

  it('adds the selected folder as a pill to the active chat', async () => {
    const attachFolderAsPill = jest.fn().mockReturnValue(true);
    const fileContextManager = { attachFolderAsPill } as any;
    // ... wire mock as above
    const ok = await plugin.addFolderToActiveChat(makeTFolder('src/providers'));
    expect(attachFolderAsPill).toHaveBeenCalledWith('src/providers');
    expect(ok).toBe(true);
  });
```

> Match the existing mock-view/tab construction in the file; reuse its `makeTFile`/`makeTFolder` (or equivalent) helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/integration/main.test.ts`
Expected: FAIL — the methods still call `insertVault*Mention`.

- [ ] **Step 3: Implement**

In `src/main.ts`, change the two methods to call the pill API:

In `addFileToActiveChat`, replace the `insertVaultFileMention` block:

```typescript
    if (!fileContextManager.attachFileAsPill(file.path)) {
      new Notice(`Could not add file to chat: ${file.path}`);
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(`Added ${file.path} to Claudian chat`);
    return true;
```

In `addFolderToActiveChat`, replace the `insertVaultFolderMention` block:

```typescript
    if (!fileContextManager.attachFolderAsPill(folder.path)) {
      new Notice(`Could not add folder to chat: ${folder.path}`);
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(`Added ${folder.path}/ to Claudian chat`);
    return true;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/integration/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/integration/main.test.ts
git commit -m "feat(chat): right-click adds context pills instead of @ text"
```

---

### Task 6: Fold pill mentions into sent content

**Files:**
- Modify: `src/features/chat/controllers/InputController.ts` (`buildTurnSubmission`, ~705-760)
- Test: `tests/unit/features/chat/controllers/InputController.test.ts` (add a focused case; create if absent)

- [ ] **Step 1: Write the failing test**

Add a test that exercises `buildTurnSubmission` with a mock `fileContextManager` that returns a mention suffix, asserting `turnRequest.text` carries the folded mentions while `displayContent` stays clean. Read the existing `InputController` test harness to construct the controller with mock deps; if a direct `buildTurnSubmission` test is impractical, drive it through the existing send entry point the suite already uses and assert on the captured `turnRequest`/`displayContent`. Intent:

```typescript
it('folds attached pill mentions into turnRequest.text but keeps displayContent clean', () => {
  const fileContextManager = makeFileContextManagerMock({
    currentNotePath: null,
    mentionSuffix: ' @a.ts @src/',
    transform: (t: string) => t, // transformContextMentions passthrough
  });
  const { displayContent, turnRequest } = buildTurnSubmissionUnderTest(
    { content: 'explain this' },
    { fileContextManager },
  );
  expect(displayContent).toBe('explain this');
  expect(turnRequest.text).toBe('explain this @a.ts @src/');
});
```

> Use the file's existing patterns to obtain a `buildTurnSubmission` result. If the method is private, test via the public submit path the suite already drives and capture the request passed to the (mocked) agent service.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/controllers/InputController.test.ts`
Expected: FAIL — `turnRequest.text` lacks the folded mentions.

- [ ] **Step 3: Implement**

In `src/features/chat/controllers/InputController.ts`, inside `buildTurnSubmission`, fold the suffix into the content before transforming. Replace the `transformedText` computation:

```typescript
    const mentionSuffix = !isCompact && fileContextManager
      ? fileContextManager.getAttachedMentionSuffix()
      : '';
    const foldedContent = options.content + mentionSuffix;
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(foldedContent)
      : options.content;
```

`displayContent` stays `options.content` (line `displayContent: options.content` is unchanged) — clean prose. `turnRequest.text` becomes `transformedText` (now includes the folded mentions). Current note continues via `currentNotePath` unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/features/chat/controllers/InputController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/InputController.ts tests/unit/features/chat/controllers/InputController.test.ts
git commit -m "feat(chat): fold context pills into sent content at send time"
```

---

### Task 7: Context card derives from `content`

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts` (`renderUserContextCard`)
- Test: `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- [ ] **Step 1: Update the test**

In `tests/unit/features/chat/rendering/MessageRenderer.test.ts`, add a case proving the card uses `content` (folded mentions) even when `displayContent` is clean prose:

```typescript
  it('derives the context card from content even when displayContent is clean prose', () => {
    const { renderer, messagesEl } = createRendererWithVault();
    renderer.addMessage({
      id: 'mc',
      role: 'user',
      content: 'explain this @notes.md @src/providers/',
      displayContent: 'explain this',
      timestamp: Date.now(),
    });
    expect(messagesEl.querySelectorAll('.claudian-context-card')).toHaveLength(1);
    expect(messagesEl.querySelectorAll('.claudian-context-card-row')).toHaveLength(2);
    // text block shows the clean prose, not the mentions
    const text = messagesEl.querySelector('.claudian-text-block')?.textContent ?? '';
    expect(text).not.toContain('@notes.md');
  });
```

> Reuse the `createRendererWithVault()` helper (added in the prior feature) that mocks `getAbstractFileByPath` → TFile/TFolder.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: FAIL — current code reads `displayContent ?? content` (clean prose → no card).

- [ ] **Step 3: Implement**

In `src/features/chat/rendering/MessageRenderer.ts`, in `renderUserContextCard`, change the text source for extraction from `msg.displayContent ?? msg.content` to `msg.content`:

```typescript
  private renderUserContextCard(contentEl: HTMLElement, msg: ChatMessage): void {
    if (msg.isRebuiltContext) return;
    const sourceText = msg.content;
    if (!sourceText) return;

    const mentions = extractVaultMentions(sourceText, (path) => {
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry instanceof TFile) return 'file';
      if (entry instanceof TFolder) return 'folder';
      return null;
    });

    renderMessageContextCard(contentEl, mentions, {
      onOpenFile: (path) => {
        // Open in a tab so clicking a context reference doesn't replace the active editor.
        void this.app.workspace.openLinkText(path, '', 'tab');
      },
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: PASS (including the prior card tests, which set `content` with mentions).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts
git commit -m "feat(chat): derive context card from message content"
```

---

### Task 8: Pill tray styling

**Files:**
- Modify: `src/style/features/file-context.css`

- [ ] **Step 1: Add styles**

Append to `src/style/features/file-context.css` (already registered in `index.css`) rules for the new pill modifiers, reusing the existing `.claudian-file-chip` base:

```css
.claudian-file-indicator {
  flex-wrap: wrap;
  gap: 4px;
}

.claudian-file-chip--folder .claudian-file-chip-icon {
  color: var(--text-accent);
}

.claudian-file-chip--current {
  border-color: var(--interactive-accent);
}

.claudian-file-chip--folder {
  cursor: default;
}

.claudian-file-chip--file,
.claudian-file-chip--current {
  cursor: pointer;
}
```

> Read the existing `.claudian-file-chip` rules first; only add what's needed (wrap layout for multiple pills, the new modifier accents). Don't duplicate existing base chip styling.

- [ ] **Step 2: Verify the CSS build**

Run: `npm run build:css`
Expected: completes without error.

- [ ] **Step 3: Commit**

```bash
git add src/style/features/file-context.css
git commit -m "style(chat): context pill tray (folder/current modifiers, wrap)"
```

---

### Task 9: Full verification

**Files:** none (gate task)

- [ ] **Step 1: Typecheck** — `npm run typecheck` → no errors.
- [ ] **Step 2: Lint** — `npm run lint` → 0 errors, 0 warnings.
- [ ] **Step 3: Tests** — `npm run test` → all suites pass.
- [ ] **Step 4: Build** — `npm run build` → builds `main.js` + `styles.css`, copies to the `claudian-cursor` plugin folder.
- [ ] **Step 5: Manual smoke** (Obsidian, reload `claudian-cursor`):
  1. Type `@`, pick a file → a pill appears, no `@text` in the textarea.
  2. Right-click a folder → "Add folder to Claudian chat" → folder pill appears.
  3. Open a note → current-note pill appears; if you also `@`-add it, only one pill shows.
  4. Remove a pill via ×.
  5. Send a message with prose + pills → thread shows clean prose + the "Attached context" card listing the pills; agent reads the referenced files/folders.
- [ ] **Step 6: Commit any fixups** (skip if none):
```bash
git add -A
git commit -m "chore: verification fixups for composer context pills"
```

---

## Self-Review

**Spec coverage:**
- No `@` text in textarea → Tasks 3 (remove insert methods), 4 (dropdown → pill), 5 (right-click → pill). ✓
- Pill tray above textarea (current note + files + folders) → Task 2 + Task 3 (`refreshChips`). ✓
- Current note unified, deduped, keeps `currentNotePath` channel → Task 2 (dedupe), Task 3 (`getAttachedMentionSuffix` excludes current note), Task 6 (not folded). ✓
- S1 send folding (`content` carries mentions, `displayContent` clean) → Task 6. ✓
- In-thread card from `content` → Task 7. ✓
- Folder state + rename/delete sync + reset → Tasks 1, 3. ✓
- Scope (vault file/folder only; mcp/agent/external-context unchanged) → Task 4 leaves those cases alone. ✓
- Styling → Task 8.

**Placeholder scan:** No TBD/TODO. Harness-dependent tests (dropdown, InputController) include explicit fallback instructions and concrete intent + assertions rather than vague references.

**Type consistency:** `attachFolder`/`detachFolder`/`getAttachedFolders`/`setAttachedFolders` (Task 1) used consistently in Task 3. `renderPills({ currentNote, files, folders })` + `onRemove(path, kind)` defined in Task 2, consumed in Task 3. `onAddContextPill(path, kind)` defined in Task 4, wired in Task 3. `attachFileAsPill`/`attachFolderAsPill`/`getAttachedMentionSuffix` defined in Task 3, used in Tasks 5/6. CSS classes in Task 8 (`claudian-file-chip--folder/--current/--file`) match those emitted in Task 2.
