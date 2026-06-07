---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[sidepanel-chat]]"
---
# Add folders to chat & attached-context card

This manual covers two related pieces of the Claudian chat **context** flow:

1. **Adding a folder (or file) to chat from the file explorer's right-click menu** — the folder shows up as a pill above the chat input, the same way the `@` dropdown adds it.
2. **The attached-context card** that Claudian renders inside every sent user message, summarizing the vault files and folders that message referenced.

Both work for every provider (Claude, Codex, Opencode, Cursor) and persist across reloads — the card is derived from the message text, not from any extra stored field.

---

## Before you start

There are no settings for this feature. Open the chat from the **ribbon** (`Open Claudian`, bot icon) or the command palette command **Open chat view**, then make sure a provider is enabled. Right-click on a folder or file in the file explorer is gated on having an active Claudian chat tab — without one, you get the notice *"Open Claudian chat and enable a provider before adding folder context."* (or *"… file context."*).

For more on creating work orders from the same menu, see [[agent-board-chat-interop-and-capture]].

---

## Adding a folder or file from the file explorer

Right-click any folder or file in the file explorer:

| Item | Icon | Action |
|------|------|--------|
| **Add folder to Claudian chat** | `folder` | Adds a folder pill for the right-clicked folder to the active chat tab. |
| **Add file to Claudian chat** | `at-sign` | Adds a file pill for the right-clicked file to the active chat tab. |

Both items:

- Open / activate the Claudian chat view if it isn't already.
- Add a **pill** (chip) to the input's pill row — no text is inserted into the textarea.
- Focus the chat input.
- Show a notice — *"Added `<path>/` to Claudian chat"* for folders, *"Added `<path>` to Claudian chat"* for files.

If the path can't be normalized (e.g. the vault root), the notice instead reads *"Could not add folder to chat: `<path>`"* or *"Could not add file to chat: `<path>`"* and nothing is added.

Adding the same folder or file twice is a no-op — pills are de-duplicated by path.

> The `@` mention dropdown adds the same kind of pills. Right-click is just a shortcut for the same end state.

---

## Pills above the input

Pills live in the row directly above the chat input, alongside the **current note** pill. There are three kinds:

| Pill | Icon | Source |
|------|------|--------|
| **Current note** | `file-text` | The note focused when the session started. Auto-attached. |
| **File** | `file-text` | Added from the `@` dropdown or right-click. |
| **Folder** | `folder` | Added from the `@` dropdown or right-click. Label ends with `/`. |

Each pill shows the basename; hover for the full vault path. Click a **file** or **current note** pill to open the file. **Folder** pills are non-clickable in the body — you can only remove them.

Click the `×` on any pill to remove it. Removing the current-note pill detaches it from the session; pills added by you (file or folder) just disappear.

At send time, all file and folder pills (except the current note, which is sent separately) are folded into the message as `@path` and `@path/` tokens appended to your text. After the send completes, **added file and folder pills are cleared**; the current-note pill persists.

---

## The attached-context card

Every sent user message is scanned for `@`-mentions that resolve to a vault file or folder. When at least one resolves, Claudian renders an **Attached context** card above the message text:

- **Header** — paperclip icon and the label `Attached context (N)` where N is the total file + folder count.
- **One row per item** — file rows use the `file-text` icon and show the file's basename; folder rows use the `folder` icon and show the folder's basename with a trailing `/`. Hover any row for the full vault path.
- **Click a file row** to open it in a new tab. Folder rows are display-only.

The card derives from the message's stored content, so it appears identically on reload, on fork, and across every provider — no extra state to persist.

### What counts as a resolvable mention

The scanner walks the message text and, for each `@` at a mention boundary, tries the longest substring that resolves to a real vault entry first. This means:

- `@notes.md`, `@folder/file.md`, `@my notes.md` (paths with spaces) all resolve correctly.
- A trailing `/` (e.g. `@src/providers/`) marks the token as a folder explicitly.
- Trailing punctuation (`@notes.md.`, `@notes.md,`) is stripped before resolution.
- Tokens that don't resolve to a vault entry — e.g. `@someone` in `email me @someone` — are ignored. They never appear in the card.
- The same path is shown only once per card, even if mentioned multiple times.

### When the card doesn't show

- No `@`-mention in the message resolves to a vault entry.
- The message is internal "rebuilt context" injected by Claudian (e.g. compact / resume context turns) — these never render a card.
- For image-only user messages (no text), there's nothing to scan and no card.

The card is **historical**: it reflects the message text as it was sent. Renaming or deleting a file after sending won't update past cards.

---

## Removing context

| Where | How |
|-------|-----|
| **Pills (before send)** | Click the `×` on the pill. The pill is removed; the textarea is untouched. |
| **Sent message card** | Cards are derived from the sent text and are read-only. To "remove" an item, fork from an earlier point or edit upstream context, then re-send. |

---

## Typical flow

1. Right-click a folder in the file explorer → **Add folder to Claudian chat**. A folder pill appears above the input; the input is focused.
2. Optionally add more pills via the `@` dropdown (file or folder) or right-click on a file → **Add file to Claudian chat**.
3. Type your prompt and send. The pill mentions are folded into the sent message as `@path` / `@path/`.
4. The sent user bubble shows an **Attached context** card listing every resolved file and folder. Click a file row to jump to it.
5. After sending, the file and folder pills clear automatically; the current-note pill stays. Add new pills for the next turn.
