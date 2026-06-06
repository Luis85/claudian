---
title: Work Order Handoff Chat Card Session Handoff
date: 2026-06-06
status: active
scope: chat-rendering
related:
  - "[[docs/issues/Work-Orders handoff message clutters chat.md]]"
  - "[[docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md]]"
  - "[[docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md]]"
---

# Work Order Handoff Chat Card Session Handoff

## Context

This session turned the issue [[docs/issues/Work-Orders handoff message clutters chat.md]] into an approved design and implementation plan. The problem is that Agent Board work-order runs currently leave the structured `<claudian_handoff>` block visible in chat, creating a large raw block that clutters the user-facing transcript.

Decisions made:

- Use a compact **Work order handoff** chat card by default.
- Expand into formatted Summary, Verification, Risks, and Next Action sections.
- Scope rendering to work-order run chats only.
- Keep the change render-only; do not mutate conversation history, provider transcripts, or work-order notes.
- Fail open: malformed, missing-field, or multiple handoff blocks render normally.

Primary artifacts are on branch `spec/work-order-handoff-chat-card` in worktree `.worktrees/work-order-handoff-chat-card-spec`:

- Design spec: [[docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md]]
- Implementation plan: [[docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md]]
- Commits:
  - `adf48697` â€” `docs: design work order handoff chat card`
  - `40088921` â€” `docs: plan work order handoff chat card`

## Current state

Done:

- Project context, issue note, screenshot, and relevant Chat/Agent Board code paths were reviewed.
- Brainstorming completed and user approved the design direction.
- Design spec was written, self-reviewed, committed, and then marked `approved`.
- Implementation plan was written, self-reviewed, and committed.

In progress:

- Branch `spec/work-order-handoff-chat-card` is ready for implementation from the plan.
- The branch is currently ahead of `origin/main` by 2 commits and behind by 5 commits; rebase or refresh from `origin/main` before coding if appropriate.

Blocked:

- No technical blocker identified.
- Main checkout has unrelated existing changes; avoid using it for implementation work. Continue in `.worktrees/work-order-handoff-chat-card-spec` or create a fresh implementation worktree from the plan.

## Next steps

1. Open `.worktrees/work-order-handoff-chat-card-spec` and review [[docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md]].
2. Decide execution mode: subagent-driven is recommended; inline execution is acceptable if the next agent cannot dispatch subagents.
3. Refresh the topic branch against `origin/main` if needed, preserving the two documentation commits.
4. Execute the implementation plan task-by-task, using TDD for code changes.
5. Run the verification listed in the plan: typecheck, lint, unit tests, and build.
6. Push `spec/work-order-handoff-chat-card` and open a draft PR.
7. Report PR URL, branch, commit SHA, verification results, and remaining manual UI risk.

## Suggested skills

- `superpowers:using-superpowers` â€” required at the start of a fresh agent session.
- `superpowers:subagent-driven-development` â€” recommended execution mode for the implementation plan.
- `superpowers:executing-plans` â€” fallback if executing inline in one session.
- `test-driven-development` or `tdd` â€” required for feature implementation and renderer behavior.
- `verification-before-completion` â€” before claiming implementation is complete.
- `requesting-code-review` â€” before merge/PR finalization if substantial code is added.
- `github:yeet` â€” when ready to push and open the draft PR.
