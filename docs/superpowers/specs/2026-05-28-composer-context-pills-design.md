# Composer context pills (Cursor-style attachments)

**Date:** 2026-05-28
**Status:** Approved (design), pending implementation plan

## Summary

Replace the raw `@path` mention text in the chat composer with **removable pills** shown in a tray above the textarea, like Cursor. Adding a file or folder (right-click or `@` dropdown) creates a pill instead of inserting `@text`; the textarea holds only clean prose. At send, the pills are folded into the message content as `@mentions` so the agent resolves them exactly as today and the in-thread "Attached context" card still renders.

This evolves the recently-merged folder-add + context-card feature (commit `2ef049b`): right-click now produces a pill rather than `@text`.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| `@path` text in textarea | **Removed.** Textarea holds clean prose only; attachments are pills. |
| Pill location | A tray row above the textarea (where the current-note chip lives today). |
| Current note | **Unified** into the pill tray as a pill (keeps its existing `currentNotePath` send channel). |
| How attachments reach the agent | **S1 — fold into content at send.** `content` = prose + appended `@mentions`; `displayContent` = clean prose. No provider-contract change. |
| Scope | Vault **file** and **folder** pills only. MCP, agent, and external-context mentions keep their current text behavior (out of scope). |

## Current behavior (post-`2ef049b`)

- Composer is a plain `<textarea>` (`inputEl`); displayed text == value == sent content.
- `@` dropdown (`MentionDropdownController.selectMentionItem`): file → inserts `@path ` + `onAttachFile`; folder → inserts `@path/ ` (no attach).
- Right-click (`main.ts`): `addFileToActiveChat` → `insertVaultFileMention`; `addFolderToActiveChat` → `insertVaultFolderMention`.
- `FileContextState`: `attachedFiles: Set<string>` (no folders). `FileChipsView.renderCurrentNote` renders exactly one chip — the current note.
- Send (`InputController` ~723-748): only `currentNotePath` flows to `ChatTurnRequest`; `getAttachedFiles()` is bookkeeping (rename/delete sync), NOT a send channel. The agent learns of attached files purely from `@path` text in `content`.
- In-thread card (`MessageRenderer.renderUserContextCard`): derives attachments from `displayContent ?? content` via `extractVaultMentions`.

## Design (S1)

### 1. State — `src/features/chat/ui/file-context/state/FileContextState.ts`
Add `attachedFolders: Set<string>` mirroring `attachedFiles`: `attachFolder`, `detachFolder`, `getAttachedFolders`, and include it in `clearAttachments`/`setAttachedFolders`. Current note stays in `currentNotePath` (unchanged).

### 2. Pill tray view — `src/features/chat/ui/file-context/view/FileChipsView.ts`
Replace the single-chip `renderCurrentNote` with `renderPills({ currentNote, files, folders })` that renders a tray of pills in order:
1. **Current-note pill** (if set): file-text icon + basename + a subtle "current" affordance (e.g. a `--current` modifier class); removable (× → `onRemoveAttachment(currentNotePath)`); click → open.
2. **File pills**: file-text icon + basename, `title` = full path; removable; click → open in tab.
3. **Folder pills**: folder icon + `basename/`; removable; display-only (no open).

Empty (no current note, no files, no folders) → tray hidden. De-dupe: if an attached file equals `currentNotePath`, render it once as the current-note pill only.

### 3. Add → pill (never text)
- **Right-click** (`src/main.ts`): `addFileToActiveChat`/`addFolderToActiveChat` call new `fileContextManager.attachFileAsPill(path)` / `attachFolderAsPill(path)` which update state and re-render the tray — no text insertion. (The old `insertVaultFileMention`/`insertVaultFolderMention` are repurposed/renamed into these pill-adding methods; the text-splice helper `insertMentionAtCursor` is removed if no longer used.)
- **`@` dropdown** (`src/shared/mention/MentionDropdownController.ts`): in `selectMentionItem`, the `file` and `folder` cases **strip the typed `@query`** from the textarea (replace `beforeAt + afterCursor`, no mention text) and invoke a new callback `onAddContextPill(path, kind)`. The `mcp-server`, `agent`, `agent-folder`, `context-file`, `context-folder` cases are unchanged.

`FileContextManager` wires `onAddContextPill` → `attachFileAsPill`/`attachFolderAsPill`.

### 4. Send folding — `src/features/chat/controllers/InputController.ts`
When assembling the outgoing turn for a normal (non-compact) message:
- `prose` = the textarea text (already transformed for external-context mentions via `transformContextMentions`).
- `mentions` = `" @" + path` for each attached file, `" @" + path + "/"` for each attached folder, excluding any path equal to `currentNotePath`.
- `content` = `prose + mentions` (the agent-facing text; carries the references).
- `displayContent` = `prose` (clean; what the thread shows). If `prose` is empty but pills exist, `displayContent` is empty and only the card renders.
- Current note continues via `currentNotePath` exactly as today (never folded — avoids double-send).

### 5. In-thread card tweak — `src/features/chat/rendering/MessageRenderer.ts`
Change `renderUserContextCard` to derive mentions from `msg.content` (which now carries the folded mentions) instead of `msg.displayContent ?? msg.content`. The text block still renders `displayContent ?? content`. This keeps the thread text clean while the card shows the attachments.

### 6. Removal, sync, reset
- Pill × → `detachFile`/`detachFolder` (or current-note detach) + re-render. Pills are the sole source of truth in the composer; the textarea has no `@text` to keep in sync (eliminates bidirectional-sync risk).
- Vault rename/delete: extend the existing `attachedFiles` rename/delete handlers to also update `attachedFolders`, and re-render the tray.
- `resetForNewConversation`/`resetForLoadedConversation` clear `attachedFolders` too and re-render.

## Edge cases
- **Current note == an attached file:** rendered once (current-note pill); never folded as an `@mention` (sent via `currentNotePath`).
- **Empty prose + pills only:** send still folds the mentions into `content`; `displayContent` empty; thread shows the card with no text block.
- **Vault root folder:** `attachFolderAsPill` rejects empty/unnormalizable paths (notice), as the prior `insertVaultFolderMention` did.
- **Manual `@text` a user types directly:** left as-is in prose; it still resolves at send (it is in `content`) but is not represented as a pill — acceptable, no special handling.
- **`displayContent` already used by slash commands:** unaffected — those set `displayContent` for command display; this change only adds the pill-folding path for normal messages.

## Testing
- **State:** `attachFolder`/`detachFolder`/`getAttachedFolders`; `clearAttachments` clears folders; reset clears folders.
- **Tray view:** renders current-note + file + folder pills in order; removal callbacks fire with correct path; folder pill has no open handler; file/current pills clickable; empty → hidden; current-note/attached-file dedupe.
- **Dropdown:** selecting a `file` and a `folder` strips the `@query` (textarea returns to pre-`@` text) and calls `onAddContextPill(path, 'file'|'folder')`; no `@text` inserted; mcp/agent/context cases unchanged.
- **InputController send:** folds attached files/folders into `content` as `@path`/`@path/`; `displayContent` stays clean prose; current note excluded from folding; empty-prose-with-pills still sends folded content.
- **MessageRenderer:** card derives from `content` (folded mentions) and renders for a message whose `displayContent` is clean prose with no inline mentions.

## Files touched
- `src/features/chat/ui/file-context/state/FileContextState.ts` — folders state.
- `src/features/chat/ui/file-context/view/FileChipsView.ts` — pill tray (`renderPills`).
- `src/features/chat/ui/FileContext.ts` — `attachFileAsPill`/`attachFolderAsPill`, `onAddContextPill` wiring, tray re-render, folder rename/delete + reset.
- `src/shared/mention/MentionDropdownController.ts` — file/folder select → strip query + `onAddContextPill`.
- `src/main.ts` — right-click → pill methods.
- `src/features/chat/controllers/InputController.ts` — fold pills into `content` at send.
- `src/features/chat/rendering/MessageRenderer.ts` — card derives from `content`.
- `src/style/features/file-context.css` (or a new `context-pills.css` registered in `index.css`) — pill tray styling.
- Mirrored tests under `tests/unit/` (+ `tests/integration/main.test.ts` for the right-click→pill change).
