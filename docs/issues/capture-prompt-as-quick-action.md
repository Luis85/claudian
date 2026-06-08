---
type: issue
id: issue-20260603-capture-prompt-as-quick-action
title: Capture a sent chat prompt as a Quick Action
status: shipped
priority: 3 - low
triage: shipped
created: 2026-06-03
updated: 2026-06-07
owner: Claudian
source: "[[Create a new Quick-Action from an Users prompt]]"
related:
  - "[[quick-actions]]"
  - "[[2026-06-04-capture-prompt-as-quick-action-design]]"
  - "[[2026-06-04-capture-prompt-as-quick-action]]"
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
