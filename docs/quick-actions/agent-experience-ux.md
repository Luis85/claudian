---
type: quick-action
name: Agent Experience UX
description: Review or design Specorator agent interaction flows for trust, status clarity, recovery, approval, and human control.
icon: bot
tags:
  - ux
  - agents
  - frontend
  - product
---

Use this action for UX work on Specorator's agent-facing surfaces: streaming responses, tool calls, plan mode, approvals, ask-user questions, subagents, Agent Board, run status, errors, retries, and provider-specific capability differences.

## 1. Map the agent interaction

Identify the flow and list:

- Entry point: how the user starts it.
- Agent action: what the agent does visibly or invisibly.
- User control: how the user approves, edits, cancels, retries, or dismisses.
- Failure states: what can go wrong and how recovery is offered.
- Provider differences: Claude, Codex, Opencode, Cursor support or gate different capabilities.

Read relevant docs/code before proposing changes: `CLAUDE.md`, relevant provider `CLAUDE.md` files, and target UI renderers/controllers.

## 2. UX principles

Design the flow so users can answer:

- What is the agent doing now?
- What input or approval is needed from me?
- What changed in my vault or workspace?
- How confident should I be in this output?
- How do I stop, recover, retry, or inspect details?

Avoid making chat fluency hide uncertainty. Prefer explicit states, source/context labels, diffs, and recovery actions.

## 3. Agent UI checklist

Check for:

- Clear status labels for queued, running, thinking, tool-running, awaiting approval, complete, failed, cancelled.
- Tool calls that show action, target, status, and result.
- Error messages with a next action, not only raw failure text.
- Human approval points that are visually distinct and keyboard accessible.
- Provider-gated features that explain why unavailable.
- Long-running work that remains interruptible and understandable.
- Subagent/Agent Board flows that preserve ownership, state, and handoff clarity.

## 4. Output

If designing, return:

- Flow summary
- UX risks
- Recommended UI changes
- Affected files
- Verification/manual test path

If implementing, follow `AGENTS.md` project workflow and keep the patch scoped to one agent interaction concern.

## 5. Verification

For implementation, run relevant checks and include a manual scenario, for example:

```bash
npm run typecheck
npm run lint
npm run build:css
```

Manual scenario format:

1. Start `<provider>` conversation.
2. Trigger `<flow>`.
3. Confirm statuses/actions/errors appear as expected.
