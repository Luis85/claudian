---
type: feature
name: Agent Kanban Board
tagline: A board for things you have handed off. Inbox to done, never lost in chat history.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Chat]]"
  - "[[docs/product/features/Orchestrator]]"
  - "[[Quick Actions]]"
user_manual: "[[docs/product/user-manuals/agent-board]]"
---

# Agent Kanban Board

By Thursday you have thirty open chat tabs, a sticky note that says "ask about the lease clause", and three things you started but never finished. The draft thank-you letter, the four vacation rentals you wanted compared, the long report you meant to summarize. Chat is great for one conversation at a time. It is the wrong shape for a list of things you are working on.

**Agent Kanban Board** is a place where everything you have handed off has a home. New ideas land in the inbox, get a little detail added, run when you are ready, and wait in review so you can read the result before deciding what is next.

---

Every card on the board is a regular note in your vault. You write what you want help with and attach the documents the helper will need. You pick an engine and move the card to ready. One click starts the run, the card slides to running, and the reply streams back into the card as it arrives. When the run finishes, the card moves to review. You read the result before accepting it, asking a follow-up, or sending it on.

<!-- screenshot: board view with columns Inbox, Ready, Running, Review, Done, a running card mid-stream, and the card detail panel open on the right -->

The board and the notes are the same thing seen two ways. You can edit a card from the board, or open it as a regular Markdown file and edit it there. Both update at once. The folder belongs to you, so you can sync it, back it up, or rename it.

A card might be "draft a thank-you letter to Aunt Maria", "summarize this twelve page report", or "compare these four vacation rentals on price, distance to the beach, and reviews". The columns stay the same whatever the work is.

---

### What it does

- Track everything you have handed off through five columns: inbox, ready, running, review, done
- Save each card as a Markdown note inside the board's folder in your vault
- Run a card on the engine you choose; the reply streams back into the card as it arrives
- Link a card to the note it came from so the context and attached files travel with it
- Filter and sort by engine, status, and tag
- Turn a chat conversation into a card so the work has somewhere to live after you close the tab
- Re-open any card's saved conversation later as a chat tab when you want to follow up

### What it doesn't do

- Not a project management tool. The board tracks things you have handed off, not your team's roadmap or planning cycles.
- No assignees and no due dates. Cards belong to columns, and that is the whole model.
- Not a Trello or Linear replacement. Cards are notes in your vault first and a board second. If you want a hosted service, use one.
- No automatic prioritising. The order of cards inside a column is whatever you set.

### Goes well with

- [[docs/product/features/Orchestrator]]: send a long orchestrator run to the board as a card so you can step away while it works
- [[Chat]]: open a card as a chat tab when you want to talk it through
- [[Quick Actions]]: run a saved prompt on the active card to draft it, tidy it, or summarize it

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Agent Kanban Board**.
