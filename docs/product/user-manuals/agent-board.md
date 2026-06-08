---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Agent Kanban Board]]"
---
# Claudian — Agent Board

The Agent Board is a kanban-style view for **work orders**: Markdown notes (`type: claudian-work-order`) that Claudian tracks through a set of status lanes and runs through a fresh chat tab. This manual covers the base board — opening it, the work-order note structure, the default lanes, the detail view, and running.

Capture (creating work orders from chat, selections, browser pages, file menus) is covered in [[agent-board-chat-interop-and-capture]]. Templates that prefill a work order's body are covered in [[work-order-templates]]. For the high-level choice between live chat and managed handoffs, see [[chat-vs-agent-board]].

Use chat when you want to work through something immediately. Use the Agent Board when the work should become a durable handoff: scoped, prioritized, queued, run as a tracked item, and reviewed before you call it done.

---

## Before you start

Set these in **Settings → Claudian → General → Agent Board**:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Work order folder** | Folder where new Agent Board work orders are created. | `Agent Board/tasks` |
| **Archive folder** | Folder where archived work orders are moved. Keep it outside the work order folder. | `Agent Board/archive` |
| **Default provider** | Provider used to run new work orders (e.g. `claude`, `codex`). | — |
| **Default model** | Model used to run new work orders. | — |

If **Default provider** or **Default model** is unset, creation is blocked with a notice (*"Set an Agent Board default provider in settings first."* / *"Set an Agent Board default model in settings first."*). Pick both before you start.

A separate setting controls how many chat tabs Claudian will keep open at once:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Maximum chat tabs** | Caps concurrent chat tabs (3-10). A run needs a free tab — the board warns when none are left. | `3` |

---

## Opening the board

Two equivalent entry points:

- **Ribbon** — click the kanban icon labelled **Open Agent Board**.
- **Command palette** → **Open Agent Board**.

The board opens in a workspace tab (not the chat sidebar). The header shows three controls: **Add work order**, **Run next ready**, and a **Chat tabs `used/max · N free`** counter. When the counter hits zero the board adds an inline hint: *"No free chat tabs. A work order run needs a free tab — close a chat tab in the chat panel, or raise 'Maximum tabs' in settings."*

The board re-indexes the Work order folder whenever a note in it is created, modified, deleted, or renamed, and whenever board settings change. It also updates the chat-tabs counter as you open and close chat tabs.

---

## Work-order anatomy

A work order is a Markdown note Claudian writes into the Work order folder. The file name is `task-<timestamp>-<slug>.md` based on the title.

### Frontmatter

```yaml
---
type: claudian-work-order
schema_version: 1
id: task-20260528-example
title: "Example work order"
status: ready
priority: normal
created: 2026-05-28T18:00:00+02:00
updated: 2026-05-28T18:00:00+02:00
provider: codex
model: gpt-5-codex
run_id:
conversation_id:
sidepanel_tab_id:
started:
finished:
attempts: 0
---
```

You own `title`, `priority` (`low | normal | high | urgent`), and the body. Claudian owns `id`, `status`, `created`, `updated`, the run fields, and `conversation_id` (set when the order was promoted from chat). Unknown frontmatter keys are preserved.

### Body sections

```markdown
## Objective
What the agent should accomplish.

## Acceptance Criteria
- [ ] Define what "done" means.

## Context
Source notes, files, scope.

## Constraints
- Keep direct chat behavior intact.
- Do not modify unrelated files.

## Run Ledger

<!-- claudian:run-ledger-start -->
<!-- claudian:run-ledger-end -->

## Result / Handoff

<!-- claudian:handoff-start -->
<!-- claudian:handoff-end -->
```

Keep the four `##` headings — the run prompt reads them by name, and a missing heading just produces an empty section. The **Run Ledger** and **Result / Handoff** regions are *generated*: Claudian writes between the marker comments and nowhere else. Don't edit inside the markers; everything else is yours.

Acceptance Criteria task-list items (`- [ ]` / `- [x]`) drive a small progress bar on the card and the count next to the **Acceptance criteria** heading in the detail view.

---

## Status lanes

The board lays out one lane per status, left-to-right, in this order:

`inbox` → `ready` → `running` → `needs_input` → `needs_approval` → `review` → `needs_fix` → `done` → `failed` → `canceled`

Lane titles in the UI are: **Inbox, Ready, Running, Needs input, Needs approval, Review, Needs fix, Done, Failed, Canceled**. Key rules:

- Captured work orders land in **Inbox** — a triage lane that is *not* auto-run.
- **Ready** and **Needs fix** are picked up by **Run next ready** (see [[agent-board-chat-interop-and-capture]] for the selection rule). `needs_fix` cards are treated as runnable so a reworked order can be queued without per-card intervention.
- **Running** is reached only by clicking **Run**. The board enforces one active run per work order.
- **Review** is reached only after a run produces a valid `<claudian_handoff>` block. A missing or malformed handoff sends the card to **Failed** instead.
- **Failed** and **Canceled** cards keep their ledger and can be reopened to **Ready**.

---

## Adding a work order

Click **Add work order** in the board header. A **template picker modal** opens — pick **Blank work order** for the empty skeleton or any saved template to prefill body, provider, model, and priority. See [[work-order-templates]] for the picker, the starter set, and authoring your own templates.

Work orders created from the board's **Add work order** button land in **Inbox** and immediately open the detail view so you can scope them. Work orders created from the **Create work order** command palette entry land in **Ready** instead.

---

## Detail view

Clicking any card opens the **work-order detail modal**. What it shows depends on status:

| Status | Editable fields | Read-only fields | Action buttons |
|--------|-----------------|------------------|----------------|
| `inbox` | Title, provider, model, priority | — | Edit, Open conversation*, **Mark ready** |
| `ready` / `needs_fix` | Title, provider, model, priority | — | Edit, Open conversation*, **Run** |
| `running` | — | Status, provider, model, priority | Edit, Open conversation*, **Stop** |
| `review` | Title, provider, model, priority | — | **Open note**, Open conversation*, **Accept**, **Rework** |
| `needs_fix` | Title, provider, model, priority | — | Edit, Open conversation*, **Run**, and shows the **Handoff** from the prior run when present |
| `done` | Title, provider, model, priority | — | Edit, Open conversation*, **Reopen**, **Archive** |
| `failed` / `canceled` | Title, provider, model, priority | — | Edit, Open conversation*, **Archive** |

*Open conversation appears only when the work order has a `conversation_id` and the linked conversation still exists. See [[agent-board-chat-interop-and-capture]] for the chat round-trip.

The body of the modal renders **Objective** and **Acceptance criteria** (with the `done/total` count when checkboxes are present). On `review` and `needs_fix`, the modal also renders the **Handoff** block from the prior run (when present), so the reviewer can see what the agent delivered before deciding to run again. On Failed, it renders the **Run ledger** so you can see why the run failed. Editable field changes save on dropdown change / text blur and refresh the board.

**Reopen** moves a `done` card back to **Inbox** so it can be re-scoped and re-run. It only appears for `done`.

**Archive** moves the note into the **Archive folder** so it leaves the board's scanned folder. It appears for terminal statuses (`done`, `failed`, `canceled`).

---

## Right-click menu

Right-clicking a work-order card opens a context menu. Left-click still opens the detail modal — the right-click menu is an extra surface for quick navigation and quick actions against the WO note.

The menu has up to four kinds of entry:

| Entry | When it shows | What it does |
|-------|---------------|--------------|
| **Open note** | Always | Opens the work-order Markdown note in a new tab. |
| **Open conversation** | When the WO has a `conversation_id` AND that conversation still exists | Switches to the linked chat tab (same gate as the detail modal). |
| **Quick-action favorites** | Quick-action favorites exist AND the menu's quick-action block is shown (see below) | Runs the favorite against the WO note — identical to right-clicking a vault file. |
| **Quick actions** | When the quick-action block is shown | Opens the Quick actions picker with the WO note attached as the target file. |

The **quick-action block** (favorites + picker) is hidden when either of:

- the work order is **running** — avoids surprise side-prompts on an active run, and
- the WO note path no longer resolves to a real file — covers deleted, moved, or shadowed-by-folder cases.

`needs_input` and `needs_approval` keep the quick-action block — only `running` hides it. See [[quick-actions]] for how to author favorites and what the picker does.

---

## Running

### A single work order

From a card, the inline action button reads **Run** on `ready` / `needs_fix`, **Stop** on `running`, **Mark ready** on `inbox`, and **Accept** / **Rework** on `review`. The detail view offers the same actions.

A run validates provider/model against the provider registry (disabled providers and unknown models fail fast), writes `status: running` with a `Run started.` ledger entry, opens a fresh chat tab bound to a new conversation, forces the work order's provider/model, and auto-sends the rendered task prompt. On a valid `<claudian_handoff>` block in the final response, Claudian writes the **Handoff** region and transitions to **Review** with a `Handoff written.` ledger entry. On a missing/malformed handoff, the card moves to **Failed**; on stop, to **Canceled**. The chat tab stays open after the run — streaming and tool use are fully visible.

### Run next ready

Click **Run next ready** in the header or run command palette → **Run next ready work order**. Picks the highest-priority, oldest `ready` work order; shows *"No ready work orders to run."* if none qualify. See [[agent-board-chat-interop-and-capture]] for the full selection rule and the chat round-trip.

> A run needs a free chat tab. If all tabs are full, close one in the chat panel or raise **Maximum chat tabs** in settings.

---

## Command reference

| Command | What it does |
|---------|--------------|
| **Open Agent Board** | Opens or focuses the board in a workspace tab. Also fires from the ribbon. |
| **Create work order** | Opens the template picker, then creates a work order (defaults to `ready`). |
| **Create work order from current note** | Picker + active-note source link. |
| **Run next ready work order** | Activates the board and runs the highest-priority, oldest `ready` work order. |

Capture commands (selection, browser selection, message promotion, conversation promotion) and the chat **Create work order** message-toolbar button live in [[agent-board-chat-interop-and-capture]]. Template authoring commands live in [[work-order-templates]].

---

## Typical flow

1. Open the board (ribbon or command).
2. Click **Add work order**, pick **Blank work order** (or any template) → the new card opens in the detail view.
3. Fill **Objective**, draft **Acceptance criteria** as task-list items, drop the source/scope into **Context**, click **Mark ready**.
4. Click **Run** on the card (or **Run next ready** in the header). Claudian opens a fresh chat tab and streams the agent's reply.
5. When the agent ends with a valid `<claudian_handoff>` block, the card moves to **Review**. Open the detail view, read the **Handoff** block, then click **Accept** (→ `done`) or **Rework** (→ `needs_fix`). Clicking **Rework** opens a reason prompt — describe what the agent should fix. The reason appears under **Rework Notes** in the next run prompt so the agent receives concrete feedback. The prior **Handoff** block stays visible in the detail modal while the card sits in `needs_fix`.
6. On terminal statuses, **Archive** moves the note out of the board folder. From `done`, **Reopen** moves the card back to **Inbox** for re-scoping or re-running.
