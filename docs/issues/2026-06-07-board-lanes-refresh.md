---
type: issue
id: issue-20260607-board-lanes-refresh
title: Agent Board — borderless lanes + new lane header
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - lanes
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Restyle Agent Board lanes to borderless: each lane is just a header + a vertical stack of floating cards (no frame), gap 14, fixed width ~286px, with horizontal scroll for overflow.

Lane header = uppercase title (`--font-ui-small`, `--font-semibold`, `--text-muted`, letter-spacing `--letter-spacing-wide`) + a count pill (`--font-ui-smaller`, `--text-faint`, bg `--background-modifier-hover`, `--radius-full`, padding `1px 6px`).

Collapsed lanes (e.g. Done) keep the existing collapse behavior: a 44px vertical strip (bg `--background-secondary`, border, vertical-writing-mode title + count). Expand toggle is a `chevron-down` / `chevron-right` icon button. Preserve the keyboard support already shipped in `renderCollapsedLane` (`tabindex="0"`, Enter/Space toggle, `aria-expanded` reflects state).

Add a subtle dashed "+ Add work order" row only at the bottom of the **Inbox** lane (`--text-faint`, dashed `--border-color`, hover lifts to `--text-muted`). Triggers the existing add-work-order flow. (The design brief uses "Backlog/Inbox" interchangeably; the lane vocabulary in [[CONTEXT]] names only **Inbox** — match that.)

Card visuals stay untouched in this slice — they get rebuilt in [[2026-06-07-board-card-body]].

#### Acceptance criteria

- [ ] Lanes render borderless with the new uppercase header + count pill.
- [ ] Lane width fixed near 286px; horizontal scroll engages when lane count exceeds viewport.
- [ ] Collapsed lane strip + chevron toggle preserved; Enter/Space + `aria-expanded` still work.
- [ ] Dashed "+ Add work order" affordance appears only in the Inbox lane and triggers the existing add flow.
- [ ] `.claudian-agent-board-lane*` CSS rewritten per spec; no hardcoded hex; all values via Obsidian variables.
- [ ] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

None — can start immediately.
