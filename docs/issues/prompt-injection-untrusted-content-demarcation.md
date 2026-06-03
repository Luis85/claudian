---
type: issue
id: issue-20260603-prompt-injection-demarcation
title: Demarcate externally-sourced content in prompts + document the prompt-injection threat model
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (SEC-F)"
scope: prompt-safety
tags:
  - security
  - prompt-injection
---

# Prompt-injection demarcation for untrusted content

## Problem

Vault note content, browser selections (`BrowserSelectionController`), MCP tool outputs, and image/OCR
content all flow into agent prompts as fully trusted text, concatenated directly with no demarcation,
sanitization, or user-facing awareness. A malicious note or web page can carry instructions the agent will
follow. The approval gate is the real defense, but this is meaningful for auto-approved/YOLO sessions.

## Evidence

- No injection/sanitization handling in `src/core/prompt/` or the selection controllers.

## Proposed change

- Wrap externally-sourced content (browser/MCP/OCR/external-path) in clearly-delimited, labeled blocks in
  the prompt template so the model treats it as data, not instructions.
- Add a brief threat-model note to the docs (the approval gate is the primary control; this is defense-in-depth).

## Acceptance criteria

- Prompt encoders wrap external content in a labeled block; a unit test asserts the delimiter is present.
- Threat-model doc updated.
