---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[sidepanel-chat]]"
---
# Claudian — Chat

This manual covers the **chat sidebar**: the workspace where you talk to a provider beside your notes. The sidebar opens on a hotkey, picks up the note you're on and any selected text, and saves every conversation as a Specorator session you can resume tomorrow.

For the high-level feature pitch see [[sidepanel-chat]]. For how attached files and folders appear above the composer see [[composer-context-pills]]. For drafting before running, see [[plan-mode]]. For durable background handoffs see [[agent-board]]. For a side-by-side decision guide, see [[chat-vs-agent-board]].

---

## Before you start

- At least one provider enabled in **Settings → Specorator → General → Providers**. Each provider needs its CLI installed — see [[install-claude]], [[install-codex]], [[install-cursor]], or [[install-opencode]].
- A hotkey bound to **Open Chat** in Obsidian's Hotkeys settings (optional but recommended). The default ribbon icon also opens the chat view.

The chat view position is controlled by **Settings → Specorator → General → Display → Open Claudian in**: **Right sidebar** (default), **Left sidebar**, or **Main editor tab**.

---

## When chat is the right place

Use chat when you want quick, foreground collaboration with the assistant:

- Ask about the current note or selection.
- Draft, rewrite, summarize, compare, or explain something now.
- Work through a messy idea before you know the exact task.
- Try a provider or model without setting up a work order.

If the conversation turns into work that needs priority, acceptance criteria, background-style running, or a review record, create a work order and move it to the [[agent-board|Agent Board]].

---

## Opening a chat

Three ways, all open the same view:

- The Specorator ribbon icon.
- The Obsidian command **Open Chat** (bind a hotkey for fastest access).
- The command palette entry **Specorator: New Tab**.

A new tab opens already loaded with the note you were editing as a context pill, plus any selected text quoted in the composer.

---

## Picking a provider and model

Each chat tab is bound to one provider for its lifetime. The tab header shows the active provider and model; click either to switch:

- **Provider switcher** — lists every enabled provider. Choosing a new one opens a fresh tab (existing tabs do not migrate).
- **Model picker** — lists models offered by the active provider. Selection is per-tab; new tabs use the provider's default.

To switch providers mid-conversation, open a new tab.

---

## Sending a message

Type in the composer and press **Enter** (or **Ctrl/Cmd+Enter** if **Require Command/Ctrl+Enter to send** is on in General → Input).

The composer supports three special prefixes:

| Prefix | What it does |
|--------|--------------|
| `@` | Attach a vault file, folder, or MCP server to this turn. See [[composer-context-pills]] for how attachments render. |
| `/` | Open the slash-command picker (provider-specific — Claude full, Codex none, Opencode runtime-discovered, Cursor none). |
| `$` | Open the skill picker (Claude + Codex + Opencode where supported). |
| `#` | Instruction mode — facts the helper should always carry into this conversation. |
| `!` | Bash mode (Claude, off by default — enable in **Settings → Claude → Experimental**). |

Quick Actions stored as vault notes fire from the lightning-bolt picker. See [[quick-actions]].

---

## Reading replies

Replies stream inline. The toolbar gives you:

- **Stop** — cancel the in-flight turn.
- **Resume** — re-attach to a streaming session if you switched away.
- **Auto-scroll** — follows the latest token (toggle in **Settings → General → Display**).

Plan mode shows the plan inline before any write-side tool runs; see [[plan-mode]] for the approval card flow.

Tool calls render as labeled blocks (file edits, bash output, web fetches, etc.). Expand a block to see the full payload.

Every sent **user** message also exposes a small per-message toolbar — thumbs-up / thumbs-down feedback on assistant replies, **Create work order** on assistant replies, and **Capture as quick action** (the `bookmark-plus` icon) on user prompts. The capture button opens the inline editor pre-seeded with the prompt body; see [[quick-actions]] for the full flow.

---

## Edits to your notes

When the agent rewrites a passage you selected or fills in a section, the change can arrive two ways depending on the **Safe mode** for the active provider:

- **Preview** (default) — the change shows as a card with **Preview**, **Apply**, and **Discard** buttons. Nothing lands until you confirm.
- **YOLO mode** — the change writes directly. Use this only when you trust the run.

Safe mode is per-provider; see the provider tab in settings. Plan mode forces preview-style approval regardless of Safe mode.

---

## Forks (split a conversation)

Right-click any user or assistant message and pick **Fork from here**. A new chat tab opens with the history up to that point intact, ready for a different direction.

Fork is supported on Claude and Codex. Not supported on Opencode or Cursor.

---

## Sessions and resume

Every conversation is saved as a session file under `.specorator/sessions/` (Specorator-owned, provider-neutral). Sessions survive Obsidian restarts.

- **Resume a session** — open the session list from the chat tab header dropdown, click a row.
- **Provider-native history** — Claude (`~/.claude/projects/<vault>/`), Codex (`~/.codex/sessions/`), Cursor (`~/.cursor/chats/<workspace>/`) keep their own transcripts. Specorator hydrates from these when you reload a session.

Closing a tab does not delete the session. The session list is the source of truth.

---

## Tab limits

Concurrent chat tabs are capped by **Settings → General → Display → Maximum chat tabs** (3–10, default 3). Above 5 a warning appears about memory impact.

---

## Context-usage meter

The small bar next to the input shows the active conversation's context-window occupancy. Hover for the full tooltip.

**Tooltip format:** `<used> / <window>` — for example `50k / 200k`. Token counts use these tiers:

- `<1k`: raw integer (`500`).
- `1k–10k`: one decimal (`1.3k`, `7.4k`).
- `10k–1M`: integer k (`50k`, `170k`).
- `≥1M`: one decimal M (`1.0M`, `1.5M`).

**Cost suffix:** When the provider reports a per-turn cost in USD, the tooltip appends `· $<amount>` rounded to four decimals — e.g. `50k / 200k · $0.0042`. Only Opencode emits cost on the wire today; other providers omit the suffix.

**Approaching-limit reminder:** Past 80% the tooltip appends ` (Approaching limit, run \`/compact\` to continue)` and the bar gains a warning style.

**Persistence on cancel:** Cancelling a turn mid-stream still persists the last `usage` chunk received before the cancel, so the meter survives a re-open.

**Recovery from history:** Re-opening a conversation whose `.specorator/sessions/<id>.meta.json` is missing recovers the most recent usage from the provider's own transcript (Claude `~/.claude/`, Codex `~/.codex/`, Opencode SQLite store, Cursor `~/.cursor/`).

---

## Reference

| Path / location | Notes |
|-----------------|-------|
| `.specorator/sessions/*.meta.json` | Provider-neutral session metadata. |
| `~/.claude/projects/<vault>/*.jsonl` | Claude-native transcripts (hydrated on resume). |
| `~/.codex/sessions/**/*.jsonl` | Codex-native transcripts. |
| `~/.cursor/chats/<workspace>/<session>/` | Cursor-native transcripts. |
| **Settings → Specorator → General → Display** | Tab position, tab limit, auto-scroll, math rendering. |
| **Settings → Specorator → General → Input** | Submit-key behavior, Vim-style navigation. |
| **Settings → Specorator → General → Hotkeys** | Inline Edit, Open Chat, New Session, New Tab, Close Tab. |
