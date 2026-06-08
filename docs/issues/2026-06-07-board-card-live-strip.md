---
type: issue
id: issue-20260607-board-card-live-strip
title: Agent Board — card live strip restyle (freshness dot + ledger tail)
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - card
  - live-strip
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Restyle the live strip that appears on `running` / `needs_input` / `needs_approval` cards. Top-bordered band on the card body.

- Line 1: freshness dot (green / amber / red by heartbeat tier) + caption `Nm Ys · attempt N`.
- Line 2: last run-ledger line, ellipsis-truncated.

Reuse the existing `patchLiveStrip` and `staleTier` logic, the per-tier glyph (●/◐/◯), and the per-tier aria-label. Pulse on the freshness dot gated by `@media (prefers-reduced-motion: no-preference)`.

#### Acceptance criteria

- [x] Live strip renders for live statuses (`running`, `needs_input`, `needs_approval`) and is absent for all others.
- [x] Freshness tier color + glyph + aria-label preserved from the current implementation.
- [x] Attempt counter + last ledger line wired to the existing data sources (no new state).
- [x] Pulse animation suppressed when the user prefers reduced motion.
- [x] Live strip continues to update via `patchLiveStrip` (no full re-render on heartbeat).
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-board-card-body]]
