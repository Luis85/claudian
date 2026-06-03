---
type: issue
id: issue-20260603-agent-board-background-runs
title: Run Agent Board work orders as background/long-running agents streaming into their cards
status: open
priority: 1 - high
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (D4 + market research #1)"
related:
  - "[[docs/issues/agent-board-evidence-review.md]]"
  - "[[docs/ideas/agent-board-symphony.md]]"
scope: agent-board-orchestration
tags:
  - agent-board
  - background-agents
  - differentiator
---

# Agent Board background / long-running runs

## Problem

Agent Board work orders run through a foreground chat tab. The strongest differentiator vs every chat-only
rival — and the direction of travel for the coding-agent ecosystem (Claude Code `/bg` background tasks,
Codex Automations) — is running each work order as a **non-blocking background agent** that streams
progress into its card. Nothing else in the Obsidian space does this.

Sources: anthropic.com/news enabling-claude-code-to-work-more-autonomously; developers.openai.com/codex/changelog.

## Proposed change

Allow a work order to run as a background, non-blocking agent (provider-native background task where
available, otherwise a detached chat session) that streams status/progress into its Agent Board card,
without occupying a foreground tab. Preserve the non-regression rule: ad-hoc chat stays first-class.

## Acceptance criteria

- A work order can run in the background; its card shows live progress without a foreground tab.
- Run lifecycle (start/stop/retry) works on background runs; one-active-run-per-work-order still enforced.
- Chat sidepanel behavior is unchanged for users who don't use the board.

## Related

Pairs with `agent-board-evidence-review` (evidence/attribution) and `integrate-orchestrator-with-agent-board`.
