---
type: issue
id: issue-20260603-claude-lifecycle-hooks
title: Adopt Claude Agent SDK lifecycle hooks (PreToolUse/PostToolUse/Stop/Session*)
status: open
priority: 2 - normal
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PN-6)"
related:
  - "[[unified-safe-edit-revert]]"
  - "[[agent-board-evidence-review]]"
scope: claude-capability
tags:
  - claude
  - hooks
  - audit
---

# Claude lifecycle hooks

## Problem

The Claude Agent SDK exposes in-process lifecycle hooks (`PreToolUse`, `PostToolUse`, `Stop`,
`SessionStart`, `SessionEnd`, `UserPromptSubmit`) that Claudian does not use. These give deterministic
guardrails and feed several downstream features: audit events, vault-safe gating, and **snapshot-before-edit**
for the unified revert path.

Source: code.claude.com/docs/en/agent-sdk/hooks [DOCS].

## Proposed change

Wire the `hooks` option on the Claude runtime and expose vault-safe hooks (e.g. auto-snapshot a note before
an edit; block writes outside the vault). Surface hook events to the audit/evidence layer.

## Acceptance criteria

- Claude runtime accepts and fires lifecycle hooks; at least one vault-safe hook (snapshot-before-edit) is wired.
- Hook events are observable by the unified-revert and evidence-gate consumers.

## Consumers

`unified-safe-edit-revert` (snapshot-before-edit) and `agent-board-evidence-review` (audit trail).
