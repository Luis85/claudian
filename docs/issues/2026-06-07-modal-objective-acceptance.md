---
type: issue
id: issue-20260607-modal-objective-acceptance
title: Work-order modal — Objective + Acceptance progress ring + checklist card
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
  - acceptance-criteria
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Restyle the left main column's top two sections under the shared section header pattern. This slice also lands the main-column container styling shared by every section that follows it: `padding 18px 26px`, vertical stack with gap `22px`.

**Section header pattern** (also reused by [[2026-06-07-modal-activity-block]]): uppercase label, `--font-ui-smaller`, `--font-semibold`, `--text-muted`, letter-spacing `--letter-spacing-wide`, with a leading Lucide icon (`--text-faint`).

**Objective** (icon `target`): paragraph, `--font-ui-medium`, `line-height --line-height-relaxed`, `--text-normal`. Render markdown via `MarkdownRenderer.render` (as today).

**Acceptance criteria** (icon `list-checks`):
- Section-header right side shows a 22px SVG **progress ring** (status-accent stroke, switching to `--color-green` at 100%) + `done/total` count.
- Below: a checklist card — bordered (`--border-color`, `--radius-l`, bg `--background-primary-alt`); each row `padding 11px 14px`, rows divided by `--border-color`. Checked rows show a filled green box + white check, text in `--text-muted`. Continue to reuse `parseAcceptanceProgress` for the counts.
- Read-only restyle: no new markdown writes — this slice does not change how acceptance criteria are mutated.

#### Acceptance criteria

- [x] Section header pattern in place (uppercase label + Lucide icon + `--text-faint`).
- [x] Objective markdown renders via `MarkdownRenderer.render`; Wikilinks, inline code, and links remain interactive.
- [x] Progress ring renders `done/total` and turns `--color-green` at 100%.
- [x] Checklist card restyled per spec; checked rows visually distinct without color cue (white check glyph carries the signal).
- [x] `parseAcceptanceProgress` continues to drive counts (no parser changes).
- [x] No hardcoded hex; SVG ring colors via Obsidian CSS variables.
- [x] Main-column container ships with `padding 18px 26px` and `gap 22px` so follow-up slices stack into it without re-layout.
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]]
