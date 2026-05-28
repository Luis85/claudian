# Agent Board End-to-End Thin Slice Design

Date: 2026-05-28  
Status: proposed for user review  
Source PRD: [[docs/issues/agent-board-mvp.md]]  
Branch: `codex/agent-board-thin-slice-design`

## Summary

Build the first Agent Board implementation as a thin vertical slice: create a Markdown work order, show it on an Agent Board, run it through a fresh visible chat tab, write a concise ledger and structured handoff back into the note, and move the card to Review only when a valid handoff is detected.

This slice is deliberately smaller than the full MVP PRD. It proves the core product loop while preserving direct chat as a first-class standalone workflow.

## Goals

- Add an optional Agent Board workspace opened from a ribbon button or command.
- Create work orders from a blank command or the current Markdown note.
- Store work orders as ordinary Markdown notes under a configurable folder, defaulting to `Agent Board/tasks`.
- Prefill new work orders with explicit provider/model fields from Agent Board settings.
- Render work orders as kanban lanes/cards with a detail pane.
- Auto-run a valid work order through a fresh sidepanel chat tab.
- Write run ledger and handoff content only inside generated regions.
- Transition `running -> review` only after a strict structured handoff is found.
- Keep normal chat sessions independent of Agent Board state.

## Non-goals

- No editor-selection, browser-selection, or chat-promotion capture.
- No drag/drop lane movement.
- No custom lane configuration.
- No workflow-note configuration file.
- No autonomous scheduler or background/headless execution.
- No worktree allocator.
- No push, PR, or publish automation.
- No provider-native transcript parsing in `features/tasks`.

## User Flow

1. The user opens Agent Board from the ribbon button or command palette.
2. The user creates a work order from a blank command or the current Markdown note.
3. Claudian creates a work-order note in the configured folder.
4. Creation stamps explicit `provider` and `model` fields from Agent Board settings.
5. Agent Board renders the note as a card in the appropriate built-in status lane.
6. The user clicks **Run**.
7. Claudian validates the note, status, provider/model, generated regions, and one-active-run invariant.
8. Claudian opens the chat view and creates a fresh chat tab for that run.
9. The fresh tab is bound to a new conversation and the work order.
10. Claudian auto-sends the generated work-order prompt through the existing chat input path.
11. Claudian writes ledger events as the run starts, completes, fails, or is canceled.
12. If the final assistant response contains a valid structured handoff block, Claudian writes the handoff region and transitions the task to `review`.
13. If the handoff is missing or malformed, Claudian records the failure and transitions the task to `failed`.

## Settings

Add an Agent Board section to the existing General settings tab.

Fields:

- `agentBoardWorkOrderFolder`: default `Agent Board/tasks`
- `agentBoardDefaultProvider`: enabled provider used to prefill new work orders
- `agentBoardDefaultModel`: provider model used to prefill new work orders

Behavior:

- Settings only affect future work-order creation.
- Existing work orders remain note-owned.
- Run validates explicit `provider` and `model` fields every time.
- Changing settings does not rewrite existing work orders.

## Work-order Note Contract

### Frontmatter

New notes use a compact schema:

```yaml
---
type: claudian-work-order
schema_version: 1
id: task-20260528-example
title: Example work order
status: ready
priority: normal
created: 2026-05-28T18:00:00+02:00
updated: 2026-05-28T18:00:00+02:00
provider: codex
model: gpt-5-codex
run_id:
conversation_id:
sidepanel_tab_id:
started:
finished:
attempts: 0
---
```

Only this subset is driven by the first slice. Unknown frontmatter fields are preserved.

### Body Template

```md
# Example work order

## Objective

Describe the goal.

## Acceptance Criteria

- [ ] The expected outcome is clear.

## Context

Linked notes, files, constraints, or source note.

## Constraints

- Preserve existing direct chat behavior.
- Do not edit unrelated files.

## Run Ledger

<!-- claudian:run-ledger-start -->
<!-- claudian:run-ledger-end -->

## Result / Handoff

<!-- claudian:handoff-start -->
<!-- claudian:handoff-end -->
```

### Current-note Creation

Creating from the current note:

- creates a separate work-order note;
- sets the work-order title from the current note title;
- adds a wiki-link to the source note in `## Context`;
- may include a short source placeholder, but does not copy the full source note by default;
- leaves the source note unchanged.

## Required Handoff Format

The generated prompt instructs the agent to end with a strict block:

```md
<claudian_handoff>
summary: Briefly state what was completed.
verification: List checks run and their outcomes, or explain why none were run.
risks: List remaining risks or state "None known".
next_action: State the recommended human next step.
</claudian_handoff>
```

`TaskHandoffParser` extracts this block, validates the required fields, converts it to readable Markdown, and writes it inside the handoff markers. Missing or malformed handoff content causes the run to fail instead of moving to Review.

## Architecture

Add a new feature module: `src/features/tasks/`.

### Deep Modules

#### `TaskNoteStore`

Single read/write boundary for work-order notes.

Responsibilities:

- parse work-order frontmatter into a typed `TaskSpec`;
- validate type, schema version, status, provider, and model shape;
- write orchestrator-owned fields such as status, run metadata, conversation/tab IDs, timestamps, and attempts;
- append ledger entries only between ledger markers;
- write handoff content only between handoff markers;
- preserve unrelated frontmatter and user-authored body content;
- insert missing generated regions safely when validation permits.

#### `TaskStateMachine`

Pure status-transition module. MVP status set:

```text
inbox
ready
running
needs_input
needs_approval
review
needs_fix
done
failed
canceled
```

Critical transitions for this slice:

- `inbox -> ready`
- `ready -> running`
- `needs_fix -> running`
- `running -> review`
- `running -> failed`
- `running -> canceled`
- `review -> done`
- `review -> needs_fix`
- `needs_fix -> ready`

The state machine validates transitions only. Coordinator logic decides whether a handoff is sufficient for `running -> review`.

#### `TaskRunCoordinator`

Owns the Run action.

Responsibilities:

- validate runnable status, provider/model, generated regions, and active-run constraints;
- assign `run_id`, increment attempts, set `started`, and transition to `running`;
- write ledger events through `TaskNoteStore`;
- call `TaskExecutionSurface`;
- parse final assistant content through `TaskHandoffParser`;
- write handoff and transition to `review` on valid handoff;
- transition to `failed` or `canceled` on failed or canceled runs.

#### `TaskExecutionSurface`

Provider-neutral execution seam:

```ts
interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
}
```

MVP adapter: `ChatTabExecutionSurface`.

The execution surface is the only path from `features/tasks` into chat execution.

#### `TaskHandoffParser`

Parses the final assistant response for `<claudian_handoff>` block and validates required fields. It returns a structured handoff object plus rendered Markdown. It rejects missing or malformed blocks.

### Supporting Modules

- `TaskIndexer`: scans the configured folder, watches note changes, builds the board model, and reports invalid notes without crashing the board.
- `TaskPromptRenderer`: renders the auto-send prompt from frontmatter, body sections, source links, constraints, and required handoff instructions.
- `AgentBoardView`, `AgentBoardRenderer`, `TaskCard`, `TaskDetailPane`: board UI.
- `taskCommands`: command palette entries for opening the board, creating work orders, creating from the current note, and running a selected/current work order.
- `AgentBoardSettingsSection`: settings UI in the existing General settings tab.

## Chat Integration

`ChatTabExecutionSurface` should reuse existing chat behavior instead of implementing a parallel runtime path.

For each new run it should:

1. open/focus the Claudian chat view using the existing chat placement setting;
2. create a fresh chat tab;
3. create or bind a new conversation for the work order;
4. force the tab to use the work order's provider/model;
5. auto-send the prompt through `InputController.sendMessage({ content })` or a narrow public wrapper around that path;
6. return `runId`, `conversationId`, `sidepanelTabId`, completion status, and final assistant content.

If the chat view has no enabled providers, max tabs are reached, provider/model is invalid, or runtime initialization fails, the coordinator records the failure in the ledger and avoids a false Review transition.

## One-active-run Rule

A work order cannot start if any of these are true:

- status is `running`;
- saved `run_id` is active in memory;
- saved `sidepanel_tab_id` points to a tab that is streaming.

The first slice blocks with the Notice: `This work order is already running.` It does not queue another turn.

## Board UI

Register a new view type such as:

```ts
VIEW_TYPE_CLAUDIAN_AGENT_BOARD = 'claudian-agent-board-view'
```

The board renders built-in kanban lanes:

- Inbox
- Ready
- Running
- Needs Input
- Needs Approval
- Review
- Needs Fix
- Done
- Failed
- Canceled

Cards show:

- title;
- status;
- priority;
- provider/model;
- latest ledger event;
- linked conversation/run indicator;
- validation/error badge when applicable.

Card actions:

- Open note
- Run when runnable
- Stop when running
- Mark done from Review
- Needs fix from Review
- Reopen / ready from Needs Fix or Failed

The detail pane shows:

- objective;
- acceptance criteria;
- context/source link;
- latest ledger entries;
- handoff content;
- validation errors.

No drag/drop is included in this slice. Status transitions use explicit buttons only.

## Commands and Ribbon

Ribbon button:

- label: Open Agent Board
- icon: a kanban-style Lucide icon if available
- behavior: open/focus Agent Board

Command palette entries:

- Open Agent Board
- Create work order
- Create work order from current note
- Run selected work order when a task note or board selection is active

## Refresh and Error Handling

The board refreshes when:

- a note in the configured work-order folder is created, modified, deleted, or renamed;
- Agent Board settings change;
- a run writes status, ledger, or handoff updates.

Invalid notes are visible as error cards or in an error area. One malformed note must not crash the board.

Validation failures should be shown both as a board-visible error and a concise Obsidian Notice.

## Direct Chat Non-regression

Agent Board is an optional consumer of chat. Direct chat remains standalone.

Required invariants:

- direct chat can open without Agent Board configuration;
- direct chat can create, send, stream, cancel, resume, fork, and render without work-order state;
- conversations do not require work-order metadata;
- provider-specific features remain provider-owned;
- task code does not parse provider-native JSON-RPC or transcript files.

## Testing Plan

### Unit Tests

Add tests under `tests/unit/features/tasks/`.

#### `TaskStateMachine`

- accepts legal transitions;
- rejects illegal transitions;
- allows review and needs-fix loops;
- rejects normal reruns from terminal states unless reopened explicitly.

#### `TaskNoteStore`

- parses valid work-order notes;
- rejects invalid type/schema/status/provider/model shape;
- preserves unrelated frontmatter;
- preserves user-authored body content;
- updates status/run metadata safely;
- writes ledger and handoff only inside generated markers;
- inserts missing generated regions safely when allowed.

#### `TaskHandoffParser`

- accepts a well-formed handoff block;
- rejects missing and malformed handoff blocks;
- requires `summary`, `verification`, `risks`, and `next_action`;
- renders structured handoff data to readable Markdown.

#### `TaskPromptRenderer`

- includes objective, acceptance criteria, context, constraints, provider/model, source note link, and handoff instructions;
- excludes hidden vault internals and unrelated files.

#### `TaskRunCoordinator`

- blocks missing provider/model;
- blocks disabled or unsupported provider;
- blocks already-running work orders;
- transitions `ready -> running -> review` on valid handoff;
- transitions `running -> failed` on missing handoff;
- transitions `running -> canceled` on stop.

### Contract Tests

Use a fake `TaskExecutionSurface` for coordinator tests:

- successful run with valid handoff;
- successful stream without handoff;
- runtime initialization failure;
- cancel before completion;
- active run already exists.

Use a minimal fake tab manager/input controller for `ChatTabExecutionSurface` where practical:

- creates a fresh tab for each run;
- auto-sends through the input controller path;
- returns conversation and tab IDs;
- leaves existing direct chat tabs untouched.

### Integration and Non-regression Tests

Representative tests:

- Agent Board indexes valid and invalid task notes without crashing.
- Creating from current note writes a separate work-order note and leaves the source note unchanged.
- Existing direct chat send/stream path works without task services or work-order metadata.
- Agent Board settings save/load with defaults.
- Board refreshes after task note status changes.

## Manual Verification

For the implementation PR, run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Manual smoke test:

1. Open Agent Board from the ribbon.
2. Create a work order from the current note.
3. Confirm the card appears in Ready.
4. Click Run.
5. Confirm a fresh chat tab opens and auto-sends.
6. Confirm ledger updates.
7. Confirm valid handoff moves the card to Review.
8. Confirm direct chat still works without a work order.

## Implementation Risks

- Existing chat tab internals may need a small public method to create a fresh tab with explicit provider/model and await stream completion.
- Max-tab limits could block runs; the UI should report this clearly.
- Final assistant content capture may require a small callback or result object from the existing send path.
- Strict handoff parsing improves auditability but may produce early false failures until the prompt is tuned.
- Settings default provider/model must stay aligned with enabled provider state.

## Acceptance Criteria

- The Agent Board opens from the ribbon and command palette.
- A work order can be created blank or from the current note.
- New work orders are stored in the configured folder and include explicit provider/model fields.
- The board renders lanes, cards, and a detail pane.
- Clicking Run creates a fresh chat tab and auto-sends the generated prompt.
- Ledger entries are written only inside ledger markers.
- Valid structured handoff writes the handoff region and moves the card to Review.
- Missing or malformed handoff moves the card to Failed and records a ledger entry.
- Running work orders cannot be started a second time.
- Direct chat continues to work without Agent Board state.

