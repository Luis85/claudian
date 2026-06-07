---
type: issue
id: issue-20260607-board-toolbar-auto-run
title: Agent Board — toolbar refresh + Auto-run switch (renames the queue toggle)
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - toolbar
  - auto-run
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Refresh the Agent Board toolbar and rename the background-watcher toggle. Equalize all top-row buttons (`padding: 6px 12px; --font-ui-small`). "Add work order" stays the accent CTA; "Run next ready" stays a tool button (bg `--background-secondary`) with a `play` icon. Drop in a 1×22 vertical divider (`--border-color`).

Replace "Run queue" / "Pause queue" with **Auto-run** — a switch-pill control (`padding 5px 12px`, border `--border-color`, bg `--background-secondary`) containing a 28×16 track + 12px thumb and the label "Auto-run". OFF state: track `--toggle-bg`, label `--text-muted`. ON state: track `--color-accent`, thumb translates +12px to white, pill border `color-mix(in srgb, --color-accent 40%, transparent)`, bg `--color-accent-3`, label `--text-normal`. `role="switch"`, `aria-checked`, tooltip "Automatically starts work orders once they reach Ready. Runs in the background."

**Auto-run must be OFF on every plugin launch.** Do not persist ON across reloads — the user opts in each session. The toggle drives the existing **background watcher**: ON → watcher running, OFF → watcher paused (unchanged underneath via `QueueToolbarState.onToggle`). Preserve the existing halt/failure caption (e.g. "Queue halted: …") as a quiet caption near the toggle (the caption keeps the historical "Queue" wording until that string is rekeyed in the i18n sweep).

Right-side info reads `N/M active` (dot in `--color-yellow` with soft ring) · `Work-order tabs N/M · K free` (`--text-faint`).

#### Acceptance criteria

- [ ] All top-row toolbar buttons share size (`padding 6px 12px; --font-ui-small`).
- [ ] "Add work order" remains the accent CTA; "Run next ready" remains a tool button with `play` icon.
- [ ] Auto-run switch renders with OFF visual (track `--toggle-bg`, label `--text-muted`) AND ON visual (track `--color-accent`, thumb translated +12px to white, pill bg `--color-accent-3`, label `--text-normal`).
- [ ] Auto-run starts OFF after every plugin reload, regardless of prior session state.
- [ ] Switching ON resumes the background watcher; switching OFF pauses it (existing wiring unchanged).
- [ ] Switch carries `role="switch"`, `aria-checked` reflects state, tooltip present.
- [ ] Right-info caption shows active count + tab count + free slots; halt caption preserved when watcher reports failure.
- [ ] Auto-run switch thumb transition gated behind `@media (prefers-reduced-motion: no-preference)`.
- [ ] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

None — can start immediately.
