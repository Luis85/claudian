---
title: Agent Board Redesign — Accessibility & Reduced-Motion Audit (slice 14)
date: 2026-06-07
status: complete
scope: Agent Board redesign slices 1-12 (src/features/tasks/ui, src/features/agents, agent-board.css, work-order-modal.css)
---

# Agent Board Redesign — Accessibility & Reduced-Motion Audit

Final cross-cutting verification pass over the Agent Board redesign (slices
1-12). Each per-slice change shipped its own a11y/reduced-motion plumbing; this
slice rigorously re-verifies every checklist item end-to-end, fixes the two gaps
found, and leaves behind a reproducible guard
(`tests/unit/features/tasks/ui/agentBoardA11yReducedMotion.test.ts`) plus added
behavioral coverage so the verification is not a one-off.

## Result summary

- **10 checklist items verified.** 8 were already compliant; **2 had genuine
  gaps** (item #8 modal time-caption tabular-nums; item #9 status-pill tooltip),
  both **fixed in this PR**.
- Reduced motion: all 3 pulse `animation:` declarations confirmed inside
  `@media (prefers-reduced-motion: no-preference)` blocks; no ungated animation
  exists in either stylesheet.
- A reproducible CSS/ARIA guard locks both invariants and is proven to fail on
  regression (an injected ungated `animation:` and a removed `role="menuitem"`
  each trip it).

## Per-checklist-item verification

Evidence paths are absolute-from-repo-root `file:line`.

| # | Item | Outcome | Evidence |
|---|------|---------|----------|
| 1 | Reduced motion gates every pulse/live animation; non-motion visuals intact | VERIFIED | `src/style/features/agent-board.css:373-377` (card status-dot pulse), `:621-627` (live-strip freshness-dot pulse), `src/style/features/work-order-modal.css:94-98` (modal header live-dot pulse). All 3 `animation:` props sit inside `@media (prefers-reduced-motion: no-preference)`. Color/glyph/layout are set outside the media blocks (e.g. dot color `agent-board.css:359-369`, freshness glyph set in JS `AgentBoardRenderer.ts:947-949`), so reduced motion suppresses only motion. Transitions are likewise gated (`agent-board.css:181,510,863`; `work-order-modal.css:145,187,300,423,613`). |
| 2 | Auto-run switch: `role="switch"`, `aria-checked`, tooltip, keyboard-operable | VERIFIED | `src/features/tasks/ui/AgentBoardRenderer.ts:417` (`role:'switch'`), `:419` (`aria-checked` reflects `on`), `:420-422` (tooltip on both `title` + `aria-label`), `:436` (single click handler; native `<button>` synthesizes click on Enter/Space — no double-toggle). |
| 3 | Editable modal title: focusable; Esc cancels (reverts to committed); Enter blurs to commit; hint visible only in editable states; IME guard | VERIFIED | `src/features/tasks/ui/WorkOrderDetailModal.ts:273-275` (`contenteditable=plaintext-only` + `tabindex=0`), `:304-306` (Enter → `preventDefault` + blur), `:307-310` (Esc → `setText(committed)` + blur, no save), `:303` (IME `isComposing` guard), `:265-270` early-return for non-editable BEFORE the hint is created at `:313-314`, so the "✎ rename" hint renders ONLY in editable states. Locked by `WorkOrderDetailModal.test.ts` ("reverts on Escape", "commits on Enter", "hides the rename hint in a non-editable state"). |
| 4 | Properties value chips keyboard-operable via transparent `<select>`; chevron decorative (`aria-hidden`); label carries accessible name (not chevron) | VERIFIED | `src/features/tasks/ui/editableValueChip.ts:52` (chevron `aria-hidden='true'`), `:56` (native `<select>` overlay — keyboard-operable), `:76-83` options carry the same label text as the visible `labelEl`, so the select's accessible name = selected-option label (the chevron, being `aria-hidden`, contributes nothing). |
| 5 | Card status dot + freshness dot: per-tier `aria-label` (Fresh/Stale/Very stale); non-color glyph cue; status dot not color-only | VERIFIED | Freshness dot: `AgentBoardRenderer.ts:947` per-tier glyph `●/◐/◯` (non-color cue), `:950` per-tier `aria-label` via `staleAriaLabel` (`:995-1000`). Status dot: `:653-658` `aria-label` + `title` = status name (text cue, not color-only); status is further conveyed by the lane grouping and the per-status action labels. Locked by `AgentBoardRenderer.test.ts` ("preserves the %s freshness tier color class, glyph, and aria-label"). |
| 6 | Collapsed lanes keyboard-toggleable: Enter/Space toggle, `aria-expanded`, in tab order | VERIFIED | Expanded-lane toggle is a native `<button>` (`AgentBoardRenderer.ts:497-503`, `aria-expanded='true'`). Collapsed strip is `role="button"` so it carries `tabindex='0'` (`:551`) + a keydown handler for Enter/Space (`:562-567`) + `aria-expanded='false'` (`:547`). Locked by `AgentBoardRenderer.test.ts` ("preserves Enter/Space keyboard activation and aria-expanded on the collapsed strip"). |
| 7 | Action cluster + ⋯ menu: trigger has accessible name; `role="menu"`/`menuitem`; Esc/outside-click/item-select close; focus returns to trigger on ALL three close paths | VERIFIED (added item-select coverage) | Trigger `aria-label` + `aria-haspopup='menu'` (`AgentBoardRenderer.ts:794`). Portal: `role='menu'` (`portalPopover.ts:84`), `role='menuitem'` (`:96`). `close()` returns focus to the trigger (`:152`) for every path: Esc (`:122-127`), outside-click mousedown (`:116-120`), and item-select (`:103-107` calls `close()` before `run()`). Esc + outside-click focus-return were already tested; **item-select focus-return added** in `AgentBoardRenderer.test.ts` ("closes on item-select and returns focus to the trigger"). |
| 8 | Tabular-nums on Created/Updated/Attempts and ALL time-based captions (card live strip, modal started/finished) | FIXED | Created/Updated/Attempts: `work-order-modal.css:823-825` (`prop-num`). Card live strip caption: `agent-board.css:579-585` (`live-strip--meta`). **Gap:** modal started/finished captions (`header-live`/`header-sub`) embed digit-bearing relative times (`formatRelativeTime` → "5m"/"30s", `utils/date.ts:40-55`) but lacked `tabular-nums`. **Fix:** added `font-variant-numeric: tabular-nums` to `work-order-modal.css:77-86`. |
| 9 | Tooltips on status pill, assignee avatar, ID chip (full name / id) | FIXED | Assignee avatar `title` + `aria-label` (`agentAvatar.ts:34-35`). ID chip `title` + `aria-label` (`WorkOrderDetailModal.ts:221-222`). **Gap:** the status pill (`renderStatusPill`) had no tooltip. **Fix:** added `pill.setAttr('title', status)` at `WorkOrderDetailModal.ts:815`, matching the ID-chip/avatar convention. Locked by `WorkOrderDetailModal.test.ts` ("colors the Status pill ... and carries a status tooltip"). |
| 10 | Keyboard walkthrough: open card → edit title → tab properties → footer actions → close, all mouse-free | VERIFIED | See walkthrough below. Every interactive node is natively focusable/operable: contenteditable title (`WorkOrderDetailModal.ts:273-275`), native `<select>` chips (`editableValueChip.ts:56`), `<button>` footer actions (`:1000-1004`), `<button>` close (`:199-204`), and the Modal's built-in Esc-to-close. |

## Keyboard walkthrough (manual trace, mouse-free)

1. **Open a card** — board cards are reachable; the per-card primary + ⋯ are
   native `<button>`s. (The Modal is the focus context once open.)
2. **Edit the title** — the title is `contenteditable=plaintext-only`
   `tabindex=0`; Tab/Shift+Tab reach it, typing edits, Enter commits (blur),
   Esc reverts to the committed value. Hint visible only here.
3. **Tab through the properties** — Provider / Model / Priority / Agent are
   transparent native `<select>`s overlaying each chip; Tab lands on each and
   the arrow keys / type-ahead pick an option (`change` persists). Created /
   Updated / Attempts are static text (skipped, correctly).
4. **Reach the footer actions** — every footer action is a real `<button>`
   (ghost/cta/danger); Tab reaches each, Enter/Space activates, and each closes
   the modal before running.
5. **Close the modal** — the top-right close is a `<button>` with an
   `aria-label`; Enter activates it. The Modal's native Esc handler also closes.

Result: **every step is possible without a mouse.**

## Reproducible commands

Reduced-motion gating (should print nothing once each hit is confirmed inside a
`prefers-reduced-motion` block — the guard test does this automatically):

```
rg -n 'animation:' src/style/features/agent-board.css src/style/features/work-order-modal.css | rg -v 'keyframes'
```

ARIA presence tripwires (each should print a non-empty match):

```
rg -n "role: 'switch'|'aria-checked'|'aria-expanded'|'aria-haspopup': 'menu'" src/features/tasks/ui/AgentBoardRenderer.ts
rg -n "'role', 'menu'|'role', 'menuitem'" src/features/tasks/ui/portalPopover.ts
rg -n "'aria-expanded'|'role', 'checkbox'" src/features/tasks/ui/WorkOrderDetailModal.ts
```

Run the guard + behavioral specs:

```
npx jest --selectProjects unit --testPathPatterns "agentBoardA11yReducedMotion|AgentBoardRenderer|WorkOrderDetailModal"
```

## Guard test

`tests/unit/features/tasks/ui/agentBoardA11yReducedMotion.test.ts` locks two
invariants and is proven to fail on regression:

- **Reduced motion** — a brace-depth CSS parser flags every `animation:`
  property in both stylesheets and asserts each has a
  `@media (prefers-reduced-motion: no-preference)` ancestor on the block stack.
  `@keyframes` blocks are excluded (inert until referenced). A sanity assertion
  pins the count at exactly 3 property declarations. Proven: injecting an
  ungated `animation:` trips both the gating assertion (reporting `file:line`)
  and the count.
- **ARIA presence** — coarse source-presence checks for the Auto-run
  `role="switch"`/`aria-checked`, portal `role="menu"`/`role="menuitem"`,
  lane/section `aria-expanded`, checklist `role="checkbox"`. Proven: renaming
  `role="menuitem"` trips the portal case. The behavioral assertions (focus
  return, Esc/keyboard activation, glyph/aria-label per tier) live in the jsdom
  renderer/modal specs; this guard is the cheap tripwire for outright deletion.

## Files changed

| File | Change |
|------|--------|
| `src/style/features/work-order-modal.css` | Added `font-variant-numeric: tabular-nums` to `header-live`/`header-sub` (item #8). |
| `src/features/tasks/ui/WorkOrderDetailModal.ts` | Added `title` tooltip to the status pill (item #9). |
| `tests/unit/features/tasks/ui/agentBoardA11yReducedMotion.test.ts` | New reduced-motion + ARIA guard. |
| `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` | Added item-select focus-return test (item #7 third path). |
| `tests/unit/features/tasks/ui/WorkOrderDetailModal.test.ts` | Added status-pill tooltip assertion (item #9). |
