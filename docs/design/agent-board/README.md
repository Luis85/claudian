# Handoff: Agent Board & Work-Order Modal redesign (+ Agents, Auto-run)

## Overview

This package redesigns two surfaces of the **Claudian Agent Board** Obsidian plugin — a Kanban board for an agent execution workflow — plus introduces an **Agents (assignee)** concept and renames the orchestrator toggle:

1. **Work-order detail modal** — was a single tall column where the action buttons scrolled off-screen. Redesigned into a **tabbed, two-pane work-item view** (à la Jira / Linear / Azure DevOps) with a sticky header and sticky footer, so primary actions are always reachable.
2. **Agent Board** — refreshed into **minimal, borderless Linear-style columns** with lightweight cards and hover-revealed actions.
3. **Agents** — work orders now carry an **assignee** ("agent persona"). There is always a built-in **Standard agent**; users create more in a separate Agents feature and assign them.
4. **"Run queue" → "Auto-run"** — the background watcher/orchestrator that auto-starts `ready` work orders is renamed to plain language and is an **OFF-by-default** toggle on every app launch.

---

## About the design files

The files in `design/` are **design references built in HTML/React (Babel JSX)** — runnable prototypes that show the intended look and behavior. **They are not production code to copy.** The plugin is **TypeScript that builds DOM imperatively** via Obsidian's API (`createDiv`, `createEl`, `Setting`, `Modal`, `setIcon`, `MarkdownRenderer`). Your job is to **recreate these designs inside the existing plugin**, reusing its patterns — not to drop React or this HTML in.

### Fidelity: **High-fidelity.** 
Colors, typography, spacing, radii, and interaction states are final. Match them. All visual values are expressed as **Obsidian native CSS variables** (`--background-primary`, `--text-muted`, `--interactive-accent`, …), which already exist in the app — use those variables, do **not** hardcode hex. The mock's `design/design-system/colors_and_type.css` only *mirrors* Obsidian's variables so the prototype renders standalone; you do not need to ship it.

---

## Target codebase — files to change

| Concern | File | What changes |
|---|---|---|
| Work-order modal | `src/features/tasks/ui/WorkOrderDetailModal.ts` | Rebuild render into header / two-pane tabbed body / sticky footer; add Agent row; drop the duplicate Title `Setting`. |
| Board renderer | `src/features/tasks/ui/AgentBoardRenderer.ts` | Borderless lanes, minimal cards, hover actions + ⋯ overflow menu, assignee avatar, rename queue toggle. |
| Board + modal CSS | `src/style/features/agent-board.css` | Replace `.claudian-work-order-modal*` and `.claudian-agent-board*` rules per specs below. |
| Task model | `src/features/tasks/model/taskTypes.ts` | Add `agent?: string` (agent id) to `TaskFrontmatter`. |
| Agents model (new) | e.g. `src/features/agents/agentTypes.ts` + store | New feature: agent personas (see **Agents** section). |
| Lane titles | `src/features/tasks/config/boardConfigTypes.ts` (`DEFAULT_LANE_TITLES`) | Unchanged; reused for status labels. |

The prototype's CSS class names are prototype-only (`.wo-*`, `.ab-*`). Keep the plugin's existing `.claudian-*` namespace; the tables below give the mapping.

---

## Design decisions (locked with the stakeholder)

- **Modal layout:** **Two-pane.** Left = main content stacked (Objective, Acceptance, then the Activity block); right = Properties sidebar. Density **regular**, acceptance progress as a **ring**. (Tabbed and stacked were explored; **two-pane is the ship target**.)
- **Title:** the modal **header IS the editable title** (click-to-edit). The old separate "Title" `Setting` row is removed.
- **Meta fields:** a **Linear-style property list** (icon + label left, value right) in the right sidebar.
- **Status color:** subtle — a colored status pill + a thin 2px accent under the header. Otherwise monochrome.
- **Icons:** Lucide stroke icons next to property labels and section headers (the plugin already bundles Lucide via `setIcon`).
- **Board cards:** minimal — title + status dot, lightened meta, hover-revealed primary action + ⋯ menu. Borderless columns.
- **Assignee:** small avatar on the card; full Agent row in the modal.
- **Auto-run:** OFF by default at startup.

---

# PART A — Work-order detail modal

Reference: `design/Work Order Modal.html` (+ `Shell.jsx`, `Modal.jsx`, `work-order.css`). The top **Preview state** switcher and the **Tweaks** panel are prototype-only scaffolding — ignore them when implementing. **Ship configuration:** **two-pane** layout, density **regular**, **status-color on**, **property-icons on**, acceptance **progress = ring**. (The prototype's `TWEAK_DEFAULTS` are already set to exactly this.)

## Frame

- **Width:** unchanged — `min(960px, 92vw)` (keep current `.claudian-work-order-modal` width).
- **Max height:** `min(86vh, 760px)`. The modal is a **flex column**: header (fixed) / body (`flex:1; overflow-y:auto; overflow-x:hidden`) / footer (fixed). Only the body scrolls.
- Background `--modal-bg`, border `1px solid --modal-border`, radius `--modal-radius` (8px), shadow `--modal-shadow`.

## 1. Header (sticky, does not scroll)

- Padding `18px 26px ~16px`; bottom border `1px solid --border-color`.
- A **2px accent line** sits on the bottom edge: a left-anchored gradient in the status color — `linear-gradient(90deg, <statusColor> 0, <statusColor> 64px, transparent 240px)`. When status-color is off, use `--border-color`.
- **Meta row** (above title, `margin-bottom 9px`, gap 12): 
  - **ID chip** — monospace, `--font-ui-smaller`, `--text-muted`, bg `--background-modifier-hover`, border `--border-color`, padding `2px 8px`, radius `--radius-m`. (e.g. `WO-204`.)
  - For `running`: a **live indicator** — pulsing dot in status color + "Started 4m ago" (`--text-muted`, `--font-ui-smaller`).
  - For `done`: a finished-at caption.
- **Title** — `font-size 21px` (compact 19 / comfy 23), `--font-bold`, `line-height --line-height-tight`, letter-spacing `-.01em`, `text-wrap: pretty`, right padding 40px (clears the close button).
  - **Editable** when status ∈ `{inbox, ready, needs_fix}`: render the title as a contenteditable element (or an inline-growing input). Hover → bg `--background-modifier-hover`; focus → bg `--input-bg` + `0 0 0 2px --color-accent-3`. On blur, if non-empty and changed, save via `onSaveFields(task, { title })`. Show a tiny "✎ Click title to rename" hint (`--text-faint`, `--font-smaller`) under it.
- **Close button** — top-right, 30×30, `x` icon, `--text-muted` → hover bg `--background-modifier-hover` + `--text-normal`.

## 2. Body — two-pane (scroll region)

`display: grid; grid-template-columns: 1fr 282px;` (main, sidebar). On `max-width: 720px` collapse to one column (sidebar drops below, divider becomes a top border).

### Left = Main column (`padding 18px 26px`, vertical stack, gap 22px)

In the shipped **two-pane** layout the main column simply **stacks** its sections top-to-bottom — **no tab bar**: **Objective**, then **Acceptance criteria**, then the **Activity block** (handoff / salvage / ledger, whichever applies to the status). Only the body scrolls, so the footer stays pinned. *(A tabbed variant exists in the prototype but is not the ship target; if you ever enable it, Overview = Objective + Acceptance and Activity = the handoff/ledger block.)*

**Section header pattern:** uppercase label, `--font-ui-smaller`, `--font-semibold`, `--text-muted`, letter-spacing `--letter-spacing-wide`, with a leading Lucide icon (`--text-faint`).

- **Objective** (icon `target`): paragraph, `--font-ui-medium`, `line-height --line-height-relaxed`, `--text-normal`. Render the markdown body the way the current modal does (`MarkdownRenderer.render`).
- **Acceptance criteria** (icon `list-checks`): header right side shows a **progress ring** (22px SVG, status-accent stroke; green `--color-green` when complete) + `done/total` count. Below, a checklist card: bordered (`--border-color`, radius `--radius-l`, bg `--background-primary-alt`), each row `padding 11px 14px`, divided by `--border-color`. Checked rows: filled green box with a white check; text → `--text-muted`. (This is the same `task-list-item` data the current modal renders — restyle it; keep `parseAcceptanceProgress`.)
- **Agent handoff** (`review` / `needs_fix`; icon `clipboard-check`): the long handoff splits into **collapsible sections** — Summary (open), Verification, Risks, Next action (open). Each is a bordered card; header is a button with a rotating `chevron-right` + a colored section icon (Summary=blue, Verification=green, Risks=orange, Next=accent) + title; expanded body shows the text (`--text-muted`, relaxed line-height, left-padded to align under the title). Parse the handoff into these four parts (the model already has `ParsedHandoff { summary, verification, risks, nextAction }` in `taskTypes.ts`).
- **Needs-handoff salvage** (`needs_handoff`): a warning **callout** (bg `--background-modifier-warning`, border `rgba(229,178,93,.25)`, radius `--radius-l`) explaining the run finished without a structured handoff, then a collapsible "Transcript tail" (monospace body).
- **Run ledger** (`failed`; icon `scroll-text`): an ordered list; each entry = status-colored dot + monospace time + message, divided by `--border-color`. (Feeds from `task.sections.ledger`.)

### Right = Properties sidebar (`border-left 1px solid --border-color; background --background-secondary; padding 18px 20px`)

Header "Properties" (`--font-ui-smaller`, `--font-semibold`, `--text-faint`, uppercase). Then **property rows**: `display:flex; justify-content:space-between; min-height 32px; padding 4px 6px; radius --radius-m`. Label (left) = icon (`--text-faint`) + text (`--font-ui-small`, `--text-muted`). Value (right) = `--font-ui-small`, `--text-normal`, right-aligned.

Rows, in order:
1. **Status** (icon `circle-dot`) → status pill (see tokens). 
2. **Agent** (icon `user`) → assignee avatar + name. **Editable** in editable states (see Agents).
3. **Provider** (icon `cpu`) → editable dropdown in editable states, else monospace text.
4. **Model** (icon `sparkles`) → editable dropdown (options depend on provider), else text.
5. **Priority** (icon `signal`) → editable dropdown, else **priority bars** (3 ascending bars filled per level) + label.
6. *divider* (`1px --border-color`, margin `10px 6px`).
7. **Created** (icon `calendar`), **Updated** (icon `clock`), **Attempts** (icon `repeat`) → muted, tabular-nums.
8. **Conversation** (icon `message-square`, only if `conversation_id`) → monospace accent link → `onOpenConversation`.

**Editable property control** (the "value chip"): borderless; on hover bg `--background-modifier-hover`; shows value + a `chevron-down`; a transparent native `<select>` overlays it for the actual picker. Wire each change to the existing `onSaveFields(task, {...})`. This replaces the current full-width `new Setting(...).addDropdown(...)` rows.

## 3. Footer (sticky)

`display:flex; justify-content:space-between; padding 12px 26px; border-top 1px solid --border-color; background --background-secondary`. Secondary (ghost) buttons left, primary right. Buttons: `--font-ui-small`, `--font-medium`, padding `7px 14px`, radius `--radius-m`, with a leading Lucide icon.

Action sets by status (icons in parentheses):

| Status | Left (ghost) | Right |
|---|---|---|
| `inbox` | Open note (`file-text`) | **Mark ready** CTA (`check`) |
| `running` | Open note, Open conversation (`message-square`) | **Stop** danger (`square`) |
| `review` | Open note, Open conversation | Rework ghost (`rotate-ccw`), **Accept** CTA (`check`) |
| `needs_handoff` | Open note, Open conversation | Mark failed danger (`triangle`), **Send to review** CTA (`check`) |
| `done` | Open note, Archive (`archive`) | Reopen ghost (`rotate-ccw`) |
| `failed` | Open note | Archive ghost (`archive`) |

Button variants: **CTA** = bg `--interactive-accent`, text `--text-on-accent`; **ghost** = transparent, hover `--background-modifier-hover`; **danger** = bg `--background-modifier-error`, border `rgba(224,82,82,.4)`, text `--color-red`, hover solid red. These map to existing `onMarkReady / onStop / onAccept / onRework / onSendToReview / onMarkFailed / onReopen / onArchive / onOpenNote / onOpenConversation` callbacks. Preserve `running` read-only behavior (no editable fields).

---

# PART B — Agent Board

Reference: `design/Agent Board.html` (+ `Board.jsx`, `board-data.jsx`, `agent-board-mock.css`). Maps to `AgentBoardRenderer.ts` + `.claudian-agent-board*` CSS. The workspace tab strip in the mock is just context — don't build it.

## Toolbar (`.claudian-agent-board-toolbar`)

Left actions, right info. **All top-row buttons are the same size** (`6px 12px`, `--font-ui-small`). 
- **Add work order** — accent CTA (`mod-cta`). *(Was larger; equalize.)*
- **Run next ready** — tool button (bg `--background-secondary`) with a `play` icon. Manual single-run; keep.
- *vertical divider* (`1px × 22px`, `--border-color`).
- **Auto-run** — the renamed queue toggle (see below).
- **Right info:** `1/3 active` (dot in `--color-yellow` with a soft ring) · `Work-order tabs 1/3 · 2 free` (`--text-faint`).

## Auto-run toggle (replaces "Run queue" / "Pause queue")

A **switch control**, not a plain button: a pill (`padding 5px 12px`, border `--border-color`, bg `--background-secondary`) containing a 28×16 track + 12px thumb and the label **"Auto-run"**. 
- **Default state = OFF on every app launch.** Do not persist ON; the board must never auto-start work on load (avoid surprising the user). The user opts in each session.
- **OFF:** track `--toggle-bg`, label `--text-muted`. **ON:** track `--color-accent`, thumb translates +12px to white, pill border `color-mix(in srgb, --color-accent 40%, transparent)`, bg `--color-accent-3`, label `--text-normal`.
- `role="switch"`, `aria-checked`. Tooltip: *"Automatically starts work orders once they reach Ready. Runs in the background."*
- **Behavior (unchanged underneath):** this drives the existing background watcher/orchestrator that programmatically picks up `ready` work orders and runs them (`QueueToolbarState.onToggle` / queue runner). It is **not** AI-driven — purely "if a slot is free and a work order is `ready`, start it." Map ON→queue running, OFF→queue paused. Keep the existing halt/failure messaging (e.g. "Queue halted: …") as a quiet caption near the toggle.

## Lanes / columns (`.claudian-agent-board-lanes`, `.claudian-agent-board-lane`)

**Borderless** by default: each column is just a header + a vertical stack of floating cards (no frame, gap 14px, fixed width ~286px, horizontal scroll for overflow).
- **Lane header:** uppercase title (`--font-ui-small`, `--font-semibold`, `--text-muted`, letter-spacing `--letter-spacing-wide`) + a **count pill** (`--font-ui-smaller`, `--text-faint`, bg `--background-modifier-hover`, radius `--radius-full`, `padding 1px 6px`).
- **Collapsible lanes** (e.g. Done): keep the existing collapse behavior. Collapsed = a 44px vertical strip (bg `--background-secondary`, border, vertical writing-mode title + count). Expand toggle is a `chevron-down`/`chevron-right` icon button. Preserve keyboard support already in `renderCollapsedLane`.
- **Add affordance:** a subtle dashed "+ Add work order" row only at the bottom of the Backlog/Inbox lane (`--text-faint`, dashed `--border-color`, hover lifts to `--text-muted`).

## Cards (`.claudian-agent-board-card`)

`padding 12px 13px; radius --radius-l; bg --background-tertiary; border 1px solid --border-color; gap 9px`. Hover: border `--border-color-hover`, bg `--color-base-30`, `--shadow-s`. Active: `translateY(1px)`. Cards open the detail modal on click (existing `onOpenDetail`); right-click = context menu (existing).

- **Title row:** a small **status dot** (8px, status color; live statuses pulse) + the title (`--font-ui-medium`, `--font-medium`, `line-height 1.35`, `text-wrap: pretty`). *Accent placement is configurable but ship **dot**.*
- **Hover action cluster** — floats **absolutely** at top-right (`top 8px; right 9px`) so it never reserves width (titles stay full-width). Hidden (`opacity 0; pointer-events:none`) until card hover/focus. Contains the **single primary action** as a small button + a **⋯ overflow menu**. Has a small bg (`--color-base-30`) + left fade shadow so it reads over the title.
  - For **live cards** (`running` / `needs_input` / `needs_approval`) the cluster is **always visible** (no hover affordance otherwise) and the title gets `padding-right: 64px` so the persistent button never overlaps text.
- **Meta row** (`display:grid; grid-template-columns:1fr auto`): left = `provider / model` (monospace `0.92em`, `--text-muted`, ellipsis) — give it the full `1fr` so it doesn't over-truncate; right = priority bars + label.
- **Footer row** (`display:flex; align-items:center; gap 10px`): the **acceptance progress** (thin 4px track + `done/total`, green when complete) takes `flex:1`; the **assignee avatar** (20px) sits at the far right. If progress is hidden/absent, a spacer keeps the avatar right-aligned.
- **Live strip** (`running` / `needs_input` / `needs_approval`): top-bordered; line 1 = freshness dot (green/amber/red by heartbeat age) + `4m 12s · attempt 1`; line 2 = last ledger line (ellipsis). Keep the existing `patchLiveStrip` / `staleTier` logic and per-tier glyph/aria-label.
- **Reply surface** (`needs_input` / `needs_approval`): top-bordered; prompt text + a text input + Send (CTA) / Stop (ghost) — or Approve / Reject for approval. When the reply surface is shown, the footer (progress + avatar) is omitted. Keep the existing reply/approve/reject wiring and the 4000-char input cap.

### Card primary action + overflow menu (by status)

| Status | Primary | ⋯ Menu |
|---|---|---|
| `inbox` | Mark ready (`check`) | Open note, Run now, Archive |
| `ready` | Run (`play`) | Open note, Back to inbox, Archive |
| `running` | Stop (danger, `square`) | Open note, Open conversation |
| `needs_input`/`needs_approval` | — (handled by reply surface) | Open note, Open conversation, Stop |
| `review` | Accept (`check`) | Rework, Open note, Open conversation, Back to inbox |
| `needs_handoff` | Send to review (`check`) | Mark failed, Open note |
| `done` | Reopen (ghost, `rotate-ccw`) | Open note, Archive |
| `failed` | Retry (`rotate-ccw`) | Open note, Archive |

These map to the existing `renderActionsFor` callbacks; the redesign just promotes one primary and tucks the rest into the ⋯ menu.

### ⋯ Overflow menu — important implementation note

The menu **must use fixed positioning computed from the trigger button's `getBoundingClientRect()`**, rendered outside the lane's scroll container (a portal/`document.body` append, or `position: fixed`). The lane card list is an `overflow-y:auto` container; an absolutely-positioned popover that is taller than the card **adds a vertical scrollbar to the column** — that was a real bug, fixed this way. Also: flip the menu **upward** when it would overflow the viewport bottom, and **close it on scroll/resize and outside-click**. Menu styling: bg `--background-secondary`, border `--border-color-hover`, radius `--radius-m`, `--shadow-l`; items `--font-ui-small` with a leading icon; destructive items (Stop/Mark failed/Archive) in `--color-red`.

---

# PART C — Agents (assignee) — new feature

Work orders gain an **assignee** called an *agent persona*. A built-in **Standard agent** always exists; users create additional personas in a dedicated **Agents feature** (out of scope here — this handoff only covers assigning + displaying them on the board/modal).

### Data model

- Add `agent?: string` (an **agent id**) to `TaskFrontmatter` in `taskTypes.ts`. Absent/unknown → resolves to `standard`.
- New agent type (e.g. `src/features/agents/agentTypes.ts`):
  ```ts
  interface AgentPersona {
    id: string;        // 'standard' is reserved/built-in
    name: string;      // e.g. 'Refactorer'
    color: string;     // an Obsidian color var, e.g. 'var(--color-purple)'
    initials?: string; // shown in the avatar for custom agents, e.g. 'RF'
    builtin?: boolean; // true only for 'standard'
    // …persona definition fields owned by the Agents feature
  }
  ```
- The built-in **Standard agent**: neutral color (`--color-base-90`), rendered with a **`cpu` (bot) icon** instead of initials.

### Avatar component

A circular chip: `border-radius 50%`, `display:inline-grid; place-items:center`, `font-weight 600`. Background = the agent's color at ~16–20% alpha (`soft`), text/icon = the agent's full color, plus a faint same-color border. Sizes: **20px** on cards, **18px** in the modal property value. Standard agent shows the `cpu` icon at ~58% of the avatar size; custom agents show `initials`. `title` = agent name (tooltip).

Sample personas used in the mock (replace with real data): Standard agent (grey, bot), Refactorer (purple, RF), Doc Writer (blue, DW), Test Engineer (green, TE), Security Auditor (orange, SA).

### Where it appears

- **Board card:** assignee avatar at footer far-right (tooltip = name). Toggle exists in the prototype ("Show assignee avatar") but ship it **on**.
- **Modal:** the **Agent** property row (under Status). Editable states show a dropdown of agent names (with the avatar in the value); read-only states show avatar + name. Persist via the same `onSaveFields(task, { agent })` path (extend `WorkOrderFieldUpdate` with `agent?: string`).

---

## Design tokens (all are existing Obsidian variables)

**Surfaces:** `--background-primary` #1e1e1e · `--background-primary-alt` #1a1a1a · `--background-secondary` #161616 · `--background-tertiary` #252525 · card-hover `--color-base-30` #2d2d2d · `--modal-bg` #1e1e1e.
**Text:** `--text-normal` #dcddde · `--text-muted` #888 · `--text-faint` #555 · `--text-on-accent` #fff.
**Lines/overlays:** `--border-color` rgba(255,255,255,.08) · `--border-color-hover` rgba(255,255,255,.15) · `--background-modifier-hover` rgba(255,255,255,.05) · `--background-modifier-active` rgba(255,255,255,.10).
**Accent:** `--interactive-accent` / `--color-accent` #00bd7e (user-overridable) · hover `--color-accent-2` #00d48c · soft `--color-accent-3` rgba(0,189,126,.15).
**Status colors:** inbox `--color-base-60` #707070 · ready/review `--color-blue` #4a8fe7 · running `--color-yellow` #e5b25d · needs_input `--color-blue` · needs_approval `--color-purple` #7c5cbf · needs_handoff/needs_fix `--color-orange` #e07d52 · done `--color-green` #00bd7e · failed `--color-red` #e05252.
**Priority colors:** urgent `--color-red` · high `--color-orange` · normal `--color-yellow` · low `--color-base-60`.
**Type:** UI font = `--font-interface` (system sans). Sizes: smaller 12 / small 13 / medium 14 / large 15. Title 21px bold. Section labels 12px semibold uppercase, letter-spacing `--letter-spacing-wide` (.02em). Monospace = `--font-monospace`.
**Radius:** `--radius-s` 2 · `--radius-m` 4 · `--radius-l` 8 · `--radius-full`. **Shadows:** `--shadow-s/-l/-modal`. **Spacing:** 4px base (4/8/12/16/24/32).
**Icons:** Lucide via `setIcon(el, name)`. Names used — `target, list-checks, clipboard-check, scroll-text, circle-dot, user, cpu, sparkles, signal, calendar, clock, repeat, message-square, chevron-down, chevron-right, x, check, square, play, rotate-ccw, triangle, file-text, archive`.

---

## Interactions & behavior

- **Modal opens** on card click; **closes** on the X, Esc, or backdrop click (existing `Modal`).
- **Inline edits** (title, agent, provider, model, priority) save on change/blur via `onSaveFields`; provider change resets model to provider default (existing logic).
- **Tabs** (modal) and **collapsible handoff sections** are local UI state — no persistence.
- **Card hover** reveals the action cluster; live/reply cards keep it persistent.
- **⋯ menu**: fixed-positioned, flips up near viewport bottom, closes on scroll/resize/outside-click. (See Part B note — prevents the column-scrollbar bug.)
- **Auto-run** toggle flips the orchestrator; **OFF at every startup**.
- **Reduced motion:** the live/pulse dot animations are gated behind `@media (prefers-reduced-motion: no-preference)` — preserve that.
- **Accessibility:** status pill/avatar carry tooltips; freshness has per-tier aria-labels (keep existing); the auto-run switch uses `role="switch"`/`aria-checked`; the editable title is keyboard-focusable.

## State management

No new global state beyond: `agent` on the task frontmatter, the Agents persona store (new feature), the modal's local tab/collapse state, and the session-scoped Auto-run boolean (defaults false). Everything else reuses the existing renderer patch methods (`patchCard`, `patchLiveStrip`, `removeCard`) and task callbacks.

## Assets

No raster assets. All icons are Lucide (already bundled). Avatars are CSS/initials/icon — no images.

## Files in this bundle (`design/`)

- `Work Order Modal.html` — runnable modal prototype (open in a browser). Toggle Tweaks to compare; **ship two-pane + regular density + status-color on + icons on + ring progress** (the prototype already defaults to this).
- `Agent Board.html` — runnable board prototype.
- Component sources: `data.jsx` (icons, status/priority/**agents** model, fixtures), `Modal.jsx` + `Shell.jsx` + `App.jsx` (modal), `board-data.jsx` + `Board.jsx` + `BoardApp.jsx` (board), `tweaks-panel.jsx` (prototype-only control panel — **do not port**).
- `work-order.css`, `agent-board-mock.css` — the prototype styles to translate into `agent-board.css`.
- `design-system/colors_and_type.css` — token reference mirroring Obsidian's native variables (reference only; don't ship).

> Reminder: these are **design references**. Recreate them in the plugin's TypeScript/DOM + `.claudian-*` CSS using Obsidian's native variables and existing callbacks — do not ship the HTML/React or the mirrored token file.
