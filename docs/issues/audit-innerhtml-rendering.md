---
type: issue
id: issue-20260603-innerhtml-audit
title: Audit all rendering for innerHTML/outerHTML/insertAdjacentHTML on agent/markdown output
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (OBS-B)"
scope: obsidian-compliance
tags:
  - security
  - obsidian-compliance
  - rendering
---

# innerHTML rendering audit

## Problem

Obsidian now runs automated security review on **every** release. The #1 security-review risk for a
streaming chat UI is unsafe HTML injection: any `innerHTML`/`outerHTML`/`insertAdjacentHTML` fed by
user- or agent-derived content. All rendering must go through Obsidian's `MarkdownRenderer` or
`createEl`/`createDiv`/`createSpan`, never raw HTML injection.

## Proposed change

Grep the codebase for `innerHTML`/`outerHTML`/`insertAdjacentHTML` and confirm none receive
agent/markdown/user content; route any such site through `MarkdownRenderer`/`createEl`.

## Acceptance criteria

- No `innerHTML`/`outerHTML`/`insertAdjacentHTML` site renders untrusted (agent/markdown/user) content.
- An ESLint rule or test guards against regressions where feasible.
