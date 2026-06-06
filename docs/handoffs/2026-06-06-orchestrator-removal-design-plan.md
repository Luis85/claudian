---
title: Orchestrator removal design and plan handoff
date: 2026-06-06
status: active
related:
  - "[[docs/superpowers/specs/2026-06-06-remove-orchestrator-feature-design.md]]"
  - "[[docs/superpowers/plans/2026-06-06-remove-orchestrator-feature.md]]"
  - "https://github.com/Luis85/claudian/pull/41"
---

# Orchestrator removal design and plan handoff

## Context

This session turned [[docs/ideas/Remove the Orchestrator feature.md]] into an approved design spec and implementation plan. The product decision is **hard removal** of Orchestrator because Agent Board is now the durable orchestration/work-handoff interface.

The work was done on an isolated worktree: "D:\Projects\claudian\.worktrees\remove-orchestrator-spec".

Key decisions are captured in [[docs/superpowers/specs/2026-06-06-remove-orchestrator-feature-design.md]]:

- Remove Orchestrator rather than deprecating or integrating it with Agent Board.
- Ensure there is no active Orchestrator trace in settings: no tab, fields, defaults, registry/search results, or i18n labels.
- Treat old serialized settings/conversation keys as inert legacy data; do not write a destructive migration.
- Keep provider-native plan mode, normal chat, and Agent Board execution intact.

The implementation approach is captured in [[docs/superpowers/plans/2026-06-06-remove-orchestrator-feature.md]].

## Current state

Done:

- Approved design spec created and marked `status: approved (design)`.
- Implementation plan created with ordered tasks for settings, chat, provider prompt plumbing, styles/i18n, docs, residue audit, and verification.
- Draft PR opened and updated: https://github.com/Luis85/claudian/pull/41
- Branch pushed: `docs/remove-orchestrator-spec`
- Latest pushed commit at handoff time: `b72d22161bcfcedc4999d6b1ecbd7d738b6091fd`

In progress:

- PR #41 remains open as a draft docs-only PR containing the spec and plan.
- No implementation work has started.

Blocked:

- Nothing is technically blocked.
- The next agent should confirm whether PR #41 should be merged first or whether implementation should branch from the existing docs branch.

## Next steps

1. Review PR #41 and merge it if the desired workflow is to land the spec/plan before implementation.
2. Start a fresh implementation worktree/branch for `codex/remove-orchestrator-feature` as described in [[docs/superpowers/plans/2026-06-06-remove-orchestrator-feature.md]].
3. Execute the plan task-by-task, preserving the explicit no-settings-trace requirement.
4. Run the final verification gate from the plan: `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
5. Update the implementation PR with automated verification and manual smoke results.

## Suggested skills

- `using-git-worktrees` — start implementation on "D:\Projects\claudian\.worktrees\remove-orchestrator-spec"
- `subagent-driven-development` — recommended execution mode for the plan.
- `tdd` or `test-driven-development` — follow the plan's test-first tasks.
- `systematic-debugging` — use for any failing tests or unexpected Orchestrator residue.
- `verification-before-completion` — required before claiming the removal is complete.
- `requesting-code-review` — use before opening or marking the implementation PR ready.
