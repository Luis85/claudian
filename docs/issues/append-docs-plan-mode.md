---
type: issue
id: issue-20260603-append-docs-plan-mode
title: Optionally persist the produced plan to a Markdown doc after plan mode
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[Append docs creation system-prompt to plan mode input]]"
related:
  - "[[plan-mode]]"
scope: plan-mode
tags:
  - plan-mode
  - docs
  - ux
---

# Persist plan-mode output as a Markdown doc

## Problem

In plan mode the produced plan lives only in the transcript; there is no option to capture it into a
durable Markdown doc (with frontmatter) for tracking. No plan-doc persistence exists in `src/`
(grep: no `planDocsPrompt`/`docsCreation`).

## Design constraint (important)

The original idea ("append a docs-creation system-prompt to the plan-mode input") is the **wrong
mechanism**: plan mode is precisely the mode that **disallows write-side tools** until approval
(Claude is read-only, Cursor runs `--mode plan`, Opencode's managed `plan` mode blocks edits — see
`plan-mode.md`). An instruction asking the agent to write the file *during* the plan turn would be
ignored or blocked on exactly the providers where plan mode matters. **Claudian must persist the plan
itself, after the turn completes** — not the agent mid-plan.

## Proposed change

Add an opt-in (off by default) where **Claudian writes the plan to a frontmatter+Markdown doc** once the
plan is available — driven by the existing post-plan metadata/artifact (`planCompleted` /
`buildPlanArtifactFromChatState` / captured `planFilePath`), under a configurable plans folder and the
provider's `planPathPrefix` where one exists. For providers without `planCompleted` (e.g. Opencode, see
[[opencode-plan-approval-card]]), persist on the approve action or when the plan content is
otherwise captured.

## Acceptance criteria

- With the option on, the completed plan is written by Claudian to a Markdown doc with frontmatter **after**
  the plan turn (no reliance on the agent writing during the read-only/constrained plan turn); off by default.
- Honors the provider's plan-path prefix where one exists; degrades gracefully for providers without `planCompleted`.
