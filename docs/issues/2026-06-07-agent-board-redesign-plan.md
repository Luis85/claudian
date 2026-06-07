---
type: tracker
id: issue-20260607-agent-board-redesign-plan
title: Agent Board + Work-Order modal redesign — tracking plan
status: done
priority: 1 - high
triage: tracker
created: 2026-06-07
updated: 2026-06-07
related:
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - tracker
  - redesign
relations:
  - agent-board
---

#### Parent

[[docs/design/agent-board/README]] — design brief for the Work-Order modal redesign, Agent Board refresh, Agents persona, and Auto-run rename. (The brief's own filename uses the word "handoff" generically; this tracker uses "design brief" to keep the domain term **Handoff** — the run-result artifact written to a Work order — unambiguous.)

#### Scope

Single index for the 14 tracer-bullet vertical slices that deliver the four-part redesign. Each slice is independently demoable; this issue tracks aggregate progress. Each linked issue owns its own spec + acceptance criteria.

#### Slices

**Modal (Part A):**
- [x] [[2026-06-07-modal-frame-sticky-shell]]
- [x] [[2026-06-07-modal-header-title-meta]] — needs frame
- [x] [[2026-06-07-modal-properties-sidebar]] — needs frame
- [x] [[2026-06-07-modal-objective-acceptance]] — needs frame
- [x] [[2026-06-07-modal-activity-block]] — needs objective+acceptance
- [x] [[2026-06-07-modal-footer-actions]] — needs frame

**Board (Part B):**
- [x] [[2026-06-07-board-toolbar-auto-run]]
- [x] [[2026-06-07-board-lanes-refresh]]
- [x] [[2026-06-07-board-card-body]] — needs lanes
- [x] [[2026-06-07-board-card-actions-menu]] — needs card body
- [x] [[2026-06-07-board-card-live-strip]] — needs card body

**Agents (Part C):**
- [x] [[2026-06-07-agents-persona-seam]] — needs properties sidebar + card body

**Cross-cutting:**
- [x] [[2026-06-07-agent-board-redesign-i18n-sweep]] — needs all visual slices
- [x] [[2026-06-07-agent-board-redesign-a11y-audit]] — needs all visual slices

#### Cross-cutting rules (apply to every slice)

- CSS namespace stays `.claudian-*` (prototype `.wo-*` / `.ab-*` are reference only).
- Visual values via Obsidian native CSS variables (`--background-primary`, `--text-muted`, `--interactive-accent`, …). **No hardcoded hex AND no hardcoded `rgba(...)` literals** — soft / alpha shades go through `color-mix(in srgb, var(--color-X) N%, transparent)` against an Obsidian color variable.
- DOM via Obsidian API (`createDiv`, `createEl`, `setIcon`, `MarkdownRenderer`, `Setting`, `Modal`). No `innerHTML` / `outerHTML` / `insertAdjacentHTML` (lint-enforced).
- Lucide icons via `setIcon(el, name)`.
- Every visual slice (1–12) keys its own new user-visible strings through the existing i18n helper; the i18n sweep ([[2026-06-07-agent-board-redesign-i18n-sweep]]) is a closing audit, not the first place strings land.
- Every visual slice (1–12) gates its own pulse / live / transition animations behind `@media (prefers-reduced-motion: no-preference)`; the a11y audit ([[2026-06-07-agent-board-redesign-a11y-audit]]) is a closing verification, not the first place gating lands.
- Existing renderer patch methods (`patchCard`, `patchLiveStrip`, `removeCard`) and task callbacks reused. No new global state beyond the `agent` frontmatter field, the Agents persona registry, and the session-scoped Auto-run boolean (defaults false).
- Every CSS-touching slice names its root class (`.claudian-work-order-modal*`, `.claudian-agent-board-lane*`, `.claudian-agent-board-card*`, etc.) so reviewers can verify namespace scope.

#### Visual token contract

The design brief locks the following maps. Every slice that touches these surfaces reads the value from these tables — not from ad-hoc choices.

**Status → color** (used on status pills, status dots, accent gradients, ledger entry dots):

| Status | Token |
|---|---|
| `inbox` | `--color-base-60` |
| `ready` | `--color-blue` |
| `running` | `--color-yellow` |
| `needs_input` | `--color-blue` |
| `needs_approval` | `--color-purple` |
| `review` | `--color-blue` |
| `needs_handoff` | `--color-orange` |
| `needs_fix` | `--color-orange` |
| `done` | `--color-green` |
| `failed` | `--color-red` |
| `canceled` | `--color-base-60` |

**Priority → color** (used on priority bars + labels):

| Priority | Token |
|---|---|
| `0 - urgent` | `--color-red` |
| `1 - high` | `--color-orange` |
| `2 - normal` | `--color-yellow` |
| `3 - low` | `--color-base-60` |

#### Naming

To avoid drift across the card and the modal:

- **Assignee slot** = the 20px avatar surface on the card footer's far right (owned by [[2026-06-07-board-card-body]], filled by [[2026-06-07-agents-persona-seam]]).
- **Agent property** = the editable row in the modal sidebar (owned by [[2026-06-07-modal-properties-sidebar]], filled by [[2026-06-07-agents-persona-seam]]).
- Both bind to `TaskFrontmatter.agent`, resolved through `resolvePersona(id?)`. Absent / unknown → Standard.

#### Cross-slice shared helpers

Three helpers are introduced by whichever slice lands first and reused by the others — call them out in the implementing PR so the second consumer does not re-implement:

- **Section header pattern** (uppercase label + Lucide icon + `--text-faint`). First consumer: [[2026-06-07-modal-objective-acceptance]]. Reused by [[2026-06-07-modal-activity-block]].
- **Editable value chip overlay** (borderless value + chevron + transparent native `<select>`). First consumer: [[2026-06-07-modal-properties-sidebar]]. Reused by [[2026-06-07-agents-persona-seam]] for the Agent dropdown.
- **Portal-positioned popover** (`position: fixed` + `getBoundingClientRect()` trigger, viewport-flip, close-on-scroll/resize/outside-click). New infrastructure — Obsidian's built-in `Menu` API does NOT support this — built fresh in [[2026-06-07-board-card-actions-menu]].

#### Non-goals

The design brief explores several toggles in the prototype; the **ship configuration is locked**. The following are NOT shipped:

- No density toggle. Ship: **regular** density only (`compact` 19px / `comfy` 23px title variants from the brief are prototype-only and not shipped).
- No "status-color off" mode. Ship: status-color **on**.
- No "property-icons off" mode. Ship: property icons **on**.
- No ring-vs-bar acceptance progress switcher. Ship: **ring** in modal, **bar** on card.
- No "Show assignee avatar" toggle. Ship: assignee avatar **always on**.
- No `WO-204`-style prefix decision baked into a setting — the brief uses `WO-204` as an illustrative example; we use whatever `TaskFrontmatter.id` already produces.
- Prototype artifacts NOT ported (and must not appear in the plugin): the `Preview state` switcher, the `Tweaks` panel, `TWEAK_DEFAULTS`, `tweaks-panel.jsx`, `design/design-system/colors_and_type.css`, and the prototype CSS class names `.wo-*` / `.ab-*`.
- No new Agents creation UI. This redesign ships only the Standard built-in persona + the assignment seam. Custom persona creation is a separate feature (deferred).

#### Acceptance criteria

- [x] All 14 child issues closed.
- [x] `npm run typecheck && npm run lint && npm run test && npm run build` green at completion.
- [x] [[2026-06-07-agent-board-redesign-i18n-sweep]] and [[2026-06-07-agent-board-redesign-a11y-audit]] both report zero open gaps.

#### Blocked by

None — tracker entry point.

#### Polish history

- 2026-06-07 — post-publication review pass (4 parallel reviewers: granularity / spec fidelity / codebase feasibility / consistency). Synthesized fixes: renamed "design handoff" → "design brief" (avoid collision with domain **Handoff**); added Visual token contract + Naming + Cross-slice shared helpers + Non-goals sections; tightened cross-cutting rules to forbid `rgba(...)` literals and require per-slice i18n + reduced-motion discipline; replaced vague "high fidelity" acceptance criterion with concrete sweep / audit references. Concrete child fixes applied in parallel to `board-lanes-refresh` ("Backlog" → "Inbox"), `board-toolbar-auto-run` (background watcher terminology + reduced-motion AC), `modal-footer-actions` + `modal-activity-block` (rgba → color-mix), `modal-header-title-meta` (`contenteditable="plaintext-only"`), `i18n-sweep` (tightened audit method), `board-card-actions-menu` (dropped `bug-fix` tag), all 12 visual slices (uniform i18n AC), `board-card-body` (status→color spec + concrete ellipsis), `modal-objective-acceptance` (main column container padding + gap), `agents-persona-seam` (`WriteFieldsOptions.agent` extension flagged).
