---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Agent Kanban Board]]"
---
# Claudian — Agent Board configurable lanes

This manual covers how to customize the Agent Board's **lanes** (status columns): rename them, reorder them, add or remove them, hide them, change which statuses each lane shows, and attach per-lane **Definition of ready** / **Definition of done** notes that get injected into the run prompt.

A **lane** is a column on the Agent Board. Each lane displays the work orders whose `status` is mapped to it. Out of the box the board shows ten lanes, one per status. The lane editor lets you collapse multiple statuses into one column, drop columns you never use, and add house rules for when a work order should enter or leave a lane.

The internal status set never changes — only how lanes group, label, and order those statuses on the board.

---

## Before you start

The lane editor lives in **Settings → Claudian → Agent Board → Board lanes**, below the work-order folder, template folder, default provider, and default model controls.

Edits save on change. After every change Claudian writes `agentBoardConfig` into `.claudian/claudian-settings.json` and refreshes every open Agent Board view immediately — there is no Save button and no reload step.

> If the config in storage is structurally broken (two lanes sharing the same id, or a lane missing its id or title — see [How lane changes affect existing work orders](#how-lane-changes-affect-existing-work-orders)), the board falls back to the default ten lanes and shows a board notice. Your stored config is not deleted — fix the offending lane in the editor and the board returns to your layout. Soft issues such as the same status assigned to two lanes do not trigger the fallback; the lane editor flags the duplicate inline and the board surfaces a notice while continuing to use your layout.

---

## Lane anatomy

Each lane has these fields, exposed as one block in the editor:

| Field | What it means | Editor control |
|-------|--------------|----------------|
| **Title** | The column heading shown on the board. | Text input (top of the lane block). |
| **Visible** | Whether the lane appears on the board. Hidden lanes still own their statuses, but their work orders surface in **Unsorted** (see below). | Toggle next to the title. |
| **Statuses** | Which internal statuses route into this lane. One lane can claim many statuses (e.g. `review` + `needs_fix`). A status can belong to **only one** lane. | Ten checkboxes, one per status, shown in the order: `inbox`, `ready`, `running`, `needs_input`, `needs_approval`, `review`, `needs_fix`, `done`, `failed`, `canceled`. |
| **Definition of ready** | Free-text checklist of what a card should satisfy before it enters this lane. Shown beneath the lane header on the board, under the label **Ready when**. Injected into the run prompt as guidance when the lane's status matches the running work order. | Textarea, one entry per line; blank lines are dropped. |
| **Definition of done** | Free-text checklist of what a card should satisfy before it leaves this lane. Shown on the board under **Done when**. Injected into the run prompt under `## Definition of Done`. | Textarea, one entry per line. |

Lanes also carry an internal **id** generated automatically (a timestamp-based string for new lanes, the status name for default lanes). The id is not shown in the editor and you don't need to manage it.

> Definition of ready / Definition of done are **guidance only**. They are appended to the run prompt under `## Definition of Ready` and `## Definition of Done` sections, but they grant no permissions and are not enforced as checklists.

---

## Default lanes

The shipped defaults reproduce the original board exactly: ten visible lanes, one per status, in this order.

| # | Title | Statuses | Visible |
|---|-------|----------|---------|
| 1 | Inbox | `inbox` | yes |
| 2 | Ready | `ready` | yes |
| 3 | Running | `running` | yes |
| 4 | Needs input | `needs_input` | yes |
| 5 | Needs approval | `needs_approval` | yes |
| 6 | Review | `review` | yes |
| 7 | Needs fix | `needs_fix` | yes |
| 8 | Done | `done` | yes |
| 9 | Failed | `failed` | yes |
| 10 | Canceled | `canceled` | yes |

All default lanes ship with empty Definition of ready / Definition of done. For the underlying run pipeline (capture → `inbox` → `ready` → run → `review` → `done`) see [[agent-board-chat-interop-and-capture]].

---

## Editing lanes

Open **Settings → Claudian → Agent Board → Board lanes**. Each lane appears as its own block with the controls below.

### Rename a lane
Type a new value into the lane's **Title** text input. The board column header updates as soon as the change is persisted.

### Reorder lanes
Each lane block has **Move up** (up-arrow) and **Move down** (down-arrow) extra buttons next to the visible toggle. Click them to swap the lane with its neighbour. Order on the board matches the editor order, top to bottom in settings → left to right on the board.

### Hide a lane
Toggle **Visible** off on the lane block. The lane disappears from the board. Any work order whose status was claimed by that lane will surface in the implicit **Unsorted** catch-all lane (see [How lane changes affect existing work orders](#how-lane-changes-affect-existing-work-orders)).

### Change which statuses a lane shows
Tick or untick any of the ten status checkboxes on the lane block. Checking a status moves it into that lane; unchecking removes it. A status that ends up unchecked in **every** lane will appear in **Unsorted** whenever a work order has that status.

To group, for example, **Review** and **Needs fix** into one column: edit the Review lane, also tick `needs_fix`, then remove the Needs fix lane (see below).

### Add a lane
Click **Add lane** at the bottom of the lane editor. A new lane appears at the end with title `New lane`, no statuses checked, visible toggled on, and empty Definition of ready / Definition of done. Rename it, tick the statuses it should claim, and reorder it if needed.

### Remove a lane
Each lane block has a **Remove lane** (trash) extra button. Clicking it deletes the lane immediately. Work orders whose statuses were claimed only by that lane appear in **Unsorted** until you assign those statuses to another lane.

### Edit Definition of ready / Definition of done
The two textareas at the bottom of each lane block accept one bullet per line. Blank lines are stripped. The contents show under the lane header on the board (labelled **Ready when** / **Done when**) and are injected into the run prompt for any work order whose status maps to that lane.

---

## Resetting to defaults

At the bottom of the lane editor, next to **Add lane**, is a **Reset to default** button (styled as a warning). Click it to replace your config with the ten default lanes in the original order, with empty Definition of ready / Definition of done. There is no undo — back up your custom lanes if you might want them later.

---

## How lane changes affect existing work orders

Lane edits never rewrite work-order notes. They only change how the board displays them. The internal status set (ten statuses) and the state machine are unchanged, so capture flows, the **Run** action, and **Mark ready** keep working exactly as before.

A few specific cases:

- **A work order's status has no visible lane** (lane hidden, lane removed, or status unchecked everywhere): the work order appears in an implicit **Unsorted** lane appended at the end of the board. A board notice reads *"Some work orders have a status with no visible lane and appear under 'Unsorted'."*
- **You assign the same status to two visible lanes**: both lanes keep your edit so the board does not lose your in-progress layout. The lane editor highlights the duplicate checkbox in warning colour and shows an inline *"Routed to '…'"* hint naming the lane that actually owns routing (the first visible lane in the editor order). The board surfaces a notice like *"Status \"review\" is mapped to more than one lane."* Uncheck the duplicate from whichever lane you do not want to own the status to clear the warning, or drag the lane that should own it above the others. Hidden lanes do not participate in routing and never show the warning, even if they list the same status.
- **You give two lanes the same id**: same fallback as the duplicate-status case, with a *"Lane id \"…\" is used by more than one lane."* notice. The editor generates fresh ids for new lanes, so this normally only happens if you hand-edit `agentBoardConfig` in `.claudian/claudian-settings.json`.
- **A lane is missing a title or id**: same fallback, with a notice naming the offending lane.
- **A lane references an unknown status string** (e.g. from a hand-edited config): the unknown status is dropped silently with a warning notice; the rest of the lane is kept.

The **Unsorted** lane only appears when it has work orders, never empty, and is always placed last on the board.

---

## Typical flow

1. Open **Settings → Claudian → Agent Board → Board lanes**.
2. Rename the lanes you actually use (e.g. **Inbox** → **Triage**, **Ready** → **Todo**).
3. Collapse **Review** + **Needs fix** into a single lane titled **In review**: tick both statuses on the Review lane, then click **Remove lane** on the now-empty Needs fix block.
4. Hide **Failed** and **Canceled** to keep the board focused on live work — work orders in those states will show in **Unsorted** when they exist.
5. On the **Todo** lane, add a Definition of ready like `Objective is one sentence` and `Acceptance criteria are checklists`. The next time you run a work order from that lane, those lines are appended to the run prompt under `## Definition of Ready`.
6. If the layout gets messy, click **Reset to default** to start over.
