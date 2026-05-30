---
type: prd
id: issue-20260528-agent-board-mvp
title: Agent Board MVP — optional Markdown workspace with visible sidepanel execution
status: done
priority: 1 - high
triage: ready-for-agent
created: 2026-05-28
updated: 2026-05-28
owner: Claudian
source: "[[docs/ideas/agent-board-symphony.md]]"
related:
  - "[[2026-05-28-standalone-product-vision]]"
scope: phase-1-mvp-before-specorator-migration
tags:
  - agent-board
  - tasks
  - prd
  - workspace
  - specorator-transition
relations:
  - "[[Agent Kanban Board]]"
---

# Agent Board MVP — optional Markdown workspace with visible sidepanel execution

> Source idea: [[docs/ideas/agent-board-symphony.md]]  
> Transition context: [[2026-05-28-standalone-product-vision]]  
> Scope: Phase 1 MVP and bridge increment before the Specorator migration. Later autonomous orchestration phases are out of scope.

## PRD review summary

This PRD has been refined around three non-negotiable product constraints:

1. **No chat regression:** the existing agent chat sidepanel remains a first-class, standalone workflow. Users can keep using ad-hoc provider-backed chat without Agent Board, work orders, or workspace mode.
2. **Workspace is optional:** Agent Board is an additive workspace/orchestration layer for users who want durable Markdown work orders. It must not gate provider setup, chat sessions, history, inline edit, attachments, skills, subagents, or provider-specific features.
3. **Workspace is configurable:** the board must fit the user's process, role, and available collaborators. MVP ships with defaults, but includes a configuration contract for lanes, roles, definitions of ready, and definitions of done.

## Problem Statement

I keep my specs, plans, decisions, and working memory as Markdown in my Obsidian vault, then I jump into a chat sidepanel to actually get an agent to do the work. The two worlds don't connect. Once a chat run starts, the durable intent (goal, acceptance criteria, linked context, scope) is trapped in a long transcript that scrolls away, and the result never comes back into my vault as something reviewable. When I run more than one piece of work I lose track of what is in flight, what is waiting on me, and what is finished. I have no single place that answers "what work have I delegated to an agent, what state is it in, and can I trust the result?"

At the same time, not every agent interaction needs a workspace. Sometimes I just want to open the chat sidepanel, ask a question, use inline edit, resume a provider session, or explore with an agent. The workspace must not make that flow heavier.

## Solution

Claudian adds an optional **Agent Board** workspace. A **work order** is a plain Markdown note with YAML frontmatter that owns the goal, acceptance criteria, linked context, scope, permissions, run metadata, and review handoff. The board renders those notes as configurable lanes. I can create a work order, click **Run**, and Claudian binds it to a sidepanel chat tab that streams the run using the existing chat UI I already trust. As the run progresses, Claudian writes a concise ledger and final handoff back into generated regions of the note, so the durable result lives in my vault.

The existing chat sidepanel remains independent. Users can keep using direct chat sessions without creating or opening work orders. Agent Board can link to chat conversations, and chat messages can be promoted into work orders, but neither feature owns the other.

Positioning for this increment: **Plan in Markdown. Run visibly. Review with evidence.** Worktrees, autonomous scheduling, headless execution, and rich evidence bundles land later.

## Product guardrails

### Direct chat remains first-class

- Existing chat sidepanel behavior must continue to work without work-order or workspace state.
- Agent Board must not become a prerequisite for send, stream, cancel, resume, fork, history reload, attachments, inline edit, skills, subagents, provider commands, or provider-specific settings.
- A conversation may be linked to a work order, but a conversation must not require a work order.
- Agent Board PRs must include explicit chat non-regression checks.

### Workspace is opt-in per user/workflow

- Users can ignore the board entirely.
- Users can use direct chat for ad-hoc exploration and work orders for durable delivery work.
- Users can promote chat context into a work order when they decide a conversation should become trackable.

### Workspace is configurable

- MVP ships with a default board, but the board model must allow configuration of lanes, roles, definitions of ready, and definitions of done.
- The default board must work without configuration.
- Configuration should be readable and durable, ideally stored as vault-owned Markdown/YAML/JSON or plugin settings with schema/version validation.
- Configurable labels and role/process rules must not destabilize the internal state machine.

## User Stories

### Direct chat coexistence

1. As a user, I want to keep opening the chat sidepanel and starting an ad-hoc agent session without creating a work order, so that Agent Board does not slow down lightweight use.
2. As a user, I want existing chat actions (send, stream, cancel, resume, fork, history reload, attachments, inline edit, skills/subagents, provider settings) to keep working without workspace state, so that I can adopt Agent Board gradually.
3. As a user, I want a chat conversation to optionally link to a work order, so that durable tasks can connect to their live execution history.
4. As a user, I want a useful chat message or conversation to be promoted into a work order, so that exploratory chat can become planned work only when I choose.
5. As a user, I want work-order metadata to stay out of normal chat unless the chat is explicitly bound to a work order, so that ad-hoc sessions remain uncluttered.

### Capture

1. As a vault-native developer, I want to create an agent work order from a command palette action, so that I can delegate work without leaving Obsidian.
2. As a developer, I want to create a work order from the current note, so that I can turn an existing spec or idea into delegated work in one step.
3. As a developer, I want to create a work order from selected editor text, so that a snippet of context becomes the seed of a task.
4. As a developer, I want to create a work order from a browser selection, so that captured web content can scope a task.
5. As a developer, I want to create a work order from an existing chat message, so that a useful agent exchange becomes a durable, trackable work item.
6. As a developer, I want to create a work order that references files or folders, so that the agent knows the repository scope up front.
7. As a developer, I want new work orders to land in a configurable folder (default `Agent Board/tasks/`), so that they stay organized and out of my way.
8. As a developer, I want a new work order pre-filled with valid frontmatter and a body template (Objective, Acceptance Criteria, Context, Constraints, Run Ledger, Result/Handoff), so that I can fill in intent quickly without remembering the schema.

### Board and workspace configuration

1. As a developer, I want a dedicated Agent Board view, so that I can see all my delegated work in one place when I choose to use workspace mode.
2. As a developer, I want a usable default board grouped into lanes (Inbox, Ready, Running, Needs Input, Needs Approval, Review, Needs Fix, Done, Failed, Canceled), so that I can start without configuration.
3. As a developer, I want to configure board lane names, order, and visible statuses, so that the board matches my process and vocabulary.
4. As a developer, I want each lane/step to have a configurable **definition of ready**, so that I know what must be true before work enters that step.
5. As a developer, I want each lane/step to have a configurable **definition of done**, so that humans and agents know what evidence is required to leave that step.
6. As a developer, I want to configure roles for the board, so that the process can represent solo work, humans plus agents, or agent-only work.
7. As a developer, I want work orders to show owner/assignee/next-role where configured, so that I know who or what is responsible for the next action.
8. As a developer, I want each card to show title, provider/model, current status, priority, configured role/assignee, and linked conversation, so that I can identify and triage work quickly.
9. As a developer, I want each card to show the latest ledger event and heartbeat age, so that I can tell whether a run is alive, idle, or stalled.
10. As a developer, I want a pending approval/input indicator on cards, so that I know which runs are blocked waiting on me.
11. As a developer, I want to open the underlying note from a card, so that I can read or edit full intent and context.
12. As a developer, I want the board to refresh when work-order notes or board configuration change on disk, so that the board reflects reality without a manual reload.
13. As a developer, I want corrupted or invalid work-order/config frontmatter to be skipped safely and surfaced as an error rather than crashing the board, so that one bad note doesn't break the view.

### Execution

1. As a developer, I want a **Run** action on a card, so that I can start an agent run for that work order on demand.
2. As a developer, I want a **Run next ready** action, so that I can kick off the next eligible work order without picking one manually.
3. As a developer, I want Claudian to validate frontmatter, workflow configuration, board criteria, and role assignments before running, so that I don't start a malformed run.
4. As a developer, I want the run to open or reuse a sidepanel chat tab bound to the work order, so that execution happens in the streaming UI I already trust.
5. As a developer, I want the agent prompt rendered from the work-order note, workflow template, current lane criteria, and assigned role, so that the run reflects my stated intent and process rules.
6. As a developer, I want the existing renderers to show text, tool calls, diffs, todo state, plan approval, and ask-user prompts during the run, so that I keep full visibility and control.
7. As a developer, I want exactly one active run per work order, so that a task can't fork into competing concurrent runs.
8. As a developer, I want to **Stop** a running work order, so that I can cancel a run that is going wrong.
9. As a developer, I want to **Retry** a failed or canceled work order manually, so that I can re-run after fixing context.
10. As a developer, I want the conversation ID and run ID persisted in the work order's frontmatter, so that the note stays linked to its execution history across reloads.

### Status, criteria, and ledger

1. As a developer, I want Claudian to advance the work order through a validated internal status lifecycle as the run progresses, so that the board lane always reflects the true state.
2. As a developer, I want configurable lane criteria to guide transitions without replacing the internal state machine, so that custom process wording does not corrupt run semantics.
3. As a developer, I want a concise run ledger written into a generated region of the note, so that I can read a months-later-useful timeline without wading through a transcript.
4. As a developer, I want the ledger to include meaningful process events (status changes, run start/stop, approvals/input requests, validation failures, handoff written), so that the board is auditable.
5. As a developer, I want Claudian to own only generated ledger/handoff regions and status/run fields, leaving the rest of the note user-owned, so that my own writing is never overwritten.
6. As a developer, I want frontmatter updates to use a safe compare-and-swap / lock strategy, so that the orchestrator never clobbers edits I made while a run was active.

### Review & handoff

1. As a developer, I want a final handoff section written back to the note (summary of what changed, branch, verification notes, remaining risks, next suggested action), so that I get a durable, reviewable result in my vault.
2. As a developer, I want the handoff to include or reference the configured definition of done for the Review/Done step, so that I can evaluate the result against my own criteria.
3. As a developer, I want to move a work order to Review, Done, or Canceled from the board, so that I can record the human verdict.
4. As a developer, I want a `needs_fix` lane so a reviewed-but-rejected task can route back to development, so that rework stays visible instead of silently reopening.

### Reliability & safety

1. As a developer, I want a work order to be skipped (not crash the board) if its frontmatter is unparseable, so that the system degrades gracefully.
2. As a developer, I want invalid board configuration to fall back to the last known-good/default config and surface an operator-visible error, so that one config mistake doesn't break work.
3. As a developer, I want a run to survive a plugin reload — reconnecting or marking the run state honestly — so that I don't lose track of in-flight work.
4. As a developer, I want closing the sidepanel tab mid-run to be handled cleanly (run state recorded, no orphaned lock), so that the board stays trustworthy.
5. As a developer, I want write actions to default to the task's own status/log fields only, with shell/network/commit gated to "ask", so that running a work order can't silently mutate my repo or vault.
6. As a developer, I want publishing (push/PR) excluded from MVP entirely, so that no run can change a remote without me.

## Implementation Decisions

Use the vocabulary from the source idea note throughout: **direct chat** (normal agent chat sidepanel), **work order** (a Markdown task note), **Agent Board** (the optional workspace status view), **lane** (a configurable board grouping), **definition of ready** (entry criteria for a lane/step), **definition of done** (exit/evidence criteria for a lane/step), **role** (human or agent responsibility), **run ledger** (the generated timeline region), **handoff** (the durable result), **execution surface** (the seam between scheduling and provider runtime).

### Non-regression boundary: chat owns itself

The chat sidepanel remains a primary feature module. `features/tasks` may call into chat through stable seams, but chat must not depend on Agent Board to operate.

Required boundaries:

- Direct chat sessions can be created, sent, streamed, canceled, resumed, forked, and rendered without task/workspace services.
- Work-order binding is optional metadata on a conversation, not a required conversation field.
- Agent Board can create or reuse a chat tab through `TaskExecutionSurface`; it must not bypass chat controllers/renderers or provider runtimes.
- Existing provider capabilities remain provider-owned and cannot be reimplemented inside `features/tasks`.

### New feature module: `features/tasks`

A new feature module owns work-order indexing, board UI, manual run coordination, prompt rendering, run ledgers, board configuration, role/criteria resolution, and task-note updates. It must **not** parse Codex JSON-RPC or provider-native transcripts directly. All provider behavior stays behind `ChatRuntime`, `ProviderRegistry`, existing chat controllers/renderers, and provider history services.

### Deep modules (simple, stable, isolation-testable interfaces)

- **`TaskNoteStore`** — the single read/write boundary for work-order notes. Parses frontmatter into a typed `TaskSpec`, writes back only orchestrator-owned fields (status, run/conversation IDs, run metadata), and updates generated run-ledger/handoff regions by marker, never touching user-authored prose. Compare-and-swap / lock semantics protect against overwriting concurrent human edits. This is a deep module: a small surface (`read`, `writeStatus`, `appendLedger`, `writeHandoff`) hiding Markdown/YAML and generated-region mechanics.

- **`TaskStateMachine`** — pure transition logic over the MVP internal lifecycle: `inbox → ready → running → {needs_input, needs_approval} → review → {needs_fix → ready, done} | failed | canceled`. Validates whether a transition is legal and is the only authority on internal next-state. No I/O. `needs_fix` is the review-rejection state that routes back toward development.

- **`BoardConfigStore`** — loads, validates, and normalizes the default/user board configuration. Provides lane definitions, display labels/order, mapping from statuses to lanes, role definitions, definitions of ready/done, and prompt snippets for the current lane/role. Invalid config fails loudly, keeps last known-good/default behavior, and surfaces a board-visible error. MVP supports configuration as data; full automation from these rules is later.

- **`TaskExecutionSurface`** — narrow seam introduced immediately so headless mode can be a later adapter without coupling run coordination to tabs.
  ```ts
  interface TaskExecutionSurface {
    startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  }
  ```
  MVP ships exactly one adapter: **`ChatTabExecutionSurface`**, which reuses `TabManager`, `InputController`, `StreamController`, and existing renderers (`MessageRenderer`, `ToolCallRenderer`, `WriteEditRenderer`, `InlinePlanApproval`, `InlineAskUserQuestion`). `HeadlessExecutionSurface` is explicitly out of scope.

- **`WorkflowNoteStore`** — parses optional workflow notes and renders the run prompt from work-order fields, the workflow template, current lane criteria, and assigned role. Rendering is **strict**: unknown variables or filters fail validation rather than rendering blanks. Invalid workflow reloads keep the last known-good/default workflow and surface an operator-visible error. For MVP a built-in default template is used when no workflow note exists.

### Supporting modules (thinner, MVP-level)

- **`TaskIndexer`** — watches the configured folder, builds the in-memory board model from `TaskNoteStore` reads, applies `BoardConfigStore` lane mapping, and emits change events to the view. Skips unparseable notes and records them as errored rather than throwing.
- **`TaskRunCoordinator`** — orchestrates a single manual run: validate task/config/role/criteria → acquire single-run ownership → call the execution surface → drive `TaskStateMachine` transitions from stream/lifecycle signals → write ledger and handoff via `TaskNoteStore`. Owns the "one run per work order" invariant.
- **`AgentBoardView` / `AgentBoardRenderer` / `TaskCard`** — register `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`, render configured lanes and cards, and wire card actions (Open, Run, Stop, Retry, Mark review/done/canceled).
- **`TaskRunLedger`** — formats concise ledger entries (`timestamp — status — message`) for `TaskNoteStore` to write into the generated region.
- **`taskCommands`** — command-palette entries for create-work-order (from note/selection/browser/chat/context), Run, and Run next ready.
- **`ChatWorkOrderLinker`** — optional helper for promoting chat messages/conversations into work orders and linking work orders back to conversations without making chat depend on tasks.

### Data contract

#### Work-order frontmatter

Work-order frontmatter follows the `type: claudian-work-order`, `schema_version: 1` shape from the idea note, but MVP only reads/writes the subset it needs:

- identity: `id`, `title`, `status`, `priority`;
- assignment: `owner`, `assignee`, `role`, `agent`;
- provider/runtime: `provider`, `model`, `mode`;
- context: `context`;
- permissions: `permissions`;
- execution: `run_id`, `conversation_id`, `sidepanel_tab_id`, `started`, `finished`, `attempts`.

Unused frontmatter (worktree, full evidence/result blocks, future role-routing fields) is preserved verbatim on write but not driven by MVP.

MVP internal status set: `inbox, ready, running, needs_input, needs_approval, review, needs_fix, done, failed, canceled`. Later internal states (`scheduled, retry_scheduled, stalled, blocked`) are out of scope.

Generated regions are delimited by explicit markers:

```md
<!-- claudian:run-ledger-start -->
<!-- claudian:run-ledger-end -->

<!-- claudian:handoff-start -->
<!-- claudian:handoff-end -->
```

Everything outside markers is user-owned.

#### Board configuration contract

MVP should support a default config and an optional user config. Exact storage location can be decided during implementation, but the normalized shape should support:

```yaml
schema_version: 1
lanes:
  - id: ready
    title: Ready
    statuses: [ready]
    definition_of_ready:
      - Objective is clear
      - Acceptance criteria are present
      - Required context links are attached
    definition_of_done:
      - Run can start or be assigned
    allowed_roles: [owner, implementer, agent]
  - id: review
    title: Review
    statuses: [review, needs_fix]
    definition_of_ready:
      - Handoff was written
      - Verification notes are present
    definition_of_done:
      - Human verdict recorded
      - Remaining risks are captured
roles:
  - id: owner
    title: Owner
    kind: human
  - id: agent
    title: Default Agent
    kind: agent
    provider: default
```

MVP config capabilities:

- lane display names/order/visibility;
- mapping internal statuses to lanes;
- per-lane definition of ready/done text;
- role definitions with `kind: human | agent | mixed`;
- optional default role per lane.

Explicit MVP limits:

- no arbitrary custom internal statuses;
- no custom transition graph beyond `TaskStateMachine`;
- no automated enforcement of every checklist item unless it can be validated structurally;
- no WIP-limit enforcement beyond optional display metadata;
- no automatic role-based routing or scheduling.

### Boundary & safety decisions

- One running work order owns one run ID, one conversation, one sidepanel tab.
- Direct chat sessions need no work order and no board config.
- Effective permissions come from settings + per-run approval, never self-granted by the note's YAML. MVP posture: auto-run off; file writes limited to the task's own status/log fields; shell/network/commit gated to "ask"; push/PR excluded.
- Secrets are deny-by-default: never inject `.env*`, credential files, provider configs, or private keys into prompts/logs.
- `features/tasks` writes vault internals (`.obsidian/`, `.claude/`, `.codex/`, `.claudian/`, `.git/`) only through owned APIs, never as agent free-write.
- Configured definitions of ready/done are guidance and prompt context in MVP; they do not grant permissions or override safety policy.

## Testing Decisions

A good test verifies **external behavior through the module's public interface**, not its internals. Tests assert on inputs and observable outputs (returned values, written note content, emitted state), never on private methods or call ordering. Tests mirror `src/` under `tests/unit/` and `tests/integration/` per project convention; use the `itPosix`/`itWin32` helpers for path-sensitive cases.

Modules to test with TDD:

- **`TaskNoteStore`** (unit) — frontmatter parse round-trips; writing status/run fields preserves unrelated frontmatter and body prose verbatim; run-ledger and handoff appends land only inside markers; generated-region writes are idempotent and never touch user content; compare-and-swap rejects/merges a write when the note changed underneath.
- **`TaskStateMachine`** (unit) — every legal transition accepted, every illegal transition rejected; `review → needs_fix` and `needs_fix → ready` round-trip; terminal states (`done`, `canceled`, `failed`) reject further transitions. Pure-function tests, no fixtures.
- **`BoardConfigStore`** (unit) — default config loads; lane/status mapping works; definitions of ready/done preserve user text; role definitions normalize; invalid config falls back to last known-good/default and reports an error; custom display labels do not change internal statuses.
- **`WorkflowNoteStore`** (unit) — workflow note parse; strict prompt rendering succeeds with all variables present; current lane criteria and assigned role are included; unknown variable/filter fails loudly; invalid workflow keeps last known-good/default and reports an error.
- **`TaskExecutionSurface` / `ChatTabExecutionSurface`** (contract) — drive the adapter with a fake `ChatRuntime` that emits text chunks, tool use/result chunks, write/edit chunks, approval requests, ask-user requests, plan-completed metadata, cancellation, provider error, and resumed-session metadata; assert the coordinator advances task status and writes ledger entries correctly for each.
- **`ChatWorkOrderLinker` / chat non-regression** (unit/contract) — promoting chat content creates a work order without changing normal chat behavior; chat sessions still send/stream/cancel/resume without task services loaded.

Integration tests (representative MVP subset):

- direct chat session still works without Agent Board/work-order state;
- note → eligible task → manual run → review state;
- configured lane labels/order render while internal status transitions remain stable;
- lane DoR/DoD and assigned role appear in the generated run prompt/handoff context;
- sidepanel tab closed mid-run;
- plugin reload during a running task;
- user edits note during a run;
- corrupted work-order frontmatter skipped safely;
- invalid board config falls back safely;
- successful run persists conversation/run IDs.

## Out of Scope

- Replacing or deprecating the direct chat sidepanel.
- Requiring users to create a workspace/work order before using provider chat.
- Autonomous background daemon, cron-like scheduler, retry scheduling beyond manual retry.
- Multi-agent concurrency pool; dependency DAGs; recursive task spawning.
- `GitWorktreeWorkspaceAllocator` and worktree allocation. MVP runs in the current vault/repo context.
- Evidence bundles, changed-file attribution, `unknown`/`conflicted` indicators, leases/stale-run detection.
- Custom internal state machines or arbitrary transition graphs. MVP supports configurable lane display/criteria mapped to fixed internal statuses.
- Automated enforcement of all definition-of-ready / definition-of-done checklist items.
- WIP-limit enforcement, Review Guard automation, and full workflow/rule language.
- `HeadlessExecutionSurface` and background execution.
- GitHub/Linear sync, PR creation/push automation, playbook learning, multi-run comparison.
- Any auto-push / auto-PR / auto-merge; dependency installation without approval; agent-controlled permission or MCP/plugin changes.

## Acceptance Criteria Summary

MVP is acceptable when:

- Direct chat sidepanel still works independently, with explicit non-regression coverage.
- A user can create a Markdown work order from command/current note/selection/browser/chat.
- A default Agent Board renders work orders into lanes.
- A user can configure board lane labels/order/status mapping, per-lane DoR/DoD text, and roles within the MVP configuration limits.
- A user can run a work order through a visible sidepanel chat tab.
- The run writes ledger and handoff content only into generated regions.
- A work order cannot have competing active runs.
- The board survives malformed work orders/config without crashing.
- Core modules have unit/contract tests, and representative integration tests pass.

## Further Notes

- This PRD intentionally covers the bridge MVP before the Specorator migration. The full multi-phase vision lives in [[docs/ideas/agent-board-symphony.md]] and [[2026-05-28-standalone-product-vision]].
- The product test for MVP has two parts: (1) *Can I keep using direct agent chat exactly as before?* and (2) *Can I create a Markdown work order, run it through Claudian, watch it live, and get a durable result back in Obsidian?*
- Board configuration in MVP is intentionally limited: configurable display/criteria/roles mapped onto a stable internal state model. More powerful workflow automation belongs in later phases.
- Open validation questions (naming "Agent Board" vs alternatives, default permission tier, primary-artifact shape, config storage location) do not block MVP build.
- No ADRs currently exist (`docs/adr/` absent). If MVP locks in long-term boundaries such as `TaskExecutionSurface`, `BoardConfigStore`, or chat/task independence, record ADRs at that point.
