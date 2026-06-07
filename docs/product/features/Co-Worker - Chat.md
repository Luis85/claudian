---
type: feature
name: Co-Worker - Chat
tagline: Your co-worker in the sidebar. Always there. Ready for anything.
status: shipped
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Quick Actions]]"
  - "[[Multi Provider Support]]"
user_manual: "[[sidepanel-chat]]"
image: "[[chat-sidepanel-overview.png]]"
---

# Co-Worker - Chat

You have a co-worker. They sit in the sidebar, know what you're working on, and never ask you to switch tabs or repeat yourself. Whether you're writing code, putting together a report, planning next week, or trying to get one paragraph unstuck — they're already there.

**Co-Worker - Chat** opens beside whatever note you're on. It reads the file, sees what you've highlighted, and writes back into the vault when you ask it to.

---

The sidebar opens on a hotkey. The path of the note you're on goes in automatically. So does the text you've selected. Pull in other files with `@` mentions or drop in images by paste — they go in as images, not descriptions.

Conversations stick around. Every session saves under `.specorator/sessions/` so you can leave one open for weeks, jump back in tomorrow, or split it into two when one line of thinking deserves its own branch.

![[chat-sidepanel-overview.png]]
<!-- screenshot: chat sidebar open beside a note, with a selection highlighted and quoted in the chat composer -->

When your co-worker rewrites a paragraph or fills in a draft section, you choose how the change lands. Preview, apply, and discard — accept or reject before anything touches the note. Flip on YOLO mode and they write directly while you watch.

---

### What it does

- Opens beside the note you're on, already loaded with the file path and what you've highlighted
- Takes `@` mentions for other vault files, folders, or images
- Streams replies inline with stop and resume controls
- Saves every conversation under `.specorator/sessions/` so you can resume later
- Reloads past conversations from your session store
- Splits any message into a fresh branch that keeps history above it intact
- Preview and approve each change before it lands, or skip that step with YOLO mode
- Attaches images by paste, drag, or `@` mention

### What it doesn't do

- Not a document editor. Suggested edits arrive as previews you accept, not silent writes mid-stream.
- Background runs belong on the [[Agent Kanban Board]]; Co-Worker - Chat runs in the foreground.
- Web search is not built in. Providers with their own search use it; others don't.
- Capabilities differ per provider. See [[Multi Provider Support]] for the side-by-side.

### Goes well with

- [[Quick Actions]]: store prompts you use daily, fire them into the active co-worker session with one tap
- [[Multi Provider Support]]: open new tabs on whichever providers you have access to, side by side
- [[Agent Kanban Board]]: track larger handoffs outside the chat tab

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Co-Worker - Chat**.
