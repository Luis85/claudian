---
type: issue
id: issue-20260607-board-card-body
title: Agent Board — minimal card body + acceptance progress footer + assignee slot
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
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Rebuild `.claudian-agent-board-card` to Linear-style minimal: `padding 12px 13px`, `--radius-l`, bg `--background-tertiary`, `1px --border-color`, gap 9.

Hover: border `--border-color-hover`, bg `--color-base-30`, `--shadow-s`. Active: `translateY(1px)`.

**Title row** — small status dot (8px, color read from the status → color contract in [[2026-06-07-agent-board-redesign-plan]]; live statuses pulse) + title (`--font-ui-medium`, `--font-medium`, `line-height 1.35`, `text-wrap: pretty`). Pulse gated by `@media (prefers-reduced-motion: no-preference)`.

**Meta row** — `display:grid; grid-template-columns:1fr auto`. Left = `provider / model` monospace `0.92em`, `--text-muted`, ellipsis — give it the full `1fr` so it does not over-truncate. Right = priority bars (3 ascending bars filled per level) + label, color from priority spec.

**Footer row** — `display:flex; align-items:center; gap 10px`. Left = acceptance progress (4px track + `done/total`, derived from existing `parseAcceptanceProgress`; green at 100%), `flex:1`. Far right = a reserved 20px assignee avatar slot — leave it as an empty placeholder in this slice (filled by [[2026-06-07-agents-persona-seam]]). If progress is hidden/absent, a spacer keeps the avatar slot right-aligned.

**Reply surface** (`needs_input` / `needs_approval`) restyled per spec: top-bordered, prompt text + text input + Send (CTA) / Stop (ghost) — or Approve / Reject for approval. When the reply surface is shown, the footer (progress + slot) is omitted. Preserve existing reply / approve / reject wiring and the 4000-char input cap.

Cards still open the detail modal on click; right-click still triggers the existing context menu.

Live strip and hover action cluster ship in their own slices: [[2026-06-07-board-card-live-strip]] and [[2026-06-07-board-card-actions-menu]].

#### Acceptance criteria

- [x] Card frame matches spec (padding, radius, bg, border, hover/active states).
- [x] Title row shows status dot + title; live statuses pulse the dot (reduced-motion respected).
- [x] Meta row layout `1fr auto`; provider/model truncates with `overflow: hidden`, `white-space: nowrap`, `text-overflow: ellipsis`; priority bars + label render right-aligned with priority colors from the contract in [[2026-06-07-agent-board-redesign-plan]].
- [x] Footer renders acceptance progress (4px track + `done/total`, green at 100%) + reserved 20px assignee slot at far right.
- [x] When acceptance progress absent/hidden, spacer keeps the assignee slot right-aligned.
- [x] Reply surface restyle preserves wiring + 4000-char cap; footer omitted while reply visible.
- [x] Card click opens detail modal; right-click opens context menu.
- [x] No hardcoded hex; all colors via Obsidian variables; status + priority colors read from the contract in [[2026-06-07-agent-board-redesign-plan]].
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-board-lanes-refresh]]
