# Claudian Agent Board: Obsidian-Native Symphony Orchestration

Status: idea / design draft  
Date: 2026-05-28  
Owner: Claudian  

Research sources:

- [OpenAI Symphony article](https://openai.com/de-DE/index/open-source-codex-orchestration-symphony/)
- [OpenAI Symphony SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- [Routa repository](https://github.com/phodal/routa) — reviewed at commit `c705c38` on 2026-05-28
- [Routa architecture](https://github.com/phodal/routa/blob/main/docs/ARCHITECTURE.md)
- [Routa API contract](https://github.com/phodal/routa/blob/main/api-contract.yaml)
- [Routa Review Guard workflow](https://github.com/phodal/routa/blob/main/resources/specialists/workflows/kanban/review-guard.yaml)
- [Routa Fitness docs](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
- [Routa design docs overview](https://phodal.github.io/routa/design-docs)
- [Routa core beliefs](https://phodal.github.io/routa/design-docs/core-beliefs)
- [Routa golden rules](https://phodal.github.io/routa/design-docs/golden-rules)
- [Routa execution modes](https://phodal.github.io/routa/design-docs/execution-modes)
- [Routa workspace-centric redesign](https://phodal.github.io/routa/design-docs/workspace-centric-redesign)
- [Routa AgentWatch TUI](https://phodal.github.io/routa/design-docs/agentwatch-tui)
- [Routa Architecture Rule DSL](https://phodal.github.io/routa/design-docs/architecture-rule-dsl)
- [Routa Product IA Visualization](https://phodal.github.io/routa/design-docs/product-ia-visualization)
- [Routa Git Commit Safety Mechanism](https://phodal.github.io/routa/design-docs/git-commit-safety-mechanism)
- [Routa Harness Trace Learning Phase 2](https://phodal.github.io/routa/design-docs/harness-trace-learning-phase2)
- [Codex App Server article](https://openai.com/index/unlocking-the-codex-harness/)
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Obsidian properties](https://obsidian.md/help/properties)
- [Obsidian registerView API](https://obsidian-developer-docs.pages.dev/Reference/TypeScript-API/Plugin/registerView)
- [Linear AI Agents](https://linear.app/docs/agents-in-linear)
- [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions)

## Executive summary

Build **Claudian Agent Board**: an Obsidian-native agent operations layer where Markdown notes become durable work orders, Claudian provides the board and orchestration, and existing sidebar chat tabs provide live execution and observability.

This should be **Symphony-inspired, not Symphony-copied**. Symphony turns an external issue tracker such as Linear into a control plane for coding agents. Claudian should turn the Obsidian vault itself into the control plane:

- Work is captured as plain Markdown notes with YAML frontmatter.
- The board is a view over those notes, not a proprietary database.
- Agent execution reuses Claudian's existing provider runtimes and sidepanel renderers.
- The first product loop is manual and visible: create a work order, run it, watch it, review the proof-of-work.
- Autonomous polling, retries, concurrency, dependency DAGs, and headless execution come later after the note-to-agent loop is proven.

Positioning:

> Plan in Markdown. Run in worktrees. Review with evidence.

## Research inputs

### OpenAI Symphony

OpenAI describes Symphony as an agent orchestrator that turns a project-management board into a control plane for coding agents: every open task gets an agent, agents run continuously, and humans review the results. The key product insight is that teams should manage work units rather than micromanaging sessions. Symphony treats ticket state as a state machine, assigns dedicated workspaces per issue, restarts stalled or failed agents, and preserves enough observability to operate multiple runs.

The Symphony spec is useful because it defines the operational primitives Claudian needs:

- tracker reader
- workflow loader
- configuration layer
- orchestrator
- workspace manager
- agent runner
- status surface
- structured logs
- retry/backoff
- bounded concurrency
- restart recovery
- path containment and workspace safety

Important adaptation: Symphony's tracker is Linear. Claudian's tracker should be Markdown notes in the vault.

### Codex App Server

OpenAI's Codex App Server exists specifically to expose Codex as a UI-friendly, bidirectional event stream. Claudian already has a Codex app-server adapter and should reuse it instead of inventing a task-specific Codex integration.

Relevant takeaways:

- Codex app-server is designed for rich UI clients, not only scripts.
- The protocol has stable and experimental surfaces; clients opt into experimental APIs at initialization.
- Claudian's existing `CodexChatRuntime` already handles stream projection, approvals, ask-user flows, plan mode, JSONL history, thread resume, and session state.
- A task orchestrator should call the existing `ChatRuntime` boundary rather than touching provider JSON-RPC directly.

### Obsidian product fit

Obsidian properties are stored as YAML frontmatter in Markdown files, and Obsidian custom views are registered through the plugin API. This makes the proposed board natural for Claudian:

- task metadata can remain readable and editable as frontmatter;
- the task body can hold human-authored context, acceptance criteria, and handoff notes;
- a custom Agent Board view can render those notes as a status board;
- users can still query, link, search, and edit work orders even if Claudian is disabled.

### Competitive context

Linear already supports agents as app users that can be delegated issues and guided with Markdown instructions. GitHub Copilot cloud agent can be started from issues, dashboards, IDEs, GitHub Mobile, CLI, MCP-capable tools, Slack/Jira/Linear, and other entry points; it can work in the background and raise PRs for review.

Claudian should not compete as "Linear/GitHub, but in Obsidian." The stronger wedge is:

> A local-first agent operations board for developers whose specs, plans, context, and working memory already live in Markdown.

Claudian's advantage is the connection between rich vault context and local provider runtimes, not generic project management.

### Routa

Routa is a strong adjacent reference because it treats the board as a **workspace-first multi-agent coordination platform** rather than a decorative task list. Its useful product pattern is that goals, tasks, sessions, traces, evidence, review, and completion state stay visible on the board instead of disappearing inside one long chat thread.

Relevant takeaways:

- The workspace is the top-level boundary for tasks, sessions, notes, boards, codebases, worktrees, memories, and traces.
- A Kanban card is not only UI state; lane transitions can trigger or route automation.
- Each lane can have a specialist contract: backlog refinement, todo orchestration, development, review, done reporting, or blocked resolution.
- Downstream lanes are deliberately stricter than upstream lanes. Review does not trust development self-assessment.
- Card artifacts grow as the work moves: story YAML, execution brief, dev evidence, review verdict, completion summary.
- Traces are first-class audit objects, not incidental log output.
- Fitness gates make validation evidence explicit through tiered checks instead of vague "tests passed" claims.

The adaptation for Claudian is to keep these lessons **Markdown-first and plugin-local**. Routa is a broad platform with web, desktop, server, protocol, and API surfaces. Claudian should not copy that platform scope. Claudian should adopt the product contracts: workspace scope, lane contracts, evidence bundles, independent review, and traceability.


### Routa design docs

The published Routa design docs add a second layer of guidance beyond the repository source review:

- Durable knowledge belongs in canonical docs, not chat history, oversized agent instructions, or duplicated legacy specs.
- `AGENTS.md` should route agents to the right canonical docs rather than becoming the whole knowledge base.
- Execution modes should be described by **orchestration boundary**, not by simple/advanced labels: session-first, board/lane-first, or lead/team-first.
- Workspace scope should be explicit on all user-visible resources, and codebases should be first-class records rather than hidden fields on a workspace.
- Observability should answer operator questions in real time: which session is active, which files changed, where attribution is unknown, and whether multiple runs touched the same file.
- Machine-readable rule packs should separate rule intent from executor implementation, validate strictly, and fail loudly on unsupported semantics.
- Safety should be layered: application validation, local hooks/checks, push/CI gates, monitoring, and incident records.
- Trace learning can become playbook-driven preflight guidance, but it must remain opt-out and evidence-backed.
- ADRs are useful only for decisions that affect long-term boundaries, not every implementation detail.

The Claudian adaptation is to create a **curated, vault-native design record** for Agent Board itself: this idea note can seed a future product spec and ADRs, while individual work orders remain execution artifacts rather than the canonical architecture source.

## Product principle

Do not build a generic task manager. Build an **agent work-order system**.

A work order is a Markdown note that contains:

- the goal;
- acceptance criteria;
- linked context from the vault;
- selected files or repository scope;
- effective permissions;
- workspace/branch/run metadata;
- a concise run ledger;
- proof-of-work and final handoff.

The task note owns intent, status, and reviewable outcome. The sidepanel conversation owns live interaction. Provider-native transcripts own detailed execution history. The orchestrator links these sources instead of duplicating all of them into one place.

## Routa lessons to adopt without overbuilding

Routa improves the design in five important ways:

1. **Workspace-first scope**: every work order should know which vault/repo/worktree context it belongs to. The default can be the current vault and current repository, but the domain model should still name the workspace explicitly.
2. **Board as coordination bus**: the Agent Board should eventually do more than group statuses. Lane changes can run validation, open a review gate, or request missing evidence. MVP should keep these actions manual, but the model should not make the board passive-only.
3. **Lane-specific contracts**: one generic workflow prompt is not enough long term. Claudian should support separate workflow notes/templates for refinement, execution planning, development, review, done reporting, and blocked resolution.
4. **Evidence-first review**: a task should not move from `review` to `done` because the implementing agent says it is done. It should provide changed files, verification commands, per-acceptance-criterion results, commit/PR references, artifacts, caveats, and remaining risks.
5. **First-class traces**: live chat is for observation, task notes are for durable handoff, and structured traces are for audit/debugging. These three surfaces should link to one another instead of collapsing into one transcript.

What not to adopt from Routa for the first Claudian version:

- a separate web platform or API server;
- protocol aggregation as a product goal;
- many autonomous lane agents before a single visible run is trusted;
- hidden databases as the source of truth for task state;
- board automation that can mutate repositories without explicit user intent.

A practical compromise is: **manual lane transitions in MVP, lane contracts in the data model, automated lane reactions later**.


## Design-doc refinements from Routa

### Execution modes by orchestration boundary

Do not describe Agent Board as an "advanced chat" feature. Use the boundary that starts orchestration:

| Mode | Orchestration starts from | Claudian implication |
|---|---|---|
| Sidepanel session | one recoverable conversation thread | current plugin baseline and MVP execution surface |
| Agent Board | one Markdown work order and status lane | repeatable delivery flow with evidence and review gates |
| Agent Team | a lead agent that delegates visible child runs | future mode for multi-specialty or multi-codebase work |

This wording matters because it prevents the UI from implying a maturity ladder. A work order is not better than chat; it is better when delivery state, review evidence, and repeatable flow are the actual problem.

### Canonical knowledge and provenance

A work order is an execution artifact, not the long-term home for product truth. If a run discovers durable knowledge, the result should link or propose updates to the right canonical note:

- product intent: `docs/product-specs/` or `docs/ideas/`;
- architecture decision: `docs/adr/`;
- implementation plan: short-lived execution plan note;
- regression/failure: issue or incident note;
- task result: the work-order handoff.

This is especially important in Obsidian because everything is easy to link. The Agent Board should encourage links to canonical notes instead of letting every task become a mini knowledge silo.

### Operator observability model

Borrow the AgentWatch shape for the board detail pane and sidepanel watcher:

1. **Runs** — active / idle / stopped, model, workspace, branch, last activity.
2. **Files** — changed files, dirty state, last attributed run, conflict indicator.
3. **Detail** — selected run/file summary, current command, current approval/input request.
4. **Event log** — condensed operator timeline, not a full transcript.

The UI should explicitly show `unknown` and `conflicted` attribution. Unknown is safer than pretending the agent owns a file change when the source is ambiguous.

### Rules as validated YAML, not prompt folklore

Workflow notes should be complemented by small machine-readable rule packs over time. Keep them simple and strictly validated:

```yaml
schema: claudian.agent-board.rules/v1
model:
  id: default-agent-board-rules
selectors:
  task_workspace:
    kind: path_scope
    include:
      - "{{ task.codebase.worktree }}/**"
rules:
  - id: no_main_checkout_writes
    title: Agent runs must not write to the main checkout
    kind: path_boundary
    severity: error
    from: task_run
    relation: must_write_within
    to: task_workspace
```

Unsupported rule kinds should fail validation rather than being silently ignored. This keeps future automation auditable and LLM-editable without hiding policy inside prompts.

### Playbook learning after evidence exists

Trace learning should be a late-stage enhancement. Once Claudian has enough evidence bundles, it can suggest playbooks such as "UI task with tests and screenshot" or "docs-only PR" before a run starts. The playbook should show confidence, evidence count, and recommended verification, and users must be able to opt out.

## Proposed user experience

### Capture

Users can create an agent work order from:

- a command palette action;
- the current note;
- selected editor text;
- a browser selection;
- an existing chat message;
- a file/folder context mention;
- a failed build or test output pasted into a note.

The result is a normal Markdown note under a configurable folder, for example:

```text
Agent Board/tasks/2026-05-28-add-agent-board-mvp.md
```

### Board

Register a new view, for example `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`, and render cards grouped by frontmatter status:

```text
Inbox | Ready | Running | Needs Input | Needs Approval | Review | Needs Fix | Done | Failed | Canceled
```

Each card should show:

- title;
- workspace/codebase;
- provider/model;
- current status;
- priority;
- workspace/branch;
- latest event and heartbeat age;
- pending approval/input indicator;
- verification result;
- changed-file and attribution summary;
- conflict/unknown attribution warning;
- linked conversation/run log;
- retry count and last error.

Primary card actions:

- Open note
- Run
- Watch live run
- Stop
- Retry
- Open diff/log
- Request fixes
- Mark review/done/canceled

### Execution

The first execution surface should be visible sidepanel execution:

1. User clicks **Run** on a work order.
2. Claudian validates frontmatter and workflow configuration.
3. Claudian creates or reuses a chat tab bound to the task.
4. Claudian renders the task prompt from the work order and workflow template.
5. Existing `ChatRuntime` + chat controllers stream the run.
6. Existing renderers show text, tool calls, diffs, todo state, plan approval, ask-user prompts, and subagent events.
7. Claudian updates the task note with run metadata, status, concise ledger entries, and final handoff.

This keeps trust high and avoids duplicating the streaming UI.

### Review

The work order should end with a human-reviewable package:

- summary of what changed;
- files changed;
- branch/worktree;
- commit SHA, if any;
- PR URL, if any;
- verification commands and results;
- screenshots or artifacts, if relevant;
- remaining risks;
- next suggested action.

## Markdown work-order contract

### Frontmatter

Keep frontmatter compact and machine-readable. Avoid putting high-frequency stream output in YAML.

```yaml
---
type: claudian-work-order
schema_version: 1

id: task-20260528-add-agent-board-mvp
title: Add Agent Board MVP
status: ready
priority: normal

created: 2026-05-28T01:07:00+02:00
updated: 2026-05-28T01:07:00+02:00
due:

provider: codex
model:
agent: main
mode: plan-first

workspace:
  id: current-vault
  mode: git-worktree
  root: .worktrees
codebase:
  id: current-repo
  repo: .
  branch:
  worktree:
  base: main

context:
  notes:
    - "[[CLAUDE.md]]"
  files: []
  urls: []

permissions:
  tier: read_only
  vault_write: ask
  repo_write: ask
  shell: ask
  network: ask
  publish: ask

execution:
  run_id:
  conversation_id:
  provider_session_id:
  sidepanel_tab_id:
  started:
  finished:
  attempts: 0
  max_attempts: 1
  last_heartbeat:

result:
  outcome:
  branch:
  commit:
  pr:
  verification: []
  artifacts: []

error:
  code:
  message:
---
```

### Status values

Start with a small lifecycle:

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

`needs_fix` is the review-rejection state: the task has produced an implementation, but the reviewer or review gate found issues that should route it back to development.

Later additions may include:

```text
scheduled
retry_scheduled
stalled
blocked
```

### Body

```markdown
# Add Agent Board MVP

## Objective

What should the agent accomplish?

## Acceptance Criteria

- [ ] Ready work orders appear on the Agent Board.
- [ ] Running a work order opens or links to a Claudian sidepanel conversation.
- [ ] Final result is written back to the task note.

## Context

Relevant notes, files, links, selections, prior decisions, screenshots, or browser captures.

## Constraints

- Reuse existing `ChatRuntime` and sidepanel rendering.
- Prefer provider-neutral architecture.
- Do not edit unrelated files.

## Suggested Plan

Optional human-authored plan.

## Execution Brief

Optional planner output: scope, key files, assumptions, risk notes, and intended verification.

## Run Ledger

<!-- claudian:run-ledger-start -->
<!-- claudian:run-ledger-end -->

## Dev Evidence

Changed files, implementation summary, commands run, per-acceptance-criterion verification, caveats, branch, commit, and PR.

## Review Findings

Independent reviewer verdict, defects, missing evidence, requested fixes, or approval rationale.

## Verification

Commands, checks, or manual review steps.

## Result / Handoff

Final summary, branch, commit, PR, artifacts, and remaining risks.
```


### Evidence bundle

Routa's review-gate pattern suggests that Claudian should make proof-of-work a first-class artifact. The task note can remain readable while structured logs retain detail, but every completed run should produce an evidence bundle with at least:

- changed files and whether they are committed;
- commands run and exit status;
- per-acceptance-criterion verification;
- final git status or known dirty files;
- branch, commit, PR, or artifact links when available;
- screenshots or rendered outputs when useful;
- caveats, skipped checks, and remaining risks.

Possible later frontmatter extension:

```yaml
evidence:
  required:
    - changed_files
    - acceptance_criteria_verification
    - verification_commands
  bundle_id:
  completeness:
review:
  verdict:
  reviewer:
  findings: []
  routed_to:
```

The board should surface missing evidence directly on the card. A review transition can be blocked or routed to `needs_fix` when required evidence is absent.

### Generated-region ownership

Everything outside generated regions is user-owned unless the user explicitly asks the agent to edit it.

Use explicit markers:

```markdown
<!-- claudian:run-ledger-start -->
- 2026-05-28T01:12:30+02:00 — `running` — Started Codex run in sidepanel tab `abc123`.
- 2026-05-28T01:14:02+02:00 — `needs_approval` — Plan generated; awaiting approval.
- 2026-05-28T01:20:44+02:00 — `review` — Implementation finished; verification passed: `npm run typecheck`.
<!-- claudian:run-ledger-end -->
```

Raw stream events should go to structured logs, not the note body.

## Workflow notes

Support optional workflow notes as Obsidian-native equivalents of Symphony's `WORKFLOW.md`:

```md
---
type: claudian-workflow
schema_version: 1
active_states:
  - ready
terminal_states:
  - done
  - canceled
agent:
  max_concurrent_agents: 1
  max_turns: 10
  max_retry_backoff_ms: 300000
codex:
  approval_policy: on-request
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
workspace:
  id: current-vault
  mode: git-worktree
  root: .worktrees
codebase:
  id: current-repo
  repo: .
evidence:
  required_sections:
    - dev_evidence
    - acceptance_criteria_verification
    - verification
validation:
  tiers:
    fast: []
    normal: []
    deep: []
---

You are working from an Obsidian work order.

Work order note: {{ task.path }}
Title: {{ task.title }}
Status: {{ task.status }}

## Objective

{{ task.objective }}

## Body

{{ task.body }}

Follow repository instructions in AGENTS.md and CLAUDE.md. For non-trivial repository changes, use a topic branch/worktree and provide verification plus remaining risks.
```

Rendering should be strict: unknown variables or filters fail validation. Invalid workflow reloads should keep the last known good workflow and surface an operator-visible error.

## Architecture

### Module layout

```text
src/features/tasks/
├── CLAUDE.md
├── model/
│   ├── taskTypes.ts
│   ├── taskStateMachine.ts
│   └── workflowTypes.ts
├── storage/
│   ├── TaskNoteStore.ts
│   ├── WorkflowNoteStore.ts
│   └── TaskEventLogStore.ts
├── indexing/
│   └── TaskIndexer.ts
├── scheduling/
│   ├── TaskScheduler.ts
│   └── TaskLeaseManager.ts
├── execution/
│   ├── TaskRunCoordinator.ts
│   ├── TaskExecutionSurface.ts
│   ├── ChatTabExecutionSurface.ts
│   └── HeadlessExecutionSurface.ts
├── workspace/
│   ├── TaskWorkspaceAllocator.ts
│   ├── VaultWorkspaceAllocator.ts
│   └── GitWorktreeWorkspaceAllocator.ts
├── observability/
│   ├── TaskRunLedger.ts
│   └── TaskRunSnapshot.ts
├── ui/
│   ├── AgentBoardView.ts
│   ├── AgentBoardRenderer.ts
│   ├── TaskCard.ts
│   └── TaskDetailPane.ts
└── commands/
    └── taskCommands.ts
```


### Lane contracts

Borrow Routa's specialist-lane idea, but express it as Obsidian workflow notes instead of platform-specific agents. A lane contract is a prompt plus an evidence contract for a particular transition.

Useful default lanes:

| Lane | Purpose | Required output |
|---|---|---|
| Backlog Refiner | Turn rough capture into a ready work order | objective, acceptance criteria, constraints |
| Todo Orchestrator | Produce execution brief | plan, key files, risks, validation approach |
| Dev Executor | Implement in assigned workspace | changed files, commands, AC verification |
| Review Guard | Independently verify result | verdict, findings, route to `done` or `needs_fix` |
| Done Reporter | Produce durable handoff | summary, artifacts, remaining risks |
| Blocked Resolver | Clarify missing input or dependency | blocking reason, requested human action |

For MVP, these can be documented sections and manual commands. Later, each lane can become an executable workflow note.

### Boundary rules

- `features/tasks` owns work-order indexing, board UI, scheduling, leases, prompt rendering, run ledgers, and task note updates.
- `features/tasks` must not parse Codex JSON-RPC or provider-native transcripts directly.
- Provider behavior stays behind `ChatRuntime`, `ProviderRegistry`, and provider history services.
- The visible execution adapter reuses `TabManager`, `InputController`, `StreamController`, `MessageRenderer`, `ToolCallRenderer`, `WriteEditRenderer`, `InlinePlanApproval`, and `InlineAskUserQuestion`.
- Worktree allocation is a separate workspace module, not embedded in the scheduler or provider runtime.

### Execution surface seam

Introduce a narrow seam immediately so headless mode can come later without coupling the scheduler to tabs:

```ts
interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
}
```

First adapter:

```text
ChatTabExecutionSurface
```

Later adapter:

```text
HeadlessExecutionSurface
```

The scheduler should only decide eligibility and acquire leases. It should not know about sidepanel DOM, Codex sessions, or provider stream details.

### Symphony mapping

| Symphony concept | Claudian Agent Board concept |
|---|---|
| Linear issue | Markdown work-order note |
| Issue tracker reader | `TaskNoteStore` + `TaskIndexer` |
| `WORKFLOW.md` | Obsidian workflow note or repository workflow file |
| Active/terminal states | frontmatter `status` + workflow config |
| Per-issue workspace | vault root or `.worktrees/<slug>` |
| Orchestrator | `TaskScheduler` + `TaskRunCoordinator` |
| Agent runner | provider-neutral `ChatRuntime` via execution surface |
| Runtime events | `StreamChunk`s + `TaskEventLogStore` |
| Dashboard/status API | Agent Board Obsidian view |
| Structured logs | `.claudian/tasks/<task-id>/runs/<run-id>.jsonl` |

### Routa mapping

| Routa concept | Claudian adaptation |
|---|---|
| Workspace-first coordination | explicit workspace + first-class codebase + worktree allocator |
| Kanban lane automation | manual board actions first, lane-triggered workflows later |
| Specialist workflows | Obsidian workflow notes per lane |
| Review Guard | independent review gate that routes to `done` or `needs_fix` |
| Fitness gates | tiered validation commands and required evidence sections |
| Trace/evidence model | linked note ledger + JSONL run trace + evidence bundle |
| Execution modes | sidepanel session, board/work-order, future lead/team mode |
| AgentWatch operator view | runs/files/detail/event-log panes in board detail |
| Architecture Rule DSL | future `claudian.agent-board.rules/v1` YAML policy packs |
| Trace learning | future opt-out playbooks from evidence-backed prior runs |

## Safety model

Treat this feature as local automation with powerful side effects, not a secure sandbox.

Required invariants:

1. A task note can request capabilities but cannot grant itself more privilege.
2. Effective permissions come from user/global settings and per-run approval, not only YAML.
3. Main checkout stays clean for non-trivial repository changes.
4. Worktree paths are canonicalized and verified under the configured root before use.
5. One running work order owns one run ID, one conversation, one workspace, and one branch.
6. State transitions are finite, validated, and logged.
7. Frontmatter updates use a lock or compare-and-swap strategy to avoid overwriting human edits.
8. The orchestrator, not the agent, owns generated log regions and durable run event logs.
9. Secrets are deny-by-default: never include `.env*`, credential files, provider configs, private keys, raw environment dumps, or auth headers in prompts/logs without explicit approval.
10. Publishing is a separate human gate: push and PR creation require explicit approval in MVP.
11. Retry limits, stall timeouts, max turns, token/cost ceilings, and max child-agent count are hard limits.
12. The run UI always shows workspace, branch, effective capabilities, approval mode, and current state.
13. Commit identity, branch target, and repository root are validated before commit/publish actions.
14. Mass deletion, large file churn, force-like operations, and unusual dirty-state transitions require explicit human confirmation and a recorded justification.

Recommended MVP permission posture:

```text
auto-run: off
shell: ask
file writes: task workspace only
vault note mutation: only the task's own status/log fields without asking
network: ask
package install/scripts: ask or excluded
commit: ask and validate git identity
push/PR: ask every time
mass deletion/large churn: block until justified
```

Capability tiers:

1. `read_only` — read task context, repo status, and diffs; no mutation.
2. `workspace_write` — write inside assigned worktree only; update task status/log through orchestrator.
3. `verify_local` — run approved local verification commands; no install/network by default.
4. `git_local` — stage/commit inside task branch; no push.
5. `publish` — push branch or create PR; explicit human approval per run.

Exclude from MVP:

- fully unsupervised auto-run from arbitrary Markdown tasks;
- auto-push, auto-PR, auto-merge;
- cross-vault or arbitrary external-directory mutation;
- dependency installation or package manager scripts without explicit approval;
- agent-controlled permission changes;
- agent-controlled MCP/plugin installation;
- edits to `.obsidian/`, `.claude/`, `.codex/`, `.git/`, or `.claudian/` internals except through owned APIs;
- concurrent agents editing the same files without locking/merge policy;
- force push, branch deletion, `git clean`, destructive reset, mass deletion without justification, or history rewrite;
- automatic recursive task spawning.

## Observability

### Structured logs

Store detailed run events under Claudian-owned state:

```text
.claudian/tasks/<task-id>/runs/<run-id>.jsonl
```

Each event should include:

- `taskId`, `runId`, provider, model, runtime;
- workspace, branch, base commit;
- effective capabilities and approval mode;
- state transition;
- command start/end summary;
- file mutation summary;
- approval/input request summary;
- retry/stall/error classification;
- token/runtime totals when available;
- verification result;
- evidence bundle references;
- policy decision references;
- commit/PR/artifact references.

### Human-readable note ledger

The note ledger should be concise and useful if read months later. Do not paste full chat transcripts or raw JSON-RPC events into task notes.

### Board status

The board should make the operational state obvious:

- running / stalled / blocked / failed / review / done;
- heartbeat age;
- current workspace;
- last command summary;
- pending approval/input;
- cancel/retry controls;
- diff/log links;
- verification status;
- remaining risks.

## Product review synthesis

Dedicated review passes produced six strong recommendations:

1. **Obsidian-native product review**: keep Markdown as the product center. The task note must remain useful and readable if Claudian is uninstalled. Avoid turning YAML into a large hidden database.
2. **Architecture review**: visible sidepanel execution should ship first. Add a `TaskExecutionSurface` seam immediately so headless execution can be a later adapter.
3. **Safety review**: default to manual-first, local-only, no-publish. Worktrees are safety boundaries, not security boundaries. Human approval is the strongest practical control.
4. **Market review**: position around vault-native context-to-agent execution, not generic project management. The ideal initial user already writes specs, implementation notes, and decisions in Obsidian.
5. **Routa review**: model lane contracts and evidence bundles early, but do not copy Routa's broader platform scope. The smallest valuable Claudian version is still a Markdown work order with visible execution and reviewable evidence.
6. **Routa design-doc review**: separate canonical knowledge from work-order execution records, describe modes by orchestration boundary, show file attribution/conflicts explicitly, and move repeated rules toward validated YAML/checks instead of prompt folklore.

## MVP scope

The MVP should answer one question:

> Can I create a Markdown work order, run it through Claudian, watch it live, and get a durable result back in Obsidian?

### Include

- Configurable work-order folder, with a sensible default such as `Agent Board/tasks/`.
- Work-order note creation command.
- Work-order frontmatter validation.
- Agent Board grouped by status.
- Manual **Run** action.
- Manual **Run next ready** action.
- Visible sidepanel execution through existing chat tab infrastructure.
- One active run per work order.
- Concise run ledger written back to generated region.
- Conversation/run IDs persisted in frontmatter.
- Manual stop/retry.
- Basic final handoff section.

### Exclude

- autonomous background daemon;
- multi-agent concurrency pool;
- cron-like scheduler;
- dependency DAG;
- automatic retries beyond manual retry;
- automatic worktree cleanup;
- PR creation/push automation;
- task sync with GitHub/Linear;
- full workflow language;
- headless execution.

## Phased rollout

### Phase 1 — Manual Markdown work orders

- Create `TaskNoteStore` and `TaskStateMachine`.
- Add commands to create/open/run work orders.
- Add Agent Board view.
- Add `ChatTabExecutionSurface`.
- Persist run metadata and note ledger.

### Phase 2 — Safer workspaces and richer evidence

- Add `GitWorktreeWorkspaceAllocator`.
- Capture verification commands/results.
- Add evidence bundle sections and card-level missing-evidence indicators.
- Add diff/log/artifact affordances.
- Add changed-file attribution and `unknown` / `conflicted` file indicators.
- Add leases and stale-run detection even for manual runs.

### Phase 3 — Scheduler-lite and review gate

- Add **Run next ready**.
- Add optional `claudian.agent-board.rules/v1` policy packs for path boundaries, evidence requirements, and transition gates.
- Add WIP limit of one or configurable small number.
- Add retry scheduling for known transient failures.
- Add workflow note parsing and strict prompt templates.
- Add optional Review Guard workflow that independently checks evidence and routes `review` to `done` or `needs_fix`.

### Phase 4 — Headless/background execution

- Add `HeadlessExecutionSurface` only after visible mode proves stable.
- Mirror headless runs into the sidepanel when a user clicks **Watch**.
- Keep approval/input requests visible and bounded by timeouts.

### Phase 5 — External integrations and playbooks

- Optional opt-out playbook suggestions derived from successful evidence bundles.
- Optional GitHub/Linear sync.
- Optional PR creation/publishing gate.
- Optional task DAGs.
- Optional multi-run comparisons.

## Testing strategy

### Unit tests

- frontmatter parse/write;
- generated region updates;
- task state transitions;
- eligibility calculation;
- lease acquisition/expiry;
- retry/backoff math;
- prompt rendering with strict missing-variable failure;
- evidence bundle completeness calculation;
- review transition validation, including `review` → `needs_fix`;
- rule-pack validation with unsupported-rule failure;
- file attribution/conflict folding;
- workspace path sanitization.

### Contract tests

Use a fake `ChatRuntime` that emits:

- text chunks;
- tool use/result chunks;
- write/edit chunks;
- approval requests;
- ask-user requests;
- plan-completed metadata;
- cancellation;
- provider error;
- resumed session metadata.

### Integration tests

- note → eligible task → lease → visible execution → review state;
- sidepanel tab closed mid-run;
- plugin reload during running task;
- user edits note during run;
- corrupted frontmatter skipped safely;
- failed run → retry/manual retry;
- successful run persists conversation/run IDs.

### Worktree tests

Use a temporary git repository and verify:

- worktree under `.worktrees/<slug>`;
- branch created from configured base;
- cwd passed to runtime;
- cleanup scanner detects orphaned workspaces;
- path containment rejects escaped paths;
- mass-deletion and large-churn policies require justification before commit/publish.

## Open validation questions

1. Do Claudian users already manage coding tasks in Obsidian, GitHub, Linear, or elsewhere?
2. Which pain is strongest: task capture, context assembly, parallel monitoring, or review/auditability?
3. Should the primary artifact be one note per work order, checkbox tasks, Kanban cards, or Obsidian Bases compatibility?
4. How many concurrent local agents do target users realistically want to run?
5. What proof-of-work is required before users trust a run: diff, tests, transcript, screenshots, PR link, token usage?
6. Should the first version remain vault-local or sync with GitHub/Linear?
7. Which default permission tier makes users comfortable enough to try it?
8. Does "Agent Board" resonate more than "Work Orders", "Run Board", or "Mission Board"?

## Recommendation

Proceed with a thin prototype:

```text
Markdown work order → Agent Board card → manual Run → visible sidepanel execution → run ledger + handoff
```

Do not start with the daemon. Do not build a generic PM system. The durable value is making Obsidian's linked Markdown context executable by Claudian's existing local agent runtimes.


