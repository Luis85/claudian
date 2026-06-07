# Co-Worker - Chat Product Copy Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Chat feature to "Co-Worker - Chat" across all product docs and rewrite copy to center the co-worker identity.

**Architecture:** Pure docs change — no code, no tests. Rename `Chat.md`, rewrite its content, update wikilinks in 3 sibling feature docs.

**Tech Stack:** Markdown, YAML frontmatter, Obsidian wikilinks.

---

## Files

| Action | Path |
|--------|------|
| Create (replaces Chat.md) | `docs/product/features/Co-Worker - Chat.md` |
| Delete | `docs/product/features/Chat.md` |
| Modify | `docs/product/features/Quick Actions.md` |
| Modify | `docs/product/features/Agent Kanban Board.md` |
| Modify | `docs/product/features/Multi Provider Support.md` |

---

### Task 1: Create Co-Worker - Chat.md

**Files:**
- Create: `docs/product/features/Co-Worker - Chat.md`

- [ ] **Step 1: Write the new file**

Full content:

```markdown
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
user_manual: "[[chat]]"
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
```

- [ ] **Step 2: Verify file exists**

Run: `ls "docs/product/features/Co-Worker - Chat.md"`
Expected: file listed, no error.

---

### Task 2: Delete old Chat.md

**Files:**
- Delete: `docs/product/features/Chat.md`

- [ ] **Step 1: Delete the file**

Run:
```bash
rm "docs/product/features/Chat.md"
```

- [ ] **Step 2: Verify deleted**

Run: `ls docs/product/features/`
Expected: `Chat.md` absent, `Co-Worker - Chat.md` present.

---

### Task 3: Update Quick Actions.md

**Files:**
- Modify: `docs/product/features/Quick Actions.md`

Two changes:

- [ ] **Step 1: Update frontmatter `parent` field**

In `docs/product/features/Quick Actions.md`, line 13:

Old:
```
parent: "[[Chat]]"
```
New:
```
parent: "[[Co-Worker - Chat]]"
```

- [ ] **Step 2: Update Goes well with wikilink**

In `docs/product/features/Quick Actions.md`, Goes well with section:

Old:
```
- [[Chat]]: quick actions fire into the active chat tab, which decides the provider and the context
```
New:
```
- [[Co-Worker - Chat]]: quick actions fire into the active co-worker session, which decides the provider and the context
```

- [ ] **Step 3: Verify**

Run: `grep -n "Chat" "docs/product/features/Quick Actions.md"`
Expected: no bare `[[Chat]]` remaining — only `[[Co-Worker - Chat]]` and plain-text "chat" references.

---

### Task 4: Update Agent Kanban Board.md

**Files:**
- Modify: `docs/product/features/Agent Kanban Board.md`

Two changes:

- [ ] **Step 1: Update frontmatter `related` field**

In `docs/product/features/Agent Kanban Board.md`, frontmatter:

Old:
```
  - "[[Chat]]"
```
New:
```
  - "[[Co-Worker - Chat]]"
```

- [ ] **Step 2: Update Goes well with wikilink**

Old:
```
- [[Chat]]: open a card as a chat tab when you want to talk it through
```
New:
```
- [[Co-Worker - Chat]]: open a card as a co-worker session when you want to talk it through
```

- [ ] **Step 3: Verify**

Run: `grep -n "\[\[Chat\]\]" "docs/product/features/Agent Kanban Board.md"`
Expected: no matches.

---

### Task 5: Update Multi Provider Support.md

**Files:**
- Modify: `docs/product/features/Multi Provider Support.md`

Two changes:

- [ ] **Step 1: Update frontmatter `related` field**

In `docs/product/features/Multi Provider Support.md`, frontmatter:

Old:
```
  - "[[Chat]]"
```
New:
```
  - "[[Co-Worker - Chat]]"
```

- [ ] **Step 2: Update Goes well with wikilink**

Old:
```
- [[Chat]]: the chat surface looks and feels the same across all four providers; the matrix shows what actually differs
```
New:
```
- [[Co-Worker - Chat]]: the chat surface looks and feels the same across all four providers; the matrix shows what actually differs
```

- [ ] **Step 3: Verify**

Run: `grep -n "\[\[Chat\]\]" "docs/product/features/Multi Provider Support.md"`
Expected: no matches.

---

### Task 6: Final verification + commit

- [ ] **Step 1: Check no stale [[Chat]] wikilinks remain in feature docs**

Run:
```bash
grep -rn "\[\[Chat\]\]" docs/product/features/
```
Expected: no output.

- [ ] **Step 2: Confirm new file renders clean**

Run: `head -20 "docs/product/features/Co-Worker - Chat.md"`
Expected: YAML frontmatter with `name: Co-Worker - Chat` and `tagline: Your co-worker in the sidebar. Always there. Ready for anything.`

- [ ] **Step 3: Commit**

```bash
git add "docs/product/features/Co-Worker - Chat.md"
git add "docs/product/features/Quick Actions.md"
git add "docs/product/features/Agent Kanban Board.md"
git add "docs/product/features/Multi Provider Support.md"
git rm "docs/product/features/Chat.md"
git add docs/superpowers/specs/2026-06-07-co-worker-chat-design.md
git add docs/superpowers/plans/2026-06-07-co-worker-chat.md
git commit -m "docs: rename Chat to Co-Worker - Chat, rewrite product copy

Centers co-worker identity across all feature docs. Updates wikilinks
in Quick Actions, Agent Kanban Board, and Multi Provider Support."
```
