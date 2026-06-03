---
type: issue
id: issue-20260603-append-docs-plan-mode
title: Optionally write the produced plan to a Markdown doc during plan mode
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/ideas/Append docs creation system-prompt to plan mode input.md]]"
related:
  - "[[docs/product/user-manuals/plan-mode.md]]"
scope: plan-mode
tags:
  - plan-mode
  - docs
  - ux
---

# Persist plan-mode output as a Markdown doc

## Problem

In plan mode the produced plan lives only in the transcript; there is no option to capture it into a
durable Markdown doc (with frontmatter) for tracking. No plan-mode docs-creation prompt injection exists in
`src/` (grep: no `planDocsPrompt`/`docsCreation`).

## Proposed change

Add an opt-in that appends a docs-creation instruction to the plan-mode input so the agent writes the plan
to a frontmatter+Markdown doc (e.g. under a configurable plans folder), consistent with the existing
plan-path conventions. Off by default.

## Acceptance criteria

- With the option on, a plan-mode turn writes the plan to a Markdown doc with frontmatter; off by default.
- Honors the provider's plan-path prefix where one exists.
