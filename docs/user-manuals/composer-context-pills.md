# Claudian — Composer context pills

This manual covers **composer context pills**: the small chips that appear in a row above the chat textarea to represent the vault context attached to your next message. Pills replace the older "raw `@path` text" style — the textarea now holds clean prose, and the pills are the composer's source of truth for which notes and folders go with your turn.

A pill is just a UI handle around a vault path. At send, Claudian folds each pill into the message content as an `@path` (or `@path/` for folders) so the provider resolves it the same way it always has, and the in-thread "Attached context" card still renders.

---

## What a pill represents

The composer renders three kinds of pill, all in the same tray above the textarea:

| Kind | What it is | Icon | Click behaviour |
|------|------------|------|-----------------|
| **Current note** | The note Claudian considers active for this chat (your focused editor, or whatever a loaded conversation pinned). One per composer. Renders with the `--current` accent. | `file-text` | Opens the note in a new leaf. |
| **File** | A vault file you explicitly attached for this turn. | `file-text` | Opens the file in a new leaf. |
| **Folder** | A vault folder you explicitly attached. The pill label ends in `/`. | `folder` | Display-only — no open action. |

Each pill shows its **basename** (so `src/providers/Claude.ts` reads as `Claude.ts`) with the full path as a `title` tooltip on hover. Every pill has an `×` remove button on the right.

If you attach a file whose path equals the current note, the tray renders **only the current-note pill** — no duplicate. The current note is also never folded as an extra `@mention` at send (it travels through its own `currentNotePath` channel), so the provider never sees it twice.

When the tray would be empty (no current note, no files, no folders), it hides itself entirely.

> Images, browser-view captures, editor selections, and canvas selections are **not** pills. They use their own composer affordances (image chips, the editor-selection indicator, etc.) and have their own send channels. This manual is only about the vault file/folder pill tray.

---

## Adding context

### Open a note in Obsidian
Whatever note you open in your editor becomes the **current-note pill** automatically, as long as the chat session hasn't started a turn yet and the note doesn't carry one of your excluded tags. Switching notes before the first send replaces the pill (and clears any other attached file/folder pills you'd added pre-send).

Once you've sent the first turn of a conversation, the current-note pill stops auto-following your editor — the session has started, so switching notes won't silently rewrite the attached context mid-thread. To change the current note after that, either explicitly close the conversation and start a new one, or remove the pill with `×` and pick what you want manually.

If your active note carries a tag you listed in **Settings → Claudian → Excluded tags**, Claudian skips auto-attaching it. The tray stays empty until you open a non-excluded note or attach something by hand.

### Type `@` in the composer
Type `@` (then optionally a query) to open the **mention dropdown**. Pick a vault file or folder row, then press Enter or click:

- The `@query` text you typed is **stripped** from the textarea — the composer goes back to clean prose.
- A pill is added to the tray (file or folder, depending on what you picked).

> The `@` dropdown still handles **MCP servers**, **agents**, **agent folders**, and **external context** (`context-file` / `context-folder`) the way it always has — those insert `@text` into the prose and are not pills. Only vault `file` and `folder` rows convert to pills.

### Right-click a file or folder
In the Obsidian file explorer, right-click any file → **Add file to Claudian chat**, or any folder → **Add folder to Claudian chat**. The chat panel opens (if it wasn't already), a pill appears, and the composer is focused. You get a notice confirming the path that was added.

If no chat tab or no provider is open, you get a notice asking you to open Claudian chat and enable a provider first.

---

## Inspecting a pill

- **Hover** a pill to see its **full vault path** in a tooltip — useful when the basename alone is ambiguous (`index.ts` vs `Claude/index.ts`).
- **Click** a file pill or the current-note pill to **open** the file in a new editor leaf. If the file no longer resolves (renamed away, deleted), Claudian shows a notice rather than opening anything.
- **Folder pills** don't open on click. They're a label only — use the Obsidian file explorer to browse the folder itself.

The in-thread "Attached context" card (see [[Agent Board — Chat Interop & Capture]] for how cards relate to capture flows) shows the same set of paths after you send, derived from the folded `@mentions` in the message content.

---

## Removing a pill

Click the **×** on any pill to remove it. The exact action depends on the kind:

- **Current note ×** clears `currentNotePath` and detaches the file. The current note will not be re-attached until you switch notes or restart the session.
- **File ×** detaches that file.
- **Folder ×** detaches that folder.

Other ways pills disappear on their own:

- **Sending a message** clears every added file and folder pill (they were just consumed by that turn). The current-note pill stays — it's tied to your active editor, not the turn.
- **Queuing a message while a turn is still streaming** also clears the added file and folder pills, so they don't linger in the composer behind the next turn you're typing.
- **Renaming a tracked file/folder** in the vault rewrites the pill to the new path.
- **Deleting a tracked file/folder** removes the pill.
- **Starting a new conversation** (or loading an existing one) clears every added pill and re-derives the current note from your active editor.

---

## How pills feed the prompt

At send, `InputController.buildTurnSubmission` does this:

1. Takes the textarea text as **`displayContent`** — clean prose, with no `@mentions` for the pill paths. This is what the chat thread renders as your message text.
2. Builds a **mention suffix** from the pill tray: ` @file/path.md` for each file pill, ` @folder/path/` for each folder pill. The current note is **excluded** (it's sent via `currentNotePath`).
3. Concatenates `prose + suffix` and runs it through the external-context transform to produce **`turnRequest.text`** — the content the provider actually receives. The provider resolves the `@mentions` the same way it does for any typed `@path`.

The user-visible result:

- **The chat thread shows your clean prose** plus an "Attached context" card listing the pill paths.
- **The provider sees the prose plus the folded `@mentions`** and can read each referenced file/folder.
- **The current note travels separately** through `currentNotePath`, so it's not double-counted even if you also added it as a pill.

`/compact` turns are an exception: pill mentions are **not** folded into the content for `/compact`, so the provider receives the bare command and triggers its built-in compaction.

If you send a turn with no prose at all but pills attached, the message still goes out — `displayContent` is empty (no text block in the thread, just the context card), and `turnRequest.text` carries the folded mentions.

Concretely, a composer with the current note `notes/today.md`, an attached file `src/a.ts`, an attached folder `src/providers`, and the prose `explain this` will send:

- `displayContent` → `explain this`
- `turnRequest.text` → `explain this @src/a.ts @src/providers/`
- `currentNotePath` → `notes/today.md`

The thread renders the prose line and a context card listing all three paths.

---

## Typical flow

1. Open the note you want to discuss. It shows up as the **current-note pill** with the accent border.
2. Right-click the folder of related providers in the file explorer → **Add folder to Claudian chat** → a folder pill joins the tray.
3. Type `@` in the composer, pick another file from the dropdown → it lands as a file pill; the `@query` you typed is wiped from the textarea so your prose stays clean.
4. Hover any pill to confirm the full path. Click a file pill to open it; click `×` to drop one you didn't mean to attach.
5. Write your question and **send**. The thread shows your prose plus an "Attached context" card with the three paths; the provider reads the current note, the file, and the folder before answering.
6. The added file and folder pills clear automatically. The current-note pill stays for the next turn.
