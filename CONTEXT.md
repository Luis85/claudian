# Claudian

An Obsidian plugin that embeds provider-backed chat runtimes in a sidebar and inline-edit flow. Claude is the default, full-feature provider; Codex, Opencode, and Cursor are opt-in and join the same conversation model through a provider boundary. This file is the domain glossary: it fixes the vocabulary used across `CLAUDE.md` files, PRDs, and code so that the same concept always has the same name.

## Language

**Provider**:
A chat backend Claudian can drive — currently Claude (default, full-feature), Codex, Opencode, or Cursor (all opt-in). A provider is identified by `Conversation.providerId` and owns its own opaque `providerState`.
_Avoid_: backend, vendor, engine, LLM (LLM is the model, not the provider)

**Provider adaptor**:
The code under `src/providers/<provider>/` that implements a **Provider** against the core contracts — runtime, prompt encoding, stream transforms, history hydration, CLI resolution, settings UI.
_Avoid_: integration, plugin, connector

**Runtime** (`ChatRuntime`):
The provider-neutral chat-facing seam (`src/core/runtime/`) that streams a run: send, stream, cancel, resume, fork, plan mode. The orchestration layer always talks to a **Runtime**, never to provider JSON-RPC directly.
_Avoid_: session driver, executor, agent runner (reserve "agent runner" for external-system mappings only)

**Conversation**:
The provider-neutral unit of chat state. Carries `providerId` and opaque `providerState` (typed per provider as `ClaudeProviderState`, `CodexProviderState`, `OpencodeProviderState`, or `CursorProviderState`).
_Avoid_: thread, session (see below), chat log

**Session**:
A persisted record of a conversation. Provider-neutral metadata lives at `.claudian/sessions/*.meta.json`; provider-native transcripts live under `~/.claude/`, `~/.codex/`, or `~/.cursor/` (Opencode keeps state in its own database).
_Avoid_: history file, save (use "session metadata" vs "transcript" to disambiguate)

**Transcript**:
The provider-native, detailed event log of a run (`*.jsonl` under the provider's home dir). The source of truth for execution detail — not duplicated into notes.
_Avoid_: log, history (too generic)

**Command catalog**:
The shared contract that merges vault commands, vault skills, and runtime-supported commands behind one interface (e.g. `ClaudeCommandCatalog`, `CodexSkillCatalog`).
_Avoid_: command registry, command list

**Skill**:
A reusable agent behavior defined as `SKILL.md` (Claude: `.claude/skills/`; Codex: `.codex/skills/` or `.agents/skills/`), surfaced via `$` and the **Command catalog**.
_Avoid_: macro, plugin, ability

**Subagent**:
A delegated agent run spawned by a parent run (Claude vault agents in `.claude/agents/`; Codex subagents in `.codex/agents/*.toml`).
_Avoid_: child, worker, helper agent

**Workspace service**:
A provider-owned auxiliary service registered through `ProviderWorkspaceRegistry` — command catalogs, agent mention providers, CLI resolution, MCP managers, settings tabs.
_Avoid_: helper, manager (when unqualified)

**Execution surface**:
The narrow seam between run coordination and the **Runtime** that decides *where* a run is observed. MVP ships `ChatTabExecutionSurface` (visible sidepanel); `HeadlessExecutionSurface` is a later adapter.
_Avoid_: runner, executor, backend

## Agent Board language

These terms are defined by the Agent Board work (see [[docs/issues/agent-board-mvp.md]] and [[docs/ideas/agent-board-symphony.md]]). They are scoped to the `features/tasks` module.

**Work order**:
A plain Markdown note (`type: claudian-work-order`) that owns the goal, acceptance criteria, linked context, scope, permissions, and run metadata. The durable unit of delegated work.
_Avoid_: task, ticket, issue (reserve "issue" for the **Issue tracker**; reserve "task" for code-level `TaskSpec` types)

**Agent Board**:
The Obsidian custom view (`VIEW_TYPE_CLAUDIAN_AGENT_BOARD`) that renders **Work orders** as cards grouped by status.
_Avoid_: dashboard, kanban, board (when unqualified)

**Lane**:
A status grouping on the **Agent Board** (Inbox, Ready, Running, Needs Input, Needs Approval, Review, Needs Fix, Done, Failed, Canceled). Backed by frontmatter `status`.
_Avoid_: column, swimlane, bucket

**Run ledger**:
The concise, human-readable timeline written into a generated, marker-delimited region of a **Work order** note. Not a transcript.
_Avoid_: log, history, activity feed

**Handoff**:
The final reviewable result written back to a **Work order**: summary, branch, verification notes, remaining risks, next action.
_Avoid_: report, summary (when unqualified), output

**Issue tracker**:
The project's tracked-work store at `docs/issues/` — a single Markdown note with frontmatter, read/written by skills like `to-prd`. Distinct from the **Agent Board**, which orchestrates agent runs.
_Avoid_: backlog, board (the Agent Board is not the issue tracker)

**Issue**:
A single tracked unit inside the **Issue tracker** (e.g. a PRD), carrying a `triage` role such as `ready-for-agent`.
_Avoid_: ticket, work order (a **Work order** is an Agent Board execution artifact, not an issue tracker entry)

## Relationships

- A **Conversation** belongs to exactly one **Provider** (via `providerId`) and holds opaque `providerState`.
- A **Provider** is implemented by one **Provider adaptor** and creates **Runtimes** plus **Workspace services** via `ProviderRegistry` / `ProviderWorkspaceRegistry`.
- A **Runtime** produces a **Session** (provider-neutral metadata) and a **Transcript** (provider-native detail).
- A **Command catalog** surfaces **Skills** and commands; a run may spawn **Subagents**.
- An **Execution surface** binds a **Work order** run to a **Runtime**; the **ChatTabExecutionSurface** observes it in the sidepanel.
- The **Agent Board** holds many **Work orders**; each **Work order** sits in one **Lane** at a time and accumulates a **Run ledger** and a **Handoff**.
- The **Issue tracker** holds many **Issues**; an **Issue** carries one `triage` role at a time.

## Flagged ambiguities

- "session" meant both the provider-neutral metadata file and the live conversation — resolved: the live unit is a **Conversation**; the persisted metadata is a **Session**; provider-native detail is a **Transcript**.
- "task" is overloaded: code-level types use `TaskSpec`/`TaskRunHandle`, but the user-facing durable unit is a **Work order**. Prefer **Work order** in product/PRD prose; reserve "task" for the `features/tasks` module and its types.
- "board" must always be qualified: **Agent Board** (agent run orchestration) vs the **Issue tracker** (`docs/issues/`). They are not the same surface.
- "agent" is used loosely for both the provider run and a configured **Subagent** — prefer **Subagent** for delegated child runs; use "agent" only for the top-level run or in external-system mappings.
