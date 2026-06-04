---
type: feature
name: Chat
tagline: A workspace beside your notes that already knows what you're looking at and what you've highlighted.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Quick Actions]]"
  - "[[Multi Provider Support]]"
  - "[[docs/product/features/Orchestrator]]"
user_manual: "[[docs/product/user-manuals/chat]]"
---

# Chat

You're in a note. The next sentence won't come, or a paragraph in front of you needs rephrasing or a second opinion. Switching to a browser tab to ask a chatbot means losing the thread of what you were doing.

**Chat** opens beside your notes like a co-worker pulled up to your desk. It reads the file you're on, sees the text you've highlighted, and writes back into the vault when you ask it to.

---

The sidebar opens on a hotkey. The path of the note you're on goes in automatically. So does the text you've selected, if there is any. You can pull in other files with `@` mentions or drop in images by paste, and they go in as images, not text descriptions.

Conversations stick around. Specorator saves the session under `.specorator/sessions/` so you can leave one open for weeks, jump back in tomorrow, or split it into two when one line of thinking deserves its own branch.

<!-- screenshot: chat sidebar open beside a note, with a selection highlighted and quoted in the chat composer -->

When the co-worker rewrites a paragraph you selected or fills in a section of a draft, you choose how the change lands. The change can arrive in the chat with preview, apply, and discard buttons for you to accept or reject. Flip on YOLO mode and the co-worker writes directly while you watch.

---

### What it does

- Opens beside the note you're on, on a hotkey, already loaded with the file path and what you've highlighted
- Takes `@` mentions for other vault files, folders, or images
- Streams replies inline with stop and resume controls
- Saves every conversation as a session file under `.specorator/sessions/` so you can resume it later
- Reloads past conversations from your Specorator session store
- Splits any message into a fresh branch that keeps the history above it intact
- Preview and approve each change before it lands, or skip that step with YOLO mode on
- Attaches images by paste, drag, or `@` mention

### What it doesn't do

- Chat is not a document editor. Suggested edits arrive as previews you accept, not as silent writes while the reply is still streaming.
- Background runs are not supported. The chat tab runs in the foreground. For parallel work, see [[docs/product/features/Orchestrator]].
- Web search is not built in. Providers with their own search use it; others do not.
- Capabilities differ per provider. See [[Multi Provider Support]] for the side-by-side comparison.

### Goes well with

- [[Quick Actions]]: store prompts you use daily and fire them into the active chat with one tap
- [[Multi Provider Support]]: open new chat tabs on whichever providers you have access to, side by side
- [[docs/product/features/Orchestrator]]: when one chat isn't enough, hand the work off to several runs at once

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Chat**.
