---
type: issue
id: issue-20260603-capture-prompt-as-quick-action
title: Capture a sent chat prompt as a Quick Action
status: open
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/ideas/Create a new Quick-Action from an Users prompt.md]]"
related:
  - "[[docs/product/user-manuals/quick-actions.md]]"
scope: quick-actions
tags:
  - quick-actions
  - chat
  - ux
---

# Capture sent prompt as a Quick Action

## Problem

There is no way to turn a prompt the user just sent into a reusable Quick Action. Users who write a good
prompt must re-author it as a Quick Action by hand. No "Capture as Quick Action" affordance exists
(grep: no `captureQuickAction` / "Capture as Quick" in `src/`; `QuickActionStorage` has no
capture-from-message entry point).

## Proposed change

Add a "Capture as Quick Action" action on a sent user message that pre-fills and saves the prompt into
Quick Actions storage (name + body), reusing the existing Quick Actions storage/validation.

## Acceptance criteria

- A sent user message can be saved as a Quick Action in one action; it then appears in the `$`/quick-action surface.
- Round-trips through the existing Quick Actions storage with validation.
