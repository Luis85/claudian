---
type: issue
id: issue-20260603-accessibility-pass
title: Accessibility pass — keyboard-accessible composer controls, stream live region, Agent Board ARIA, reduced-motion
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (UX-E, UX-G ARIA, UX-J reduced-motion)"
scope: accessibility
tags:
  - ux
  - accessibility
  - a11y
  - obsidian-compliance
---

# Accessibility pass

## Problem

Multiple surfaces are inaccessible to keyboard and assistive-technology users (also blocks the Obsidian
review a11y bar):

- **Composer toolbar buttons are clickable `div`s** with no `tabindex`/`role="button"`/keydown — plan mode,
  orchestrator, quick-actions, service-tier, MCP, external-context cannot be operated by keyboard. Many use
  `title` (tooltip) only, not `aria-label`. (`InputToolbar.ts:503,567,613,645`, etc.)
- **Streaming has no live region** — only `aria-busy` on tab badges exists in all of `src/`; the message
  stream is not `role="status"`/`aria-live`, so screen readers don't announce assistant output/status.
- **Agent Board has no ARIA roles/labels** — lanes, cards, status badges, progress bars are unlabeled
  `div`s (`AgentBoardRenderer.ts`, `AgentBoardView.ts`).
- **Reduced-motion** is honored only in `tabs.css`; spinners/streaming/diff animations elsewhere ignore
  `prefers-reduced-motion`.

## Proposed change

- Make composer controls real buttons (`role`/`tabindex`/keydown + `aria-label`).
- Mark the message stream `role="status"`/`aria-live="polite"`.
- Add ARIA roles/labels to Agent Board lanes, cards, badges, progress.
- Honor `prefers-reduced-motion` across spinners/streaming/diff animations.

## Acceptance criteria

- Keyboard-only operation of composer controls, chat stream, and Agent Board.
- jsdom/axe-style tests for ARIA labels on icon buttons and the stream live region.
