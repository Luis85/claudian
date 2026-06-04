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

## Already shipped (do NOT rebuild)

Work orders **already run in a non-activated background tab** — `ChatTabExecutionSurface.startTaskRun` →
`ClaudianView.startTaskRunInFreshTab` → `TabManager.createTaskRunTab`, which creates the run tab with
`activate: false` (`TabManager.ts:249,260`), so a run does not steal focus. This issue is **not** about
re-implementing background execution.

## Problem (narrowed)

Two gaps remain beyond the non-activated tab:

1. **Live progress streaming into the board card.** The user must still open the run's tab to see what's
   happening; the Agent Board card does not stream live status/progress. (Verify: no live progress feed
   from the run tab into `AgentBoardRenderer`.)
2. **Truly detached / provider-native background runs.** Each run still occupies a (hidden) chat tab.
   The ecosystem direction is provider-native background tasks — Claude Code `/bg`, Codex Automations —
   that run without a tab at all. This is the differentiator vs chat-only rivals.

Sources: anthropic.com/news enabling-claude-code-to-work-more-autonomously; developers.openai.com/codex/changelog.

## Proposed change

- Stream live run status/progress from the execution surface into the work order's Agent Board card
  (no need to open the tab).
- Investigate a truly-detached run path using provider-native background tasks where available
  (`/bg`, Automations), falling back to the existing non-activated tab otherwise.
- Preserve the non-regression rule: ad-hoc chat stays first-class.

## Acceptance criteria

- An Agent Board card shows live progress for an in-flight run **without opening its tab**.
- Where a provider exposes background tasks, a run can execute without occupying a chat tab.
- Run lifecycle (start/stop/retry) and one-active-run-per-work-order still hold; chat sidepanel unchanged.

## Related

Pairs with `agent-board-evidence-review` (evidence/attribution) and `integrate-orchestrator-with-agent-board`.
