# Add folders to chat + inline context card

**Date:** 2026-05-27
**Status:** Approved (design), pending implementation plan

## Summary

Two related enhancements to Claudian's "add to chat" context flow:

1. **Folders in right-click add.** The file-explorer right-click "Add file to Claudian chat" currently only handles `TFile`. Extend it so a folder can be added too, inserting a single `@<folder>/` mention — identical to picking a folder from the `@` dropdown.
2. **Inline context card.** Attached files and folders are hard to see today (only the current note renders as a chip; explicitly added `@mentions` are invisible). Render an "Attached context" card inside each sent user message, summarizing the files and folders that turn referenced, so the user can understand at a glance what context was included.

## Scope

- **In scope:** single-item right-click add for folders; inline context card in the conversation thread, derived from the message's `@mentions`.
- **Out of scope (YAGNI):** multi-select add (`files-menu` event with several selected items); a live pre-send preview card in the input area; stripping `@mention` text out of the displayed message. These can be follow-ups.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Folder add behavior | Single `@<folder>/` mention (mirrors existing `@` dropdown folder selection). No file-chip / `attachFile` state, consistent with how typed folder mentions behave. |
| Multi-select | Out of scope. Single right-click item only. |
| Display style | Inline context card inside the sent user message, in the thread. |
| Card data source | Derived from the message text (`displayContent ?? content`) by parsing `@mentions`. No new persisted field. |
| Mention text in message | Kept inline as typed; card is an additive summary above the text (non-destructive). |

## Current behavior (as built)

- `src/main.ts` registers a `file-menu` handler that early-returns unless `file instanceof TFile`, then adds "Add file to Claudian chat" → `addFileToActiveChat(file)` → `fileContextManager.insertVaultFileMention(file.path)`.
- `insertVaultFileMention` (`src/features/chat/ui/FileContext.ts`) splices `@<path>` into the input at the cursor (with leading/trailing space handling), calls `state.attachFile(path)`, and dispatches an `input` event.
- The `@` dropdown already supports folders: selecting a folder inserts `@<normalizedPath>/ ` text and does **not** call `attachFile` (`MentionDropdownController.selectMentionItem`, `case 'folder'`).
- `FileChipsView.renderCurrentNote()` renders exactly **one** chip — the current note. The `attachedFiles` Set is tracked and sent to the provider but never rendered as chips. Folders are not tracked at all.
- `MessageRenderer` draws user-message text from `displayContent ?? content` into a `.claudian-text-block`, across three render paths (append / full render / re-render).
- `ChatMessage` (`src/core/types/chat.ts`) has `content`, `displayContent?`, `currentNote?` (single note), `images?` — **no** field for a list of attached files/folders. Messages rehydrate from provider transcripts on reload.

## Design

### Part 1 — Folder right-click add

**`src/main.ts` — `file-menu` handler (~line 97)**

Replace the `if (!(file instanceof TFile)) return;` early return with a branch:

- `file instanceof TFile` → existing "Add file to Claudian chat" item → `addFileToActiveChat(file)`.
- `file instanceof TFolder` → new "Add folder to Claudian chat" item, icon `folder` → `addFolderToActiveChat(file)`.

Add `addFolderToActiveChat(folder: TFolder): Promise<boolean>` mirroring `addFileToActiveChat`: ensure the view is open, resolve the active tab's `fileContextManager`, call `insertVaultFolderMention(folder.path)`, focus the input, and show a success / failure `Notice`.

**`src/features/chat/ui/FileContext.ts`**

- Extract the cursor-splice logic from `insertVaultFileMention` into a private `insertMentionAtCursor(body: string): void` (leading/trailing space handling, value splice, cursor reposition, `input` event dispatch, focus).
- `insertVaultFileMention(path)` → normalize → `insertMentionAtCursor('@' + norm)` → `state.attachFile(norm)` → return `true`. (Behavior unchanged.)
- New `insertVaultFolderMention(path)` → normalize → `insertMentionAtCursor('@' + norm + '/')` → **no** `attachFile` → return `true`. Returns `false` if the path is empty or fails normalization (covers the vault root `/`).

Folder mentions are intentionally not tracked in `attachedFiles`, matching the dropdown. The card (Part 2) surfaces them visually instead.

### Part 2 — Inline context card

**Architecture: derive from message content.** The card is computed at render time from the user message's `@mentions`. This needs no model change, persists for free (the `@mentions` are part of the stored `content`, re-parsed on reload), works identically for both providers, and gives the same card to typed `@mentions` — not only right-click adds.

**Mention extraction — new util (e.g. `src/utils/vaultMentions.ts`)**

`extractVaultMentions(text: string, resolve: (path: string) => 'file' | 'folder' | null): { files: string[]; folders: string[] }`

- Reuse `isMentionStart` and `collectMentionEndCandidates` from `src/utils/contextMentionResolver.ts`. For each `@` at a mention boundary, try end candidates **longest-first** and accept the longest substring that `resolve` confirms is a vault file or folder. Greedy-longest validation handles paths containing spaces.
- A token ending in `/` is treated as a folder; otherwise the resolver's verdict decides. Tokens that resolve to nothing are ignored (so stray `@words`, emails, etc. never appear as context).
- `resolve` is supplied by the renderer using `app.vault.getAbstractFileByPath` (→ `TFile` vs `TFolder`), trying with and without a trailing slash.
- De-duplicate while preserving first-seen order.

**Rendering — `src/features/chat/rendering/MessageRenderer.ts` + new view**

- New display-only component `MessageContextCard` (e.g. `src/features/chat/rendering/MessageContextCard.ts` or under `ui/file-context/view/`) that, given `{ files, folders }`, builds a `.claudian-context-card`: a header with the total count, then one row per item — `file-text` icon + basename for files, `folder` icon + basename (with trailing `/`) for folders. Each row's `title` is the full path.
- In `MessageRenderer`, for `role === 'user'` messages, extract mentions from `displayContent ?? content`; if any resolve, render the card **above** the `.claudian-text-block`. Factor this into a single helper invoked from all three render paths to avoid divergence.
- File rows open the file on click (reuse the existing `onOpenFile` behavior). Folder rows are non-interactive in the MVP.
- The message text itself is rendered unchanged (mentions stay inline).

**Styling** — new `src/style/components/context-card.css`, imported from the style barrel. Scoped under `.claudian-context-card`, using existing chip/indicator tokens for visual consistency.

## Data flow

Unchanged at the provider boundary. Folder add inserts `@<path>/` text into the input; existing send-time mention resolution and the agent's file tools handle the rest. The card is a pure render-time projection of the message text — no change to `ChatTurnRequest`, prompt encoding, session storage, or history hydration.

## Edge cases

- **Vault root folder** (`TFolder.path === '/'` or empty): `insertVaultFolderMention` returns `false` with a "Could not add folder" notice.
- **Paths with spaces:** handled by greedy-longest vault validation in `extractVaultMentions`.
- **Non-resolving `@tokens`:** ignored by the card (validated against the vault).
- **Rename / delete after send:** the card reflects the message text as sent; it is historical and does not live-update. The current note rename/delete handlers stay file-only.
- **Compact / rebuilt-context messages:** skip card extraction (these are not user-authored context turns) — gate on the same conditions the renderer already uses for these message kinds.

## Testing (TDD)

- **`extractVaultMentions`** (unit): files vs folders; trailing-slash folder; greedy match for paths with spaces; ignores non-resolving tokens; de-dupes; respects mention boundaries.
- **`insertVaultFolderMention`** (unit): inserts `@<path>/`, does **not** call `attachFile`, dispatches `input`; returns `false` on empty/root path. Confirm `insertVaultFileMention` still attaches (regression).
- **`MessageContextCard` / MessageRenderer** (unit/component): renders a card for a user message with file + folder mentions; no card when none resolve; card derives correctly from `content` alone (reload scenario, no `displayContent`).
- **`file-menu` handler** branch (if a `main` harness exists): folder item present for `TFolder`, file item for `TFile`.

## Files touched

- `src/main.ts` — handler branch + `addFolderToActiveChat`.
- `src/features/chat/ui/FileContext.ts` — `insertMentionAtCursor` helper + `insertVaultFolderMention`.
- `src/utils/vaultMentions.ts` (new) — `extractVaultMentions`.
- `src/features/chat/rendering/MessageRenderer.ts` — card injection helper.
- `src/features/chat/rendering/MessageContextCard.ts` (new) — card view.
- `src/style/components/context-card.css` (new) + style barrel import.
- Mirrored tests under `tests/unit/`.
