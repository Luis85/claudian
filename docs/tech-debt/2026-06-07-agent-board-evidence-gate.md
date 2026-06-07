---
type: tech-debt
title: "Agent Board run completion is not evidence-gated"
date: 2026-06-07
updated: 2026-06-07
status: open
priority: "1 - high"
severity: high
scope: agent-board
tags:
  - tech-debt
  - agent-board
  - evidence
  - verification
  - agentic-workflow
related:
  - "[[agent-board-evidence-review]]"
  - "[[2026-06-07-agentic-quality-gates]]"
---

# Agent Board run completion is not evidence-gated

## Summary

The Agent Board has made progress on heartbeat and ledger sidecars, but completion is still trust-thin. Runs produce a prose handoff with a `verification` field; the system does not parse a structured evidence bundle, reconcile changed files, or gate `review → done` on required evidence.

## Evidence

- `src/features/tasks/prompt/TaskPromptRenderer.ts` asks the agent to update acceptance checkboxes and produce a handoff with `summary`, `verification`, `risks`, and `next_action`.
- `src/features/tasks/execution/TaskHandoffParser.ts` parses the handoff fields, but not structured command evidence, exit codes, changed-file attribution, or artifacts.
- `src/features/tasks/CLAUDE.md` documents sidecar heartbeat and run ledger storage, not evidence bundles or review gates.
- `rg "Evidence|evidence" src/features/tasks` returns only comments/docs around existing ledger behavior, not a typed evidence model.
- The product issue [[agent-board-evidence-review]] remains open.

## Why it matters

Agentic work needs proof-of-work, not just self-report. Without evidence gating, a work order can be moved to done even when checks were not run, files changed outside the agent's claimed scope, or a human edited the note during the run. This undermines the Agent Board's value as a supervised autonomous workflow.

## Suggested remediation

1. Define a typed evidence bundle: changed files, verification commands, exit statuses, artifacts, caveats, risks, and optional commit/PR refs.
2. Require the run prompt to emit this block at completion.
3. Parse and store evidence in a generated note region separate from the ledger and handoff.
4. Reconcile changed files against `git status` / known run state as `attributed`, `unknown`, or `conflicted`.
5. Gate lane transitions out of review based on each lane's required evidence keys.

## Acceptance criteria

- [ ] Runs without evidence land in review with a visible "no evidence reported" state.
- [ ] Evidence includes per-acceptance-criterion verification with command and exit status.
- [ ] Changed files are reconciled and surfaced honestly.
- [ ] `review → done` is blocked when required evidence is missing or failed, with a recorded override path.
- [ ] Evidence remains readable Markdown if the plugin is disabled.
