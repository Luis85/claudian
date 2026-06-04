---
title: Drag and drop into chat context — implementation plan
date: 2026-06-04
status: ready-to-execute
scope: features/chat
relations:
  - "[[docs/superpowers/specs/2026-06-04-chat-drag-drop-context-design.md]]"
  - "[[docs/superpowers/plans/2026-06-04-paste-image-vault-persist.md]]"
  - "[[docs/issues/Drag and drop of files or folders into the chat to add to context.md]]"
tags:
  - chat
  - file-context
  - inline-edit
  - plan
---

# Drag and Drop into Chat Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag files and folders from the Obsidian File Explorer or the OS file system into the chat input area to attach them as context pills, with parity to the existing right-click "Add file/folder to Claudian chat" menu.

**Architecture:** A new `ChatDropController` owns the drop zone on `.claudian-input-wrapper`, takes over the listeners that `ImageContextManager` used to register, classifies dropped items into vault files, vault folders, OS images, external-context files, or rejections, and routes each route through the existing `FileContextManager` / `ImageContextManager` APIs plus a small new helper for external-context mentions. One shared overlay with an adaptive label communicates the routing target.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest unit + integration tests, the project's existing `@test/helpers/mockElement` shim.

**Reference spec:** [[docs/superpowers/specs/2026-06-04-chat-drag-drop-context-design.md]]

---

## Concurrent Plan: Paste-Image Vault Persistence

A sibling plan, [[docs/superpowers/plans/2026-06-04-paste-image-vault-persist.md]], runs in parallel. It writes pasted clipboard images to the vault on send and refactors `MessageRenderer` to prefer vault paths. This plan does not touch any of its files, and vice versa:

| File | Paste-image plan | This plan |
|------|------------------|-----------|
| `src/core/types/chat.ts` | adds `path?: string` to `ImageAttachment` | untouched |
| `src/features/chat/services/persistPastedImages.ts` | creates | untouched |
| `src/features/chat/controllers/InputController.ts` | inserts `await persistPastedImages` near line 321 | untouched |
| `src/features/chat/rendering/MessageRenderer.ts` | adds `resolveImageSrc`, refactors render and `showFullImage` | untouched |
| `src/features/chat/ui/ImageContext.ts` | untouched | strips `setupDragAndDrop` and `dropOverlay` (Task 9) |
| `tests/unit/features/chat/ui/ImageContext.test.ts` | untouched | strips drop tests (Task 9) |
| `src/features/chat/controllers/{ChatDropController,dropPayloadDetection,osPathClassification}.ts` | n/a | creates (Tasks 2, 3, 5–7) |
| `src/features/chat/tabs/{tabUi,types}.ts` | n/a | wires controller (Task 8) |
| `src/i18n/types.ts` and `src/i18n/locales/*.json` | n/a | adds `chat.drop.*` keys (Task 1) |

**Semantic compatibility:**
- The paste-image plan operates on `imageContextManager.getAttachedImages()` at send time. After Task 9 strips drop handling from `ImageContextManager`, `ChatDropController` keeps feeding images through `imageContextManager.addImageFromFile(file, 'drop')`, so attached-image state — and the paste-image persistence hook — is unchanged.
- `ImageAttachment.source` retains `'paste' | 'drop' | 'file'`. This plan continues to write `'drop'` from `ChatDropController`. The paste-image plan never narrows that union.
- `ImageAttachment.path` (added by the paste-image plan) is irrelevant at drop time. `addImageFromFile` builds the attachment without `path`; the paste-image plan stamps `path` later, at send time.
- If the paste-image plan ships its `setImageSrc` / `renderMessageImages` changes first, this plan still compiles — `MessageRenderer` is never imported by `ChatDropController`. If this plan ships first, the paste-image plan's renderer changes still apply cleanly because no overlapping lines exist.

If a merge conflict ever surfaces, it would land in this plan's Task 9 deletions inside `ImageContext.ts` against an unchanged paste-image baseline — a clean three-way merge, not a semantic conflict.

---

## File Structure

### Created

| Path | Responsibility |
|------|---------------|
| `src/features/chat/controllers/ChatDropController.ts` | Owns drop listeners, overlay, payload routing for one tab. |
| `src/features/chat/controllers/dropPayloadDetection.ts` | Pure function `detectPayload(dataTransfer, dragManager)` returning a `DroppedPayload`. |
| `src/features/chat/controllers/osPathClassification.ts` | Pure function `classifyOsPath(absolutePath, vaultPath, externalRoots)` returning a classification kind. |
| `tests/unit/features/chat/controllers/dropPayloadDetection.test.ts` | Unit tests for detection. |
| `tests/unit/features/chat/controllers/osPathClassification.test.ts` | Unit tests for classification, including `itPosix` / `itWin32`. |
| `tests/unit/features/chat/controllers/ChatDropController.test.ts` | Unit tests for controller wiring and routing. |
| `tests/integration/features/chat/dropFlow.integration.test.ts` | End-to-end drop on a booted view, asserting pill chips render. |

### Modified

| Path | Change |
|------|--------|
| `src/features/chat/ui/FileContext.ts` | Add `attachExternalContextMention(absolutePath: string): boolean`. |
| `src/features/chat/ui/ImageContext.ts` | Remove `setupDragAndDrop`, `dropOverlay` field, and `handleDragEnter` / `handleDragOver` / `handleDragLeave` / `handleDrop` methods. Keep `setupPasteHandler`, `addImageFromFile`, `isImageFile`. Make `addImageFromFile` callable from outside the class (already public-ish, verify). |
| `src/features/chat/tabs/tabUi.ts` | Instantiate `ChatDropController` after `FileContextManager` and `ImageContextManager` in `initializeContextManagers`. Tear down in tab destroy. |
| `src/features/chat/tabs/types.ts` | Add `chatDropController?: ChatDropController` to the tab UI slot. |
| `src/i18n/types.ts` | Add new `chat.drop.*` translation keys to the `TranslationKey` union. |
| `src/i18n/locales/en.json` | Add `chat.drop.*` strings. |
| `src/i18n/locales/de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json` | Add `chat.drop.*` keys with the English string copied verbatim as a placeholder fallback. |
| `tests/unit/features/chat/ui/ImageContext.test.ts` | Remove tests that exercise drag/drop on `ImageContextManager`; keep image-attach + paste tests. |

---

## Conventions

- Run after every task: `npm run typecheck && npm run lint && npm run test`. Run `npm run build` at the final task.
- Commit after each task with the project's Conventional Commits style. Use `feat`, `test`, `refactor`, `chore`.
- Sentence case in all user-visible strings (per MEMORY entry "Lint clean").
- No `console.*` calls in production code.
- New files start with their existing project header comment style (see neighbouring files for the pattern; one-line `/** Claudian - <topic> */` JSDoc).

---

## Task 1: Add `chat.drop.*` i18n keys

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`

- [ ] **Step 1: Add union members to `src/i18n/types.ts`**

Insert after the existing `chat.context.*` block:

```ts
  | 'chat.drop.image'
  | 'chat.drop.fileContext'
  | 'chat.drop.folderContext'
  | 'chat.drop.osContext'
  | 'chat.drop.mixed'
  | 'chat.drop.batchAdded'
  | 'chat.drop.batchSkipped'
  | 'chat.drop.externalFolderUnsupported'
  | 'chat.drop.outsideContext'
```

- [ ] **Step 2: Add English strings to `src/i18n/locales/en.json`**

Inside the `"chat"` object, after the closing `}` of `"context"`:

```json
    "drop": {
      "image": "Drop image",
      "fileContext": "Drop into context",
      "folderContext": "Drop folder into context",
      "osContext": "Drop file or folder into context",
      "mixed": "Drop into chat",
      "batchAdded": "Added {count} to context",
      "batchSkipped": "Skipped {count}: outside vault or external context",
      "externalFolderUnsupported": "Folders outside the vault aren't supported as context yet",
      "outsideContext": "{path} is outside the vault and any configured external context"
    },
```

- [ ] **Step 3: Mirror the block into the other 9 locale JSONs**

For each of `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`, insert the same `"drop": { ... }` block with the English values copied verbatim. The codebase already ships English placeholders for unmigrated keys; this matches that pattern.

- [ ] **Step 4: Verify build and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/types.ts src/i18n/locales
git commit -m "feat(i18n): add chat.drop.* translation keys"
```

---

## Task 2: `classifyOsPath` pure classifier

**Files:**
- Create: `src/features/chat/controllers/osPathClassification.ts`
- Test: `tests/unit/features/chat/controllers/osPathClassification.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/features/chat/controllers/osPathClassification.test.ts`:

```ts
import { itPosix, itWin32 } from '@test/helpers/platform';

import { classifyOsPath } from '@/features/chat/controllers/osPathClassification';

describe('classifyOsPath', () => {
  itPosix('classifies a file under the vault as vault-file', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/a.md',
      '/Users/me/vault',
      [],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });

  itPosix('classifies a folder under the vault as vault-folder', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/sub',
      '/Users/me/vault',
      [],
      { isDirectory: true }
    );
    expect(result).toEqual({ kind: 'vault-folder', relPath: 'notes/sub' });
  });

  itPosix('classifies a file under an external root as external-file', () => {
    const result = classifyOsPath(
      '/Users/me/projects/foo/src/index.ts',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({
      kind: 'external-file',
      contextRoot: '/Users/me/projects/foo',
    });
  });

  itPosix('classifies a folder under an external root as external-folder', () => {
    const result = classifyOsPath(
      '/Users/me/projects/foo/src',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: true }
    );
    expect(result).toEqual({
      kind: 'external-folder',
      contextRoot: '/Users/me/projects/foo',
    });
  });

  itPosix('rejects a path outside vault and external roots', () => {
    const result = classifyOsPath(
      '/tmp/elsewhere/x.md',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'rejected' });
  });

  itWin32('classifies a Windows vault file with mixed slashes', () => {
    const result = classifyOsPath(
      'D:\\Projects\\vault\\notes\\a.md',
      'D:\\Projects\\vault',
      [],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });

  itWin32('classifies a Windows external file', () => {
    const result = classifyOsPath(
      'C:\\Work\\foo\\src\\index.ts',
      'D:\\Projects\\vault',
      ['C:\\Work\\foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({
      kind: 'external-file',
      contextRoot: 'C:\\Work\\foo',
    });
  });

  itPosix('prefers vault over external root when both match', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/a.md',
      '/Users/me/vault',
      ['/Users/me'],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- osPathClassification`
Expected: FAIL with module-not-found for `@/features/chat/controllers/osPathClassification`.

- [ ] **Step 3: Implement classifier**

Create `src/features/chat/controllers/osPathClassification.ts`:

```ts
/**
 * Claudian - OS path classification for drag-and-drop into chat context.
 *
 * Pure function. Given an absolute OS path plus the vault root and configured
 * external roots, decide whether the path belongs to the vault, to an external
 * context root, or to neither.
 */

import { normalizePathForComparison } from '@/utils/externalContext';

export type OsPathClassification =
  | { kind: 'vault-file'; relPath: string }
  | { kind: 'vault-folder'; relPath: string }
  | { kind: 'external-file'; contextRoot: string }
  | { kind: 'external-folder'; contextRoot: string }
  | { kind: 'rejected' };

export interface OsPathInfo {
  isDirectory: boolean;
}

export function classifyOsPath(
  absolutePath: string,
  vaultPath: string,
  externalRoots: string[],
  info: OsPathInfo
): OsPathClassification {
  const normalizedAbs = normalizePathForComparison(absolutePath);
  const normalizedVault = normalizePathForComparison(vaultPath);

  if (isUnder(normalizedAbs, normalizedVault)) {
    const relPath = stripPrefix(normalizedAbs, normalizedVault);
    return info.isDirectory
      ? { kind: 'vault-folder', relPath }
      : { kind: 'vault-file', relPath };
  }

  for (const root of externalRoots) {
    const normalizedRoot = normalizePathForComparison(root);
    if (isUnder(normalizedAbs, normalizedRoot)) {
      return info.isDirectory
        ? { kind: 'external-folder', contextRoot: root }
        : { kind: 'external-file', contextRoot: root };
    }
  }

  return { kind: 'rejected' };
}

function isUnder(normalizedChild: string, normalizedRoot: string): boolean {
  if (!normalizedRoot) return false;
  if (normalizedChild === normalizedRoot) return true;
  return normalizedChild.startsWith(normalizedRoot + '/');
}

function stripPrefix(normalizedChild: string, normalizedRoot: string): string {
  if (normalizedChild === normalizedRoot) return '';
  return normalizedChild.slice(normalizedRoot.length + 1);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- osPathClassification`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/osPathClassification.ts tests/unit/features/chat/controllers/osPathClassification.test.ts
git commit -m "feat(chat): classify OS drop paths as vault/external/rejected"
```

---

## Task 3: `detectPayload` pure detector

**Files:**
- Create: `src/features/chat/controllers/dropPayloadDetection.ts`
- Test: `tests/unit/features/chat/controllers/dropPayloadDetection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/features/chat/controllers/dropPayloadDetection.test.ts`:

```ts
import { TFile, TFolder } from 'obsidian';

import { detectPayload } from '@/features/chat/controllers/dropPayloadDetection';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeFile(path: string, type = 'application/octet-stream', size = 100): any {
  return { name: path.split(/[\\/]/).pop(), type, size, path };
}

function makeDataTransfer(opts: {
  types?: string[];
  files?: any[];
  items?: any[];
} = {}): any {
  return {
    types: opts.types ?? [],
    files: opts.files ?? [],
    items: opts.items ?? [],
  };
}

describe('detectPayload', () => {
  it('returns empty payload when no relevant data', () => {
    const payload = detectPayload(makeDataTransfer(), null);
    expect(payload).toEqual({
      vaultFiles: [],
      vaultFolders: [],
      osImageFiles: [],
      osFiles: [],
      osFolders: [],
      unknown: 0,
    });
  });

  it('routes Obsidian internal TFile drag to vaultFiles', () => {
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    const dragManager = { draggable: { type: 'file', file: tFile } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFiles).toEqual([tFile]);
    expect(payload.osImageFiles).toHaveLength(0);
  });

  it('routes Obsidian internal TFolder drag to vaultFolders', () => {
    const tFolder = Object.assign(new TFolder(), { path: 'notes/sub' });
    const dragManager = { draggable: { type: 'folder', file: tFolder } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFolders).toEqual([tFolder]);
  });

  it('routes Obsidian internal multi-file drag to vaultFiles', () => {
    const f1 = Object.assign(new TFile(), { path: 'a.md' });
    const f2 = Object.assign(new TFile(), { path: 'b.md' });
    const dragManager = { draggable: { type: 'files', files: [f1, f2] } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFiles).toEqual([f1, f2]);
  });

  it('routes OS image files to osImageFiles', () => {
    const file = makeFile('/tmp/x.png', 'image/png');
    const dt = makeDataTransfer({ types: ['Files'], files: [file] });
    const payload = detectPayload(dt, null);
    expect(payload.osImageFiles).toEqual([file]);
    expect(payload.osFiles).toHaveLength(0);
  });

  it('routes OS non-image files to osFiles', () => {
    const file = makeFile('/tmp/x.md', 'text/markdown');
    const dt = makeDataTransfer({ types: ['Files'], files: [file] });
    const payload = detectPayload(dt, null);
    expect(payload.osFiles).toEqual([file]);
    expect(payload.osImageFiles).toHaveLength(0);
  });

  it('routes OS folders (webkitGetAsEntry isDirectory) to osFolders', () => {
    const file = makeFile('/tmp/folder', '', 0);
    const items = [{
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      getAsFile: () => file,
    }];
    const dt = makeDataTransfer({ types: ['Files'], files: [file], items });
    const payload = detectPayload(dt, null);
    expect(payload.osFolders).toEqual([{ path: '/tmp/folder' }]);
    expect(payload.osFiles).toHaveLength(0);
  });

  it('prefers internal drag when both internal and OS markers are present', () => {
    const tFile = Object.assign(new TFile(), { path: 'a.md' });
    const dragManager = { draggable: { type: 'file', file: tFile } };
    const dt = makeDataTransfer({
      types: ['Files'],
      files: [makeFile('/tmp/x.png', 'image/png')],
    });
    const payload = detectPayload(dt, dragManager);
    expect(payload.vaultFiles).toEqual([tFile]);
    expect(payload.osImageFiles).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- dropPayloadDetection`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement detector**

Create `src/features/chat/controllers/dropPayloadDetection.ts`:

```ts
/**
 * Claudian - Drop payload detection for chat drag-and-drop.
 *
 * Pure function. Given a DataTransfer-like object and the Obsidian app
 * dragManager, classify the drop into Obsidian-internal vault items, OS image
 * files, OS non-image files, and OS folders. Caller is responsible for the
 * vault-vs-external classification of OS paths (see classifyOsPath).
 */

import type { TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

export interface DroppedPayload {
  vaultFiles: TFile[];
  vaultFolders: TFolder[];
  osImageFiles: File[];
  osFiles: File[];
  osFolders: { path: string }[];
  unknown: number;
}

export interface DragManagerLike {
  draggable?: ObsidianDraggable | null;
}

export interface ObsidianDraggable {
  type: 'file' | 'files' | 'folder';
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

export interface DataTransferLike {
  types: readonly string[];
  files: ArrayLike<File>;
  items?: ArrayLike<DataTransferItemLike>;
}

export interface DataTransferItemLike {
  kind: string;
  type: string;
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null;
  getAsFile?: () => File | null;
}

export function detectPayload(
  dataTransfer: DataTransferLike,
  dragManager: DragManagerLike | null
): DroppedPayload {
  const payload: DroppedPayload = {
    vaultFiles: [],
    vaultFolders: [],
    osImageFiles: [],
    osFiles: [],
    osFolders: [],
    unknown: 0,
  };

  const internal = consumeInternalDrag(dragManager);
  if (internal.consumed) {
    payload.vaultFiles.push(...internal.files);
    payload.vaultFolders.push(...internal.folders);
    return payload;
  }

  if (!Array.from(dataTransfer.types).includes('Files')) {
    return payload;
  }

  const directoryPaths = collectDirectoryPaths(dataTransfer.items);

  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    const filePath = getFilePath(file);

    if (filePath && directoryPaths.has(filePath)) {
      payload.osFolders.push({ path: filePath });
      continue;
    }

    if (file.type.startsWith('image/')) {
      payload.osImageFiles.push(file);
      continue;
    }

    payload.osFiles.push(file);
  }

  return payload;
}

function consumeInternalDrag(dragManager: DragManagerLike | null): {
  consumed: boolean;
  files: TFile[];
  folders: TFolder[];
} {
  const draggable = dragManager?.draggable;
  if (!draggable) return { consumed: false, files: [], folders: [] };

  const files: TFile[] = [];
  const folders: TFolder[] = [];

  if (draggable.type === 'file' && draggable.file instanceof TFile) {
    files.push(draggable.file);
  } else if (draggable.type === 'folder' && draggable.file instanceof TFolder) {
    folders.push(draggable.file);
  } else if (draggable.type === 'files' && Array.isArray(draggable.files)) {
    for (const item of draggable.files) {
      if (item instanceof TFile) files.push(item);
      else if (item instanceof TFolder) folders.push(item);
    }
  }

  if (files.length === 0 && folders.length === 0) {
    return { consumed: false, files: [], folders: [] };
  }
  return { consumed: true, files, folders };
}

function collectDirectoryPaths(
  items: ArrayLike<DataTransferItemLike> | undefined
): Set<string> {
  const paths = new Set<string>();
  if (!items) return paths;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file' || !item.webkitGetAsEntry) continue;
    const entry = item.webkitGetAsEntry();
    if (!entry?.isDirectory) continue;
    const file = item.getAsFile?.();
    const filePath = file ? getFilePath(file) : null;
    if (filePath) paths.add(filePath);
  }
  return paths;
}

function getFilePath(file: File): string | null {
  const electronPath = (file as unknown as { path?: string }).path;
  return typeof electronPath === 'string' && electronPath.length > 0 ? electronPath : null;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- dropPayloadDetection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/dropPayloadDetection.ts tests/unit/features/chat/controllers/dropPayloadDetection.test.ts
git commit -m "feat(chat): detect drop payload for vault and OS sources"
```

---

## Task 4: `FileContextManager.attachExternalContextMention`

**Files:**
- Modify: `src/features/chat/ui/FileContext.ts`
- Modify: `tests/unit/features/chat/ui/FileContextManager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/chat/ui/FileContextManager.test.ts` inside the existing top-level `describe('FileContextManager', ...)`:

```ts
  describe('attachExternalContextMention', () => {
    it('returns false when the absolute path is not under any external root', () => {
      // Assumes the existing fixture mounts a manager with externalContexts = ['/ext/foo'].
      const ok = manager.attachExternalContextMention('/somewhere/else/x.md');
      expect(ok).toBe(false);
    });

    it('inserts @displayName at the caret and tracks the absolute path', () => {
      // externalContexts fixture: ['/ext/foo']
      inputEl.value = 'hello ';
      inputEl.selectionStart = inputEl.value.length;
      inputEl.selectionEnd = inputEl.value.length;
      const ok = manager.attachExternalContextMention('/ext/foo/sub/x.md');
      expect(ok).toBe(true);
      expect(inputEl.value).toContain('@foo/sub/x.md');
      expect(manager.getAttachedFiles().has('/ext/foo/sub/x.md')).toBe(true);
    });
  });
```

(The existing fixture in the file already creates `inputEl` as a `createMockEl('textarea')`. If `externalContexts` isn't already provided in the fixture, extend `createMockCallbacks()` to include `getExternalContexts: () => ['/ext/foo']`.)

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- FileContextManager`
Expected: FAIL with `manager.attachExternalContextMention is not a function`.

- [ ] **Step 3: Implement the method**

In `src/features/chat/ui/FileContext.ts`, import what's needed at the top:

```ts
import { buildExternalContextDisplayEntries } from '../../../utils/externalContext';
```

Add this method inside the `FileContextManager` class, near `attachFileAsPill`:

```ts
  /**
   * Attaches an OS file that lives inside a configured external context root.
   * Inserts `@displayName ` at the textarea caret and tracks the absolute path
   * in the same state slot the @-mention dropdown uses for external files.
   * Returns false when no external root contains the path.
   */
  attachExternalContextMention(absolutePath: string): boolean {
    const roots = this.callbacks.getExternalContexts?.() ?? [];
    if (roots.length === 0) return false;

    const entries = buildExternalContextDisplayEntries(roots);
    const normalizedAbs = absolutePath.replace(/\\/g, '/');
    const match = entries
      .map((entry) => ({
        entry,
        normalizedRoot: entry.contextRoot.replace(/\\/g, '/'),
      }))
      .find(({ normalizedRoot }) => normalizedAbs.startsWith(normalizedRoot + '/'));

    if (!match) return false;

    const relative = normalizedAbs.slice(match.normalizedRoot.length + 1);
    const displayName = `@${match.entry.displayName}/${relative}`;

    insertAtCaret(this.inputEl, `${displayName} `);
    this.state.attachFile(absolutePath);
    this.refreshChips();
    return true;
  }
```

Add a small helper at the bottom of the file (kept private to the module):

```ts
function insertAtCaret(input: HTMLTextAreaElement, text: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = `${before}${text}${after}`;
  const caret = before.length + text.length;
  input.selectionStart = caret;
  input.selectionEnd = caret;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- FileContextManager`
Expected: PASS for the new tests; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/FileContext.ts tests/unit/features/chat/ui/FileContextManager.test.ts
git commit -m "feat(chat): attach OS files under external context roots via @ mention"
```

---

## Task 5: `ChatDropController` scaffolding (init, overlay, destroy)

**Files:**
- Create: `src/features/chat/controllers/ChatDropController.ts`
- Create: `tests/unit/features/chat/controllers/ChatDropController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/controllers/ChatDropController.test.ts`:

```ts
import { createMockEl } from '@test/helpers/mockElement';

import { ChatDropController } from '@/features/chat/controllers/ChatDropController';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeDeps(overrides: Partial<any> = {}) {
  return {
    fileContext: {
      attachFileAsPill: jest.fn(() => true),
      attachFolderAsPill: jest.fn(() => true),
      attachExternalContextMention: jest.fn(() => true),
    },
    imageContext: {
      addImageFromFile: jest.fn(async () => true),
    },
    getVaultPath: () => '/Users/me/vault',
    getExternalContexts: () => [],
    getDragManager: () => null,
    inputEl: createMockEl('textarea'),
    ...overrides,
  };
}

describe('ChatDropController — scaffolding', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('creates a drop overlay inside the input wrapper on init', () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    expect(inputWrapperEl.children.length).toBeGreaterThan(0);
    const overlay = inputWrapperEl.children.find(
      (c: any) => c.hasClass?.('claudian-drop-overlay')
    );
    expect(overlay).toBeDefined();
  });

  it('removes its overlay and listeners on destroy', () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    controller.destroy();
    const overlay = inputWrapperEl.children.find(
      (c: any) => c.hasClass?.('claudian-drop-overlay')
    );
    expect(overlay).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- ChatDropController`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement scaffold**

Create `src/features/chat/controllers/ChatDropController.ts`:

```ts
/**
 * Claudian - Chat drop controller.
 *
 * Owns the drag-and-drop lifecycle for one chat tab's input wrapper. Routes
 * dropped vault files, vault folders, OS images, and external-context files
 * through the existing chat services.
 */

import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { DragManagerLike } from './dropPayloadDetection';

export interface ChatDropDeps {
  fileContext: Pick<FileContextManager,
    'attachFileAsPill' | 'attachFolderAsPill' | 'attachExternalContextMention'>;
  imageContext: Pick<ImageContextManager, 'addImageFromFile'>;
  getVaultPath: () => string;
  getExternalContexts: () => string[];
  getDragManager: () => DragManagerLike | null;
  inputEl: HTMLTextAreaElement;
}

export class ChatDropController {
  private containerEl: HTMLElement;
  private deps: ChatDropDeps;
  private inputWrapperEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private overlayLabelEl: HTMLElement | null = null;
  private listeners: Array<{ type: string; handler: (e: Event) => void }> = [];

  constructor(containerEl: HTMLElement, deps: ChatDropDeps) {
    this.containerEl = containerEl;
    this.deps = deps;
  }

  init(): void {
    const wrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    this.inputWrapperEl = wrapper;

    this.overlayEl = wrapper.createDiv({ cls: 'claudian-drop-overlay' });
    const content = this.overlayEl.createDiv({ cls: 'claudian-drop-content' });
    this.overlayLabelEl = content.createSpan({ text: '' });
  }

  destroy(): void {
    if (this.inputWrapperEl) {
      for (const { type, handler } of this.listeners) {
        this.inputWrapperEl.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
    this.overlayLabelEl = null;
    this.inputWrapperEl = null;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- ChatDropController`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/ChatDropController.ts tests/unit/features/chat/controllers/ChatDropController.test.ts
git commit -m "feat(chat): scaffold ChatDropController with overlay lifecycle"
```

---

## Task 6: Overlay label routing on dragenter

**Files:**
- Modify: `src/features/chat/controllers/ChatDropController.ts`
- Modify: `tests/unit/features/chat/controllers/ChatDropController.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('ChatDropController — scaffolding', ...)` (or a new sibling `describe`):

```ts
import { TFile } from 'obsidian';

function dispatchDragEnter(target: any, opts: { types?: string[]; dataTransfer?: any } = {}): any {
  const dataTransfer = opts.dataTransfer ?? {
    types: opts.types ?? ['Files'],
    files: [],
    items: [],
  };
  const event: any = {
    type: 'dragenter',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
    clientX: 100,
    clientY: 100,
  };
  target.dispatchEvent(event);
  return event;
}

describe('ChatDropController — overlay label', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('shows "Drop image" label when only OS image MIME is present', () => {
    const controller = new ChatDropController(containerEl, makeDeps());
    controller.init();
    dispatchDragEnter(inputWrapperEl, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'x.png', type: 'image/png', size: 10 }],
        items: [],
      },
    });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.hasClass('visible')).toBe(true);
    expect(overlay?.textContent).toContain('Drop image');
  });

  it('shows "Drop into context" when an Obsidian internal file drag is active', () => {
    const tFile = Object.assign(new TFile(), { path: 'a.md' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'file', file: tFile } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    dispatchDragEnter(inputWrapperEl, { types: [] });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.textContent).toContain('Drop into context');
  });

  it('hides overlay on dragleave outside wrapper rect', () => {
    const controller = new ChatDropController(containerEl, makeDeps());
    controller.init();
    dispatchDragEnter(inputWrapperEl, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'x.png', type: 'image/png', size: 10 }],
        items: [],
      },
    });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.hasClass('visible')).toBe(true);

    // Simulate dragleave outside the wrapper rect
    inputWrapperEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 50 });
    inputWrapperEl.dispatchEvent({
      type: 'dragleave',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      clientX: 100,
      clientY: 100,
    });
    expect(overlay?.hasClass('visible')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- ChatDropController`
Expected: FAIL — overlay never shows, no listeners installed.

- [ ] **Step 3: Implement listeners and label routing**

In `src/features/chat/controllers/ChatDropController.ts`, extend `init()` and add private methods:

```ts
import { t } from '@/i18n/i18n';
import type { TranslationKey } from '@/i18n/types';

import { detectPayload, type DroppedPayload } from './dropPayloadDetection';

// inside the class, replace init() with:
  init(): void {
    const wrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    this.inputWrapperEl = wrapper;

    this.overlayEl = wrapper.createDiv({ cls: 'claudian-drop-overlay' });
    const content = this.overlayEl.createDiv({ cls: 'claudian-drop-content' });
    this.overlayLabelEl = content.createSpan({ text: '' });

    this.addListener('dragenter', (e) => this.handleDragEnter(e as DragEvent));
    this.addListener('dragover', (e) => this.handleDragOver(e as DragEvent));
    this.addListener('dragleave', (e) => this.handleDragLeave(e as DragEvent));
    this.addListener('drop', (e) => {
      void this.handleDrop(e as DragEvent);
    });
  }

  private addListener(type: string, handler: (e: Event) => void): void {
    this.inputWrapperEl?.addEventListener(type, handler);
    this.listeners.push({ type, handler });
  }

  private handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.overlayEl || !this.overlayLabelEl) return;

    const payload = this.peekPayload(e.dataTransfer as DataTransfer | null);
    const labelKey = pickOverlayLabel(payload);
    if (!labelKey) return;

    this.overlayLabelEl.setText(t(labelKey));
    this.overlayEl.addClass('visible');
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.inputWrapperEl || !this.overlayEl) return;
    const rect = this.inputWrapperEl.getBoundingClientRect();
    if (
      e.clientX <= rect.left || e.clientX >= rect.right ||
      e.clientY <= rect.top || e.clientY >= rect.bottom
    ) {
      this.overlayEl.removeClass('visible');
    }
  }

  private peekPayload(dataTransfer: DataTransfer | null): DroppedPayload {
    if (!dataTransfer) {
      return {
        vaultFiles: [], vaultFolders: [],
        osImageFiles: [], osFiles: [], osFolders: [],
        unknown: 0,
      };
    }
    return detectPayload(dataTransfer, this.deps.getDragManager());
  }

  // drop handler comes in Task 7
  private async handleDrop(_e: DragEvent): Promise<void> {
    // implemented in Task 7
  }
```

Add module-level helper:

```ts
function pickOverlayLabel(payload: DroppedPayload): TranslationKey | null {
  const hasVaultFile = payload.vaultFiles.length > 0;
  const hasVaultFolder = payload.vaultFolders.length > 0;
  const hasOsImage = payload.osImageFiles.length > 0;
  const hasOsFile = payload.osFiles.length > 0;
  const hasOsFolder = payload.osFolders.length > 0;

  const pathish = hasVaultFile || hasVaultFolder || hasOsFile || hasOsFolder;
  if (hasOsImage && pathish) return 'chat.drop.mixed';
  if (hasOsImage) return 'chat.drop.image';
  if (hasVaultFolder && !hasVaultFile) return 'chat.drop.folderContext';
  if (hasVaultFile) return 'chat.drop.fileContext';
  if (hasOsFile || hasOsFolder) return 'chat.drop.osContext';
  return null;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- ChatDropController`
Expected: PASS for all overlay-label tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/ChatDropController.ts tests/unit/features/chat/controllers/ChatDropController.test.ts
git commit -m "feat(chat): adaptive drop overlay label by payload signature"
```

---

## Task 7: Drop routing — vault files, vault folders, OS images, external files

**Files:**
- Modify: `src/features/chat/controllers/ChatDropController.ts`
- Modify: `tests/unit/features/chat/controllers/ChatDropController.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe('ChatDropController — drop routing', ...)` to the test file:

```ts
import { Notice, TFile, TFolder } from 'obsidian';

function dispatchDrop(target: any, dataTransfer: any): any {
  const event: any = {
    type: 'drop',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
  };
  target.dispatchEvent(event);
  return event;
}

describe('ChatDropController — drop routing', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    jest.clearAllMocks();
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('routes Obsidian internal TFile drag to attachFileAsPill', async () => {
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'file', file: tFile } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFileAsPill).toHaveBeenCalledWith('notes/a.md');
  });

  it('routes Obsidian internal TFolder drag to attachFolderAsPill', async () => {
    const tFolder = Object.assign(new TFolder(), { path: 'notes/sub' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'folder', file: tFolder } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFolderAsPill).toHaveBeenCalledWith('notes/sub');
  });

  it('routes OS image MIME to imageContext.addImageFromFile', async () => {
    const file = { name: 'x.png', type: 'image/png', size: 10, path: '/tmp/x.png' };
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.imageContext.addImageFromFile).toHaveBeenCalledWith(file, 'drop');
  });

  it('routes OS file under vault to attachFileAsPill with relative path', async () => {
    const file = { name: 'a.md', type: 'text/markdown', size: 10, path: '/Users/me/vault/notes/a.md' };
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFileAsPill).toHaveBeenCalledWith('notes/a.md');
  });

  it('routes OS file under external root to attachExternalContextMention', async () => {
    const file = { name: 'x.ts', type: 'application/typescript', size: 10, path: '/ext/foo/src/x.ts' };
    const deps = makeDeps({
      getExternalContexts: () => ['/ext/foo'],
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachExternalContextMention)
      .toHaveBeenCalledWith('/ext/foo/src/x.ts');
  });

  it('rejects out-of-vault OS folder via dedicated notice and never attaches', async () => {
    const file = { name: 'folder', type: '', size: 0, path: '/ext/foo/sub' };
    const deps = makeDeps({
      getExternalContexts: () => ['/ext/foo'],
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const items = [{
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      getAsFile: () => file,
    }];
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items });
    await Promise.resolve();

    expect(deps.fileContext.attachFolderAsPill).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalled();
  });

  it('handles a mixed batch — 1 vault file + 1 OS image + 1 rejected path', async () => {
    const vaultFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    const draggable = { type: 'files', files: [vaultFile] };
    // Simulate two events: internal drag for vaultFile, then OS files for the rest
    // is impractical. Instead, drop only OS payload with both an image and a rejected path.
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const img = { name: 'x.png', type: 'image/png', size: 10, path: '/tmp/x.png' };
    const reject = { name: 'y.md', type: 'text/markdown', size: 10, path: '/elsewhere/y.md' };
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [img, reject], items: [] });
    await Promise.resolve();

    expect(deps.imageContext.addImageFromFile).toHaveBeenCalledWith(img, 'drop');
    expect(deps.fileContext.attachFileAsPill).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalled(); // rejected notice fires
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- ChatDropController`
Expected: FAIL — `handleDrop` is empty.

- [ ] **Step 3: Implement `handleDrop`**

Replace the stub `handleDrop` in `ChatDropController.ts` with:

```ts
import { Notice } from 'obsidian';

import { classifyOsPath } from './osPathClassification';

  private async handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    this.overlayEl?.removeClass('visible');

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    const payload = detectPayload(dataTransfer, this.deps.getDragManager());

    const attached: string[] = [];
    const rejected: Array<{ path: string; reason: 'attach-failed' | 'image-failed' | 'outside-context' | 'external-folder-unsupported' }> = [];

    for (const file of payload.vaultFiles) {
      if (this.deps.fileContext.attachFileAsPill(file.path)) attached.push(file.path);
      else rejected.push({ path: file.path, reason: 'attach-failed' });
    }

    for (const folder of payload.vaultFolders) {
      if (this.deps.fileContext.attachFolderAsPill(folder.path)) attached.push(folder.path);
      else rejected.push({ path: folder.path, reason: 'attach-failed' });
    }

    for (const img of payload.osImageFiles) {
      const ok = await this.deps.imageContext.addImageFromFile(img, 'drop');
      if (ok) attached.push(img.name);
      else rejected.push({ path: img.name, reason: 'image-failed' });
    }

    const vaultPath = this.deps.getVaultPath();
    const externalRoots = this.deps.getExternalContexts();

    for (const file of payload.osFiles) {
      const absolutePath = (file as unknown as { path?: string }).path ?? file.name;
      const classified = classifyOsPath(absolutePath, vaultPath, externalRoots, { isDirectory: false });
      switch (classified.kind) {
        case 'vault-file':
          if (this.deps.fileContext.attachFileAsPill(classified.relPath)) attached.push(classified.relPath);
          else rejected.push({ path: absolutePath, reason: 'attach-failed' });
          break;
        case 'external-file':
          if (this.deps.fileContext.attachExternalContextMention(absolutePath)) attached.push(absolutePath);
          else rejected.push({ path: absolutePath, reason: 'attach-failed' });
          break;
        case 'rejected':
          rejected.push({ path: absolutePath, reason: 'outside-context' });
          break;
        default:
          rejected.push({ path: absolutePath, reason: 'outside-context' });
          break;
      }
    }

    for (const folder of payload.osFolders) {
      const classified = classifyOsPath(folder.path, vaultPath, externalRoots, { isDirectory: true });
      switch (classified.kind) {
        case 'vault-folder':
          if (this.deps.fileContext.attachFolderAsPill(classified.relPath)) attached.push(classified.relPath);
          else rejected.push({ path: folder.path, reason: 'attach-failed' });
          break;
        case 'external-folder':
          rejected.push({ path: folder.path, reason: 'external-folder-unsupported' });
          break;
        case 'rejected':
          rejected.push({ path: folder.path, reason: 'outside-context' });
          break;
        default:
          rejected.push({ path: folder.path, reason: 'outside-context' });
          break;
      }
    }

    this.fireNotices(attached.length, rejected);
    this.deps.inputEl.focus();
  }

  private fireNotices(
    attachedCount: number,
    rejected: Array<{ path: string; reason: string }>
  ): void {
    if (attachedCount > 0) {
      new Notice(t('chat.drop.batchAdded', { count: attachedCount }));
    }
    if (rejected.length === 0) return;

    const externalFolders = rejected.filter((r) => r.reason === 'external-folder-unsupported');
    const outside = rejected.filter((r) => r.reason === 'outside-context');
    const otherCount = rejected.length - externalFolders.length - outside.length;

    if (externalFolders.length > 0) {
      new Notice(t('chat.drop.externalFolderUnsupported'));
    }
    if (outside.length > 0) {
      new Notice(t('chat.drop.outsideContext', { path: outside[0].path }));
    }
    if (otherCount > 0) {
      new Notice(t('chat.drop.batchSkipped', { count: otherCount }));
    }
  }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- ChatDropController`
Expected: PASS — all routing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/controllers/ChatDropController.ts tests/unit/features/chat/controllers/ChatDropController.test.ts
git commit -m "feat(chat): route drops to vault / image / external mention pipelines"
```

---

## Task 8: Wire `ChatDropController` into `tabUi.ts`

**Files:**
- Modify: `src/features/chat/tabs/types.ts`
- Modify: `src/features/chat/tabs/tabUi.ts`

- [ ] **Step 1: Extend tab UI slot type**

In `src/features/chat/tabs/types.ts`, find the interface that holds `fileContextManager?` and `imageContextManager?` (the `ui` slot type) and add:

```ts
  chatDropController?: ChatDropController;
```

Add the import at the top of the file:

```ts
import type { ChatDropController } from '../controllers/ChatDropController';
```

- [ ] **Step 2: Construct the controller after the existing managers**

In `src/features/chat/tabs/tabUi.ts`, at the top of the file add:

```ts
import { ChatDropController } from '../controllers/ChatDropController';
```

Inside `initializeContextManagers`, after the `imageContextManager = new ImageContextManager(...)` block, append:

```ts
  tab.ui.chatDropController = new ChatDropController(dom.inputContainerEl, {
    fileContext: tab.ui.fileContextManager!,
    imageContext: tab.ui.imageContextManager!,
    getVaultPath: () => (plugin.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? '',
    getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    getDragManager: () => (plugin.app as unknown as { dragManager?: { draggable?: any } }).dragManager ?? null,
    inputEl: dom.inputEl,
  });
  tab.ui.chatDropController.init();
```

- [ ] **Step 3: Tear down on tab destroy**

Find the tab teardown path (search for `fileContextManager?.destroy()` in the same module or in the tab close flow) and add an adjacent line:

```ts
  tab.ui.chatDropController?.destroy();
```

- [ ] **Step 4: Run typecheck, lint, tests**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS. Existing tests still pass; new controller now wired but not yet driven by any spec other than its own unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/tabs/types.ts src/features/chat/tabs/tabUi.ts
git commit -m "feat(chat): instantiate ChatDropController per tab"
```

---

## Task 9: Remove drop handling from `ImageContextManager`

**Files:**
- Modify: `src/features/chat/ui/ImageContext.ts`
- Modify: `tests/unit/features/chat/ui/ImageContext.test.ts`

- [ ] **Step 1: Strip drop handlers from `ImageContextManager`**

In `src/features/chat/ui/ImageContext.ts`:

- Delete the `dropOverlay` field.
- Delete the call `this.setupDragAndDrop()` from the constructor.
- Delete the methods `setupDragAndDrop`, `handleDragEnter`, `handleDragOver`, `handleDragLeave`, and the dragstart-related `handleDrop` method that was reached only from the listener.
- Keep `setupPasteHandler`, `addImageFromFile`, `isImageFile`, and `getMediaType`.
- If `addImageFromFile` is `private`, change it to `public` (the `ChatDropController` calls it).

- [ ] **Step 2: Update tests in `ImageContext.test.ts`**

Delete every `describe` / `it` block that exercises drop, dragenter, dragover, dragleave, or the `claudian-drop-overlay` element. Keep the image-attach tests (`hasImages`, `getAttachedImages`, `addImageFromFile` direct call, paste handler if covered).

- [ ] **Step 3: Run tests**

Run: `npm test -- ImageContext`
Expected: PASS for what remains.

- [ ] **Step 4: Run full test suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ui/ImageContext.ts tests/unit/features/chat/ui/ImageContext.test.ts
git commit -m "refactor(chat): move drop handling out of ImageContextManager"
```

---

## Task 10: Integration test — real managers wired together

The existing `tests/integration/features/chat/` directory does not provide a `ClaudianView` boot harness. Rather than invent one, this task wires the **real** `FileContextManager`, `ImageContextManager`, and `ChatDropController` together against the `createMockEl` shim to verify the chain end-to-end at the controller seam.

**Files:**
- Create: `tests/integration/features/chat/dropFlow.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/features/chat/dropFlow.integration.test.ts`:

```ts
import { createMockEl } from '@test/helpers/mockElement';
import { Notice, TFile, TFolder } from 'obsidian';

import { ChatDropController } from '@/features/chat/controllers/ChatDropController';
import { FileContextManager } from '@/features/chat/ui/FileContext';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';

jest.mock('obsidian', () => {
  const notices: string[] = [];
  return {
    Notice: jest.fn((msg: string) => { notices.push(msg); }),
    TFile: class TFile { path = ''; },
    TFolder: class TFolder { path = ''; },
    __notices: notices,
  };
});

function makeApp(externalContexts: string[] = []) {
  return {
    vault: {
      on: jest.fn(() => ({ id: 'ref' })),
      offref: jest.fn(),
      adapter: { getBasePath: () => '/vault' },
      getAbstractFileByPath: jest.fn(() => null),
    },
    workspace: { getActiveFile: jest.fn(() => null), getLeaf: jest.fn() },
    metadataCache: { getFileCache: jest.fn(() => null) },
  } as any;
}

function bootTab(opts: { externalContexts?: string[] } = {}) {
  const externalContexts = opts.externalContexts ?? [];
  const container = createMockEl();
  const inputContainerEl = container.createDiv({ cls: 'claudian-input-container' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });
  const contextRowEl = container.createDiv({ cls: 'claudian-context-row' });
  const inputEl = createMockEl('textarea') as any;
  inputEl.value = '';

  const app = makeApp();
  const fileContext = new FileContextManager(
    app,
    contextRowEl,
    inputEl,
    {
      getExcludedTags: () => [],
      getExternalContexts: () => externalContexts,
    },
    inputContainerEl
  );
  const imageContext = new ImageContextManager(
    inputContainerEl,
    inputEl,
    { onImagesChanged: jest.fn() },
    contextRowEl
  );
  const dragManagerRef: { draggable: any } = { draggable: null };

  const dropController = new ChatDropController(inputContainerEl, {
    fileContext,
    imageContext,
    getVaultPath: () => '/vault',
    getExternalContexts: () => externalContexts,
    getDragManager: () => dragManagerRef,
    inputEl,
  });
  dropController.init();

  return { app, container, inputContainerEl, inputWrapper, contextRowEl, inputEl, fileContext, imageContext, dropController, dragManagerRef };
}

function dispatchDrop(target: any, dataTransfer: any): void {
  target.dispatchEvent({
    type: 'drop',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
  });
}

const obsidianMock = jest.requireMock('obsidian') as { __notices: string[] };

describe('integration: chat drop flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    obsidianMock.__notices.length = 0;
  });

  it('adds a dragged vault file as a chip pill', async () => {
    const tab = bootTab();
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    tab.dragManagerRef.draggable = { type: 'file', file: tFile };

    dispatchDrop(tab.inputWrapper, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(tab.fileContext.getAttachedFiles().has('notes/a.md')).toBe(true);
    expect(obsidianMock.__notices.some((n) => n.includes('Added 1'))).toBe(true);
  });

  it('rejects an out-of-vault OS folder with the dedicated notice', async () => {
    const tab = bootTab();
    const folder = { name: 'folder', type: '', size: 0, path: '/tmp/folder' };

    dispatchDrop(tab.inputWrapper, {
      types: ['Files'],
      files: [folder],
      items: [{
        kind: 'file',
        type: '',
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
        getAsFile: () => folder,
      }],
    });
    await Promise.resolve();

    expect(tab.fileContext.getAttachedFolders().size).toBe(0);
    expect(obsidianMock.__notices.some((n) => n.toLowerCase().includes('outside'))).toBe(true);
  });

  it('inserts @ mention for an OS file inside an external context root', async () => {
    const tab = bootTab({ externalContexts: ['/ext/foo'] });
    const file = { name: 'x.ts', type: 'application/typescript', size: 10, path: '/ext/foo/src/x.ts' };

    dispatchDrop(tab.inputWrapper, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(tab.inputEl.value).toContain('@foo/src/x.ts');
    expect(tab.fileContext.getAttachedFiles().has('/ext/foo/src/x.ts')).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npm run test -- --selectProjects integration dropFlow`
Expected: PASS for all three cases.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/chat/dropFlow.integration.test.ts
git commit -m "test(chat): wire FileContext + ImageContext + ChatDrop end-to-end"
```

---

## Task 11: Final verification + build

- [ ] **Step 1: Full typecheck + lint + tests + build**

Run, in order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Manual smoke test (optional but recommended)**

Open the Obsidian dev vault with the built plugin loaded:
1. Drag a `.md` file from the File Explorer onto the chat input area. Verify pill appears, notice "Added 1 to context" shown.
2. Drag a folder from the File Explorer onto the chat input area. Verify folder pill appears.
3. Drag a PNG from the OS file manager onto the chat input area. Verify the image preview shows under the input.
4. Drag a `.txt` file from a configured external context root. Verify `@displayName/file.txt` text is inserted at the caret.
5. Drag a folder from outside the vault. Verify "Folders outside the vault aren't supported as context yet" notice.

- [ ] **Step 3: Update the issue stub**

Edit `docs/issues/Drag and drop of files or folders into the chat to add to context.md`:

```yaml
---
type: improvement
priority: 3 - low
status: implemented
relations:
  - "[[docs/superpowers/specs/2026-06-04-chat-drag-drop-context-design.md]]"
  - "[[docs/superpowers/plans/2026-06-04-chat-drag-drop-context.md]]"
tags:
---
```

- [ ] **Step 4: Commit final docs touch**

```bash
git add docs/issues
git commit -m "docs: mark drag-and-drop issue as implemented"
```

---

## Spec Coverage Self-Review

| Spec section | Implementing task(s) |
|--------------|----------------------|
| Decisions 1 + 2 (sources, multi-drop) | Tasks 3, 5–7 |
| Decision 3 (external file mention, folder rejection) | Tasks 4, 7 |
| Decisions 4 + 5 (shared overlay, source-routed images) | Tasks 6, 7 |
| Decision 6 (zone = input wrapper) | Tasks 5, 8 |
| Architecture — `ChatDropController` | Tasks 5–8 |
| Payload Detection | Task 3 |
| Drop Handler Flow | Task 7 |
| Overlay Label Routing | Task 6 |
| i18n keys | Task 1 |
| Unit tests | Tasks 2, 3, 5, 6, 7 |
| Integration test | Task 10 |
| ImageContext refactor | Task 9 |
| Final typecheck / lint / build | Task 11 |
| Risk: `dragManager` shape may change | Detection tests cover internal-drag-absent fallback (Task 3 tests cover the missing-draggable path). |
| Risk: external-folder gap explained to user | Notice key `chat.drop.externalFolderUnsupported` added in Task 1, used in Task 7. |
