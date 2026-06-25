---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Agent Kanban Board]]"
---
# Agent Board — Chat Interop & Capture

This manual covers how to turn ideas, notes, selections, and chat into **work orders** on the Agent Board, run them, and jump back to the chat conversation a work order came from.

A **work order** is a Markdown note (`type: specorator-work-order`) that the Agent Board tracks through a set of status lanes. Capture creates these notes from many places; interop links them back to chat.

Capture is the bridge from low-ceremony chat to managed work. Start in [[sidepanel-chat|Co-Worker Chat]] when you want to think out loud or get a quick draft. Create a work order when the result should be queued, prioritized, run later, reviewed, or kept as a durable handoff record. For the full decision guide, see [[chat-vs-agent-board]].

---

## Before you start

Set these once in **Settings → Specorator → Agent Board**:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Work order folder** | Where new work orders are created. | `Agent Board/tasks` |
| **Default provider** | Provider stamped on captured work orders (e.g. `claude`, `codex`). | — |
| **Default model** | Model stamped on captured work orders. | — |

If **Default provider** or **Default model** is unset, capture is blocked with a notice. Set both first.

Open the board from the **ribbon** (`Open Agent Board`, kanban icon) or the command palette.

---

## Status lanes

A work order moves through these statuses:

`inbox` → `ready` → `running` → (`needs_input` / `needs_approval`) → `review` → (`needs_fix`) → `done`
(plus `failed` and `canceled`).

- **Captured work orders land in `inbox`** — a triage lane. They are *not* auto-run.
- **`ready`** is the only status **Run next ready** will pick up. Promote an `inbox` order to `ready` when it's scoped and good to go.

---

## Capturing work orders

All capture entry points create a work-order note in your **Work order folder** using your default provider/model.

### From a note or folder (file menu)
Right-click a file or folder in the file explorer → **Create work order**.
- The note/folder name becomes the title.
- A `Source note: [[…]]` (or `Source folder: …`) link is added to the work order's **Context**.

### From the current note (command)
Command palette → **Create work order from current note**.

### From an editor selection
Select text in a note, then either:
- Right-click → **Create work order from selection**, or
- Command palette → **Create work order from selection**.

The first line of the selection becomes the title (truncated). The full selection is blockquoted into **Context**, with a link back to the source note. Lands in **`inbox`**.

### From a browser selection
Select text in a Specorator chat browser view (e.g. Surfing), then run command palette → **Create work order from browser selection**.

The page title (or first line) becomes the title. The selection is blockquoted into **Context** with a `Source: [title](url)` link. Lands in **`inbox`**.

---

## Promoting chat into work orders (interop)

### From a single chat message
Hover an **agent** (assistant) message in the Specorator chat panel — a **Create work order** button (kanban icon) appears in the message toolbar. Capture the agent's reply (a plan, a summary, a proposed fix) as the thing you want to act on later.

- The agent's response text becomes the work order's **Objective**. (Tool-only turns with no prose have no button.)
- The first line becomes the title.
- The chat **conversation id** is written to the work order's `conversation_id` — this is the durable link back to chat.
- Lands in **`inbox`**.

### From the whole conversation
Command palette → **Create work order from current chat conversation**.

- The conversation title becomes the work order title.
- `conversation_id` links the work order to that conversation.
- Lands in **`inbox`**.

> The link is one Markdown field: `conversation_id` on the work-order note. No chat-side state is persisted, so the link survives reloads.

---

## Reopening the linked conversation

Open a work order on the board to show its detail view. If the work order has a `conversation_id` (i.e. it was promoted from chat), an **Open conversation** button appears.

Click it to:
1. Open/activate the Specorator chat panel, and
2. Reopen the linked conversation by its id.

This is the round trip: chat → work order → back to the same chat.

---

## Running work orders

### Run a single work order
On the board, click **Run** on any work order card, or **Run** in its detail view.

### Run the next ready one
Click **Run next ready** in the board toolbar, or command palette → **Run next ready work order**.

Selection rule:
1. Only **`ready`** work orders are eligible (`inbox`, `running`, etc. are skipped).
2. Among ready ones, **higher priority wins** (`urgent` > `high` > `normal` > `low`).
3. Ties break by **oldest `created`** first.

If nothing is ready, you get a notice: *"No ready work orders to run."*

> A run needs a free chat tab. If all tabs are full, the board warns you — close a chat tab or raise **Maximum tabs** in settings.

---

## Command reference

| Command | What it does |
|---------|--------------|
| **Create work order** | Empty work order in the work order folder. |
| **Create work order from current note** | Links the active note as source. |
| **Create work order from selection** | Blockquotes the editor selection (also in the editor right-click menu). |
| **Create work order from browser selection** | Blockquotes a chat browser-view selection. |
| **Create work order from current chat conversation** | Promotes the active conversation; sets `conversation_id`. |
| **Run next ready work order** | Runs the highest-priority, oldest `ready` work order. |

Per-message **Create work order** button lives in the chat agent-message toolbar (not the command palette).

---

## Typical flow

1. While chatting, hit the **Create work order** button on an agent reply you want to act on later → it lands in **`inbox`** with the conversation linked.
2. Open the board, review the `inbox` order, scope it, set priority, move it to **`ready`**.
3. Click **Run next ready** — the board picks the top `ready` order and runs it in a free chat tab.
4. From the work order's detail view, click **Open conversation** any time to jump back to the original chat.
