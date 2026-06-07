---
title: Drag and drop files or folders into the chat to add to context
date: 2026-06-04
status: shipped
scope: features/chat
relations:
  - "[[2026-06-04-chat-drag-drop-context]]"
  - "[[2026-06-04-paste-image-vault-persist-design]]"
  - "[[Drag and drop of files or folders into the chat to add to context]]"
tags:
  - chat
  - file-context
  - inline-edit
parent: "[[sidepanel-chat]]"
---

# Drag and drop files or folders into the chat to add to context

## Summary

Extend the chat composer so users can drag files or folders into the input area and have them attached as context pills — matching the right-click "Add file/folder to Claudian chat" flow already exposed in `registerWorkspaceMenus.ts`. Sources covered: Obsidian File Explorer (TFile / TFolder) and OS file system drags (Finder / Windows Explorer). Existing OS image drop behavior is preserved unchanged.

## Goals

- Parity with the right-click context menu for vault files and folders.
- Accept OS-dragged files and folders, classifying them as vault items, external context items, or rejected.
- Preserve current OS image drop behavior (base64 vision payload via `ImageContextManager`).
- Single, adaptive drop overlay with a label that reflects the detected payload.
- No regressions for streaming, multi-tab, or mid-session drops.

## Non-Goals

- Drag from other Obsidian surfaces (search results, tab headers, linked editor text). Tracked separately if needed.
- Copying out-of-vault OS files into the vault automatically.
- New persistence layer for dropped items — reuses existing `FileContextState` and external context plumbing.

## Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| 1 | Sources: Obsidian File Explorer + OS file system drag (files and folders). |
| 2 | Multi-drop allowed; iterate `dataTransfer` items and attach each as its own pill. |
| 3 | OS path outside vault: if a file is covered by a configured external context root, attach it via the existing external mention pipeline (insert `@displayName` text + track absolute path in `FileContextState`); otherwise reject with a notice. Out-of-vault folders are rejected — no external-folder representation exists today. |
| 4 | Single overlay shared with image drop; label adapts to the detected payload. |
| 5 | Image disambiguation is source-routed: vault PNG/JPG → file pill (matches right-click); OS image → image attachment (matches today). |
| 6 | Drop zone limited to `.claudian-input-wrapper` (current image zone). |

## Architecture

New seam: `ChatDropController` under `src/features/chat/controllers/`. Owns the drag and drop lifecycle for the input wrapper. The existing drag handling inside `ImageContextManager.setupDragAndDrop` moves into this controller; `ImageContextManager` retains only the image-attach pipeline (`addImageFromFile`, `setupPasteHandler`).

```text
ChatDropController
├── owns: dragenter / dragover / dragleave / drop listeners on .claudian-input-wrapper
├── owns: drop overlay element + adaptive label state
├── routes drops to:
│   ├── FileContextManager.attachFileAsPill / attachFolderAsPill   (vault items, OS files / folders inside vault)
│   ├── ImageContextManager.addImageFromFile                       (OS image MIME)
│   └── FileContextManager.attachExternalContextMention (new thin helper)  (OS file under external root)
└── deps: App, externalContextScanner, buildExternalContextDisplayEntries, settings.externalContexts, app.dragManager
```

Why split: when only images dropped, ImageContext owning the drop zone was fine. Three routes plus payload disambiguation make ImageContext the wrong owner. The controller pattern matches `InputController` and `StreamController` in the same directory.

`FileContextManager` gains one thin helper, `attachExternalContextMention(absolutePath)`, that mirrors what `MentionDropdownController` does when a user picks an external context file from the `@` dropdown today (`MentionDropdownController.ts` ~line 589–598): resolve the absolute path against the configured external roots via `buildExternalContextDisplayEntries`, insert `@displayName ` at the textarea caret, and call `state.attachFile(absolutePath)`. No new pill type or rendering path is introduced — external files participate via the existing text-mention + tracked-path flow, not as chip pills. Out-of-vault folder drops are rejected because no external-folder mention path exists today.

## Payload Detection

Detection runs twice with the same function: once on `dragenter` for overlay label routing, once on `drop` for actual routing. The dragenter pass uses only cheap signals (no path resolution, no scanner calls).

```text
DroppedPayload = {
  vaultFiles: TFile[]
  vaultFolders: TFolder[]
  osImageFiles: File[]      // OS drag, image MIME
  osFiles: File[]           // OS drag, non-image file
  osFolders: { path: string }[]  // OS drag, directory via webkitGetAsEntry
  unknown: number           // count for notice
}
```

### Source identification

| Signal | Source |
|--------|--------|
| `app.dragManager.draggable` is set OR an Obsidian internal MIME marker is present | Obsidian internal drag — resolve TFile / TFolder via the drag manager |
| `dataTransfer.types` includes `Files` AND no internal marker | OS drag |
| Both | Internal wins (avoid double-handling when Obsidian also surfaces a File) |

`app.dragManager.draggable` holds `{ type: 'file' \| 'files' \| 'folder', file?, files? }` during an explorer drag — community-plugin precedent confirms this is stable enough to use. Read it during drop before it clears.

OS folder detection uses `dataTransfer.items[i].webkitGetAsEntry()?.isDirectory`. Folder absolute paths come from Electron's `File.path`, even though `File.size === 0` for directories.

### Vault vs external classification (drop only)

1. OS path under `getVaultPath(app)` → normalize, treat as a vault file or folder and route through `FileContextManager.attachFileAsPill / attachFolderAsPill`.
2. OS file under any configured external context root → route through `FileContextManager.attachExternalContextMention(absolutePath)`.
3. OS folder under a configured external context root → reject with the dedicated "external folder not supported" notice (no mention path exists today).
4. Otherwise → reject with the "outside vault or external context" notice.

Edge: streaming mid-flight does not gate drops. The right-click flow does not gate them today; drag stays consistent.

## Drop Handler Flow

```text
on drop(e):
  e.preventDefault(); e.stopPropagation()
  overlay.hide()

  payload = detectPayload(e.dataTransfer, app.dragManager)
  results = { attached: [], rejected: [] }

  for f in payload.vaultFiles:
    fileContextManager.attachFileAsPill(f.path)
      ? results.attached.push(f.path)
      : results.rejected.push({ path: f.path, reason: 'attach-failed' })

  for f in payload.vaultFolders:
    fileContextManager.attachFolderAsPill(f.path)
      ? results.attached.push(f.path)
      : results.rejected.push({ path: f.path, reason: 'attach-failed' })

  for img in payload.osImageFiles:
    await imageContextManager.addImageFromFile(img, 'drop')
      ? results.attached.push(img.name)
      : results.rejected.push({ path: img.name, reason: 'image-failed' })

  for file in payload.osFiles:
    classified = classifyOsPath(file.path)
    switch classified.kind:
      'vault-file'    -> attachFileAsPill(classified.relPath)
      'external-file' -> attachExternalContextMention(file.path)
      'rejected'      -> results.rejected.push({ path, reason: 'outside-context' })

  for folder in payload.osFolders:
    classified = classifyOsPath(folder.path)
    switch classified.kind:
      'vault-folder'    -> attachFolderAsPill(classified.relPath)
      'external-folder' -> results.rejected.push({ path, reason: 'external-folder-unsupported' })
      'rejected'        -> results.rejected.push({ path, reason: 'outside-context' })

  finalize(results):
    if attached.length > 0 -> Notice('Added N to context')
    if rejected.length > 0 -> Notice('Skipped M: outside vault or external context')
    inputEl.focus()
```

Ordering: vault items first (cheap, sync), then OS images (async base64), then OS files and folders. Each route is independent — one failure does not abort the batch. Pills append as each succeeds, so the UI never sits in a partial transient state.

Existing error strings (`chat.context.fileAttachFailed`, `chat.image.unsupported`) are reused verbatim. New i18n keys added for the batch summary and outside-context rejection (see below).

## Overlay Label Routing

Single overlay `.claudian-drop-overlay` owned by `ChatDropController`. CSS unchanged. Label content swaps per `dragenter` classification.

State machine:

```text
hidden ──dragenter (valid payload)──> visible(label)
visible ──dragleave (outside wrapper rect)──> hidden
visible ──drop──> hidden (then route)
```

Label decisions:

| Payload signature | i18n key | English label |
|-------------------|----------|---------------|
| Only OS image MIME | `chat.drop.image` | Drop image |
| Only vault file(s) | `chat.drop.fileContext` | Drop into context |
| Only vault folder(s) | `chat.drop.folderContext` | Drop folder into context |
| OS files (non-image) or folders | `chat.drop.osContext` | Drop file or folder into context |
| Mixed (image + path) | `chat.drop.mixed` | Drop into chat |
| Unknown / no Files MIME and no internal drag | overlay stays hidden | — |

Dragenter cost is bounded: inspect `dataTransfer.types`, `app.dragManager.draggable`, and `items[].kind / type` only. Heavy classification is deferred to drop.

The existing image-only overlay markup inside `ImageContextManager.setupDragAndDrop` is removed. `ChatDropController.init()` constructs the overlay during view assembly at the same hook point used to construct `FileContextManager` and `ImageContextManager`.

## Internationalization

New keys under `chat.drop.*`:

- `chat.drop.image`
- `chat.drop.fileContext`
- `chat.drop.folderContext`
- `chat.drop.osContext`
- `chat.drop.mixed`
- `chat.drop.batchAdded` — "Added {count} to context"
- `chat.drop.batchSkipped` — "Skipped {count}: outside vault or external context"
- `chat.drop.externalFolderUnsupported` — "Folders outside the vault aren't supported as context yet"

Initial PR ships English. The other 9 locales fall back to English via existing i18n fallback behavior until translations land — consistent with how recent feature work has been shipped in this codebase.

## Testing

Tests mirror `src/` under `tests/unit/` and `tests/integration/`.

### Unit: `tests/unit/features/chat/controllers/ChatDropController.test.ts`

| Test | Asserts |
|------|---------|
| `detectPayload` — Obsidian internal drag with TFile | returns `vaultFiles: [file]`, no OS routes |
| `detectPayload` — Obsidian internal drag with TFolder | returns `vaultFolders: [folder]` |
| `detectPayload` — OS image MIME via `dataTransfer.files` | returns `osImageFiles` only |
| `detectPayload` — OS non-image file with vault-relative path | classifies vault-file via `classifyOsPath` |
| `detectPayload` — OS file under configured external root | classifies external-file |
| `detectPayload` — OS folder under configured external root | classifies external-folder (rejected at routing) |
| `detectPayload` — OS path outside vault + outside external roots | rejected |
| `detectPayload` — OS folder via `webkitGetAsEntry.isDirectory` | returns `osFolders` |
| `detectPayload` — both internal and OS markers present | internal wins |
| `dragenter` label routing | each payload signature maps to expected i18n key |
| `drop` batch — 3 vault files + 1 OS image + 1 rejected OS path | 4 attached, 1 rejected, both notices fired |
| `drop` external file — OS file under configured external root | `@displayName ` inserted at caret, `state.attachFile(absolutePath)` called once |
| `drop` external folder — OS folder under configured external root | rejected with `chat.drop.externalFolderUnsupported` notice |
| `drop` mid-stream | still attaches; no gating |

Mocks:

- `app.dragManager.draggable` set and cleared per test.
- `dataTransfer.types`, `dataTransfer.files`, `dataTransfer.items[].webkitGetAsEntry()` stubbed.
- `FileContextManager` and `ImageContextManager` as plain mocks; assert call arguments, not internals.

### Integration: `tests/integration/features/chat/dropFlow.integration.test.ts`

- Boot a `ClaudianView`, fire synthetic `DragEvent` on the input wrapper, assert pill chips render in `FileContextManager.chipsView`.

### Cross-platform

`itPosix` / `itWin32` helpers (per MEMORY) for `classifyOsPath` cases. Vault path `D:\Projects\vault` vs `/Users/x/vault`. Mixed-slash inputs normalized through the existing `normalizePathForVault`.

### Performance

Not a perf-sensitive surface. No entry added to `tests/perf/`.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `app.dragManager.draggable` is not a documented API and could change. | Treat it as a hint, not a contract: if it is missing or shape-mismatched, fall back to `dataTransfer.files` plus path classification. Cover both shapes in unit tests. |
| External context root configuration is empty: every OS drop outside the vault is rejected. | The rejection notice mentions external context configuration explicitly so the user knows the fix. |
| External-folder support missing today means OS folder drops outside the vault always reject, which may confuse users who expected symmetry with vault folders. | Dedicated rejection notice (`chat.drop.externalFolderUnsupported`) explains the gap. A follow-up could add external-folder mention support; out of scope here. |
| `File.path` is Electron-specific and absent in browser-only test environments. | Tests stub `File.path` directly; runtime relies on the existing Electron environment that already powers image drop. |
| ImageContext refactor regresses paste-from-clipboard image handling. | `setupPasteHandler` stays in `ImageContextManager` untouched. Only `setupDragAndDrop` moves. Existing image paste tests guard the seam. |
| Folder pills become very large at send time (folder expansion is the runtime concern). | Out of scope for this work; matches today's right-click `attachFolderAsPill` behavior. |

## Out of Scope

- Drag from search results, backlinks pane, or tab headers.
- Auto-copy of out-of-vault files into the vault.
- Drop targeting a specific tab other than the one whose input wrapper received the event.
- Per-provider gating (drop attaches to whichever provider owns the active tab; provider capability checks already apply downstream).
