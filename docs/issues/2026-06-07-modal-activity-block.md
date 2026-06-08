---
type: issue
id: issue-20260607-modal-activity-block
title: Work-order modal — Activity block (handoff sections + needs_handoff salvage + failed Run ledger)
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - modal
  - handoff
  - run-ledger
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Status-driven activity section that follows Objective + Acceptance in the left main column. Reuse the shared section header pattern from [[2026-06-07-modal-objective-acceptance]].

**Agent handoff** (`review` / `needs_fix`; section icon `clipboard-check`). Parse via the existing `ParsedHandoff { summary, verification, risks, nextAction }` shape from `taskTypes.ts`. Render as four collapsible bordered cards:

| Section | Open by default | Section icon color |
|---|---|---|
| Summary | yes | blue |
| Verification | no | green |
| Risks | no | orange |
| Next action | yes | accent |

Each card header is a button with a rotating `chevron-right` + the colored section icon + the section title. Expanded body shows the text (`--text-muted`, relaxed line-height, left-padded to align under the title). Collapsible state is local UI only — not persisted.

**Needs-handoff salvage** (`needs_handoff`): warning callout (bg `--background-modifier-warning`, border `color-mix(in srgb, var(--color-orange) 25%, transparent)`, `--radius-l`) explaining the run finished without a structured handoff. Below the callout, a collapsible "Transcript tail" block in monospace.

Ledger dot colors read from the status → color contract in [[2026-06-07-agent-board-redesign-plan]].

**Run ledger** (`failed`; section icon `scroll-text`): ordered list, each entry = status-colored dot + monospace time + message, divided by `--border-color`. Feeds from `task.sections.ledger`.

Other statuses render no activity block.

#### Acceptance criteria

- [x] Handoff parses via `ParsedHandoff`; section sequence is Summary → Verification → Risks → Next action.
- [x] Summary and Next action collapsibles default open; Verification and Risks default closed.
- [x] Section icon colors match the table above; chevron rotates on expand.
- [x] Needs-handoff callout renders only for `needs_handoff`; transcript tail block collapsible.
- [x] Run ledger renders only for `failed`; reads from `task.sections.ledger`; dots use status colors via Obsidian variables.
- [x] Collapsible state is local UI only and not persisted.
- [x] No `rgba(...)` literals — alpha shades go through `color-mix(in srgb, var(--color-X) N%, transparent)`.
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-objective-acceptance]]
