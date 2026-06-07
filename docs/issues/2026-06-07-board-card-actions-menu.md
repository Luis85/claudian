---
type: issue
id: issue-20260607-board-card-actions-menu
title: Agent Board — card hover action cluster + ⋯ overflow menu (portal-positioned)
status: done
priority: 1 - high
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - card
  - menu
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Add the hover-revealed action cluster on cards. Cluster floats absolutely at `top 8; right 9` so it never reserves width (titles keep full width). Hidden by default (`opacity 0; pointer-events:none`) until card hover/focus. Contains the single primary action as a small button + a ⋯ overflow-menu button. Cluster background `--color-base-30` + left fade shadow so it reads over the title.

Live cards (`running` / `needs_input` / `needs_approval`) keep the cluster **always visible**; the title gets `padding-right: 64px` so the persistent button never overlaps text.

Per-status primary + ⋯ menu:

| Status | Primary | ⋯ Menu |
|---|---|---|
| `inbox` | Mark ready (`check`) | Open note, Run now, Archive |
| `ready` | Run (`play`) | Open note, Back to inbox, Archive |
| `running` | Stop (danger, `square`) | Open note, Open conversation |
| `needs_input` / `needs_approval` | — (handled by reply surface) | Open note, Open conversation, Stop |
| `review` | Accept (`check`) | Rework, Open note, Open conversation, Back to inbox |
| `needs_handoff` | Send to review (`check`) | Mark failed, Open note |
| `done` | Reopen (ghost, `rotate-ccw`) | Open note, Archive |
| `failed` | Retry (`rotate-ccw`) | Open note, Archive |

Route all clicks through the existing `renderActionsFor` callbacks.

**⋯ overflow menu — important implementation note.** The menu MUST use `position: fixed` computed from the trigger button's `getBoundingClientRect()`, rendered outside the lane scroll container (portal / `document.body` append). The lane card list is an `overflow-y:auto` container; an absolutely-positioned popover taller than the card adds a vertical scrollbar to the column — that bug must not recur. Obsidian's built-in `Menu` API does NOT support this positioning model out of the box — the portal-positioned popover is **new infrastructure** built fresh in this slice (see the Cross-slice shared helpers note in the tracker; this is the first and only consumer right now).

Behavior:
- Flip the menu **upward** when it would overflow the viewport bottom.
- Close on scroll, resize, outside-click.
- Menu styling: bg `--background-secondary`, border `--border-color-hover`, `--radius-m`, `--shadow-l`; items `--font-ui-small` with a leading icon; destructive items (Stop / Mark failed / Archive) in `--color-red`.

#### Acceptance criteria

- [x] Hover or focus on idle cards reveals the action cluster; cluster hidden otherwise.
- [x] Live cards keep the cluster always visible; title gets `padding-right: 64px` so the button never overlaps text.
- [x] Primary action + ⋯ menu items match the spec table per status.
- [x] ⋯ menu renders outside the lane scroll container — opening near the bottom of a lane does NOT add a vertical scrollbar to the lane.
- [x] Menu flips upward near the viewport bottom.
- [x] Menu closes on scroll, resize, and outside-click.
- [x] Destructive items styled `--color-red`.
- [x] All clicks route through the existing `renderActionsFor` callbacks.
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-board-card-body]]
