---
type: research
title: "AI Agent Frameworks and a Roster-of-Agents Feature for Claudian"
date: 2026-06-17
status: draft
scope: agents
tags:
  - research
  - agents
  - multi-agent
related:
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
sources:
  - https://voltagent.dev/docs/agents/overview/
  - https://voltagent.dev/docs/agents/sub-agents/
  - https://voltagent.dev/docs/agents/tools/
  - https://voltagent.dev/docs/agents/memory/
  - https://github.com/VoltAgent/voltagent/blob/main/CONSOLE.md
  - https://docs.crewai.com/en/concepts/agents
  - https://docs.crewai.com/en/concepts/crews
  - https://docs.crewai.com/en/concepts/collaboration
  - https://docs.crewai.com/en/learn/hierarchical-process
  - https://blog.crewai.com/getting-started-with-crewai-build-your-first-crew/
  - https://openai.github.io/openai-agents-python/agents/
  - https://openai.github.io/openai-agents-python/tools/
  - https://openai.github.io/openai-agents-python/handoffs/
  - https://code.claude.com/docs/en/sub-agents
  - https://code.claude.com/docs/en/agent-sdk/subagents
  - https://code.claude.com/docs/en/skills
  - https://reference.langchain.com/python/langgraph-supervisor/supervisor/create_supervisor
  - https://github.com/langchain-ai/langgraph-supervisor-py
  - https://www.langchain.com/blog/command-a-new-tool-for-multi-agent-architectures-in-langgraph
  - https://cognition.ai/blog/devin-2
  - https://cognition.ai/blog/devin-can-now-manage-devins
  - https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session
  - https://docs.devin.ai/working-with-teams/multidevin
  - https://docs.devin.ai/integrations/linear
  - https://docs.devin.ai/integrations/jira
---

# AI Agent Frameworks and a Roster-of-Agents Feature for Claudian

## Why this research

The product goal: a dedicated UI to create and maintain a **roster of named
Agents**, each composed from a **library of skills and tools**, then **assign**
those Agents to Work-Orders on the Agent Board, attach them to Work-Order
Templates, or **open a sidepanel chat** bound to a specific Agent.

This document surveys how the leading agent frameworks model an "agent," how
they share tools/skills, and how they assign agents to work — then distils the
patterns that translate to Claudian's existing architecture. The companion
design spec is
[`2026-06-17-ai-agents-roster-design`](../superpowers/specs/2026-06-17-ai-agents-roster-design.md).

All framework facts below were gathered 2026-06-17 from official docs/source
(see `sources`). Versions are noted where the runtime exposed them.

---

## 1. The agent-definition schema is remarkably convergent

Across six frameworks the "agent" object collapses to the same small spine.
Every framework has a name/identity, a system prompt, a model, a tool list, and
a delegation mechanism. The differences are in framing, not in fields.

| Field (canonical) | Mastra | VoltAgent | CrewAI | OpenAI Agents SDK | Claude (`AgentDefinition` / `.claude/agents/*.md`) | LangGraph |
|---|---|---|---|---|---|---|
| **identity** | `id`/`name` | `name` (+ `id`) | `role` | `name` | `name` (file) / map key (SDK) | `name` |
| **routing blurb** | `description` | `purpose` | `goal` + `backstory` | (uses `name`/instructions) | `description` (drives auto-delegation) | (uses `name`) |
| **system prompt** | `instructions` (static or `(ctx)=>...`) | `instructions` (static or fn) | composed `role`/`goal`/`backstory` | `instructions` (static or fn) | `prompt` / markdown body | `prompt` |
| **model** | `model` (router string or fn) | `model` (static or fn) | `llm` | `model` | `model` (`opus`/`sonnet`/`haiku`/`fable`/id/`inherit`) | `model` |
| **tools** | `tools: Record` (key = tool name) | `tools: Tool[]` | `tools=[...]` | `tools=[...]` | `tools` (+ `disallowedTools`) | `tools=[...]` |
| **skills** | `skills` (Agent-Skills `SKILL.md`, on-demand) | — (Toolkits only) | — | — | `skills: [...]` (preload SKILL.md) | — |
| **delegation** | `agents: Record` → `agent-<key>` tools | `subAgents: Agent[]` (auto `delegate_task`) | `allow_delegation` + hierarchical `manager` | `handoffs=[...]` | `Agent` tool + `@mention` + `--agent` | `create_supervisor([...])` / handoff tools |
| **memory** | `memory: Memory` (resource/thread scope) | `memory: Memory \| false` | `memory` (usually crew-level) | context/session | `memory: user\|project\|local` | checkpointer/store |
| **structured I/O** | `structuredOutput` schema | per-subagent `schema` | `expected_output` (task) | `output_type` | — | `response_format` |
| **guardrails** | input/output processors | input/output guardrails | — | `guardrails` | `permissionMode`, `disallowedTools` | pre/post-model hooks |

**Takeaways for Claudian:**

- A roster "Agent" needs only: `id`, `name`, a short **routing description**
  (distinct from the full prompt — VoltAgent's `purpose` and Claude's
  `description` both exist precisely to let a coordinator/UI pick the right
  agent), `instructions`/`prompt`, `model`, a **tool allow/deny set**, and a
  **skills list**. Everything else is optional polish.
- Claude already matches this schema almost exactly (see §4), which makes
  Claude the natural reference shape for a provider-neutral roster entity.
- **Mastra (the framework the user named first) validates the shape and exposes
  the gap.** Its `AgentConfig` is the same flat spine — `id/name`,
  `description` (routing), `instructions`, `model`, `tools`, `agents`
  (sub-agents → `agent-<key>` tools), `memory`, `skills` — and almost every
  field accepts a dynamic `(ctx) => value` resolver. Crucially, **Mastra agents
  are code objects with no built-in deserializer**: it deliberately leaves
  *data-driven, user-authored agent definitions* to user-land. That gap — vault
  files deserialized into typed runtime objects — is exactly what Claudian
  already does for provider agents (`.claude/agents/*.md`,
  `.codex/agents/*.toml`) and is the roster's core value-add. Borrow Mastra's
  patterns (registry-by-key, flat typed config, dynamic resolution,
  skills-as-on-demand-context), **not** its dependency tree (heavy, AI-SDK-v5
  coupled, churn-prone).

---

## 2. Tools and skills: shared library, per-agent selection

Every framework treats tools as **plain reusable objects instantiated once and
referenced by many agents** — there is no per-agent binding. Sharing is just
"put the same tool in two agents' lists."

- **VoltAgent** — `createTool({ name, description, parameters: zod, execute })`.
  Grouping primitive is the **Toolkit** (`createToolkit`), publishable as an npm
  package for cross-team reuse; `addInstructions: true` injects shared guidance
  into the prompt. Tools support `needsApproval` (human-in-the-loop) and
  streaming generators. *No* separate runtime "skill" concept — VoltAgent
  "Skills" are docs-as-context packages, not runtime capabilities.
- **CrewAI** — tools subclass `BaseTool` (`name`, `description`,
  `args_schema: pydantic`, `_run`) or use `@tool`. The same instance is dropped
  into multiple agents' `tools=[...]`. Confirmed: tools are ordinary objects
  with no per-agent state.
- **OpenAI Agents SDK** — `@function_tool` (schema inferred from type hints +
  docstring) plus hosted tools (`WebSearchTool`, `FileSearchTool`,
  `CodeInterpreterTool`, `HostedMCPTool`) and **agents-as-tools** via
  `.as_tool()`.
- **Claude** — tools are a fixed canonical vocabulary; agents select via a
  space/comma `tools` allowlist and `disallowedTools` denylist (MCP patterns
  `mcp__server__*`). **Skills** are a *first-class, distinct* concept:
  `skills: [...]` preloads full SKILL.md content into the agent's context at
  startup. This is the one framework with a real tool **and** skill separation —
  and it is exactly Claudian's model.

**Takeaway:** the "library of skills and tools fed to an agent" the product
envisions is **Claude's exact model** (canonical tools + `$` skills), not an
invention. The roster UI is a *picker over the existing tool vocabulary and the
existing skill catalog*, persisted as allow/deny + skill-name lists on the agent
— it does not need a new tool-execution layer.

---

## 3. Assignment & delegation patterns (the "assign an agent to work" half)

This is where the product's "assign Agents to Work-Orders" intent maps directly
onto proven patterns.

**Devin (Cognition)** — the closest analogue to the Agent-Board model:

- A **session** is an ephemeral run booting from an org **machine snapshot**;
  the *persistent* configuration that "defines a Devin" lives outside the
  session: snapshot + secrets + **Knowledge** (general context) + **Playbooks**
  (step-by-step procedures for recurring tasks). This is the key insight: Devin
  separates the **durable agent config** from the **per-task run**.
- Assignment surfaces are plural and all reduce to *"prompt + which
  agent/playbook"*: Slack `@Devin` (with `!plan`/`!implement`/`!ask` mode
  keywords), web app (Ask→Agent mode, repo + agent selection, `@`-mentions of
  files/playbooks/skills/secrets), the **API** (`POST /v1/sessions` with
  `prompt`, `playbook_id`, `knowledge_ids`, `snapshot_id`, `tags`, `title`,
  `max_acu_limit`), the IDE extension, and **issue-tracker assignment**: in
  Linear/Jira you literally *assign the ticket to Devin* and a label
  (`!plan`/`!implement`/`!triage`/`!review`) selects the playbook — no label =
  default playbook.
- **MultiDevin / managed Devins**: 1 manager + up to 10 workers; the manager
  scopes work, assigns one task per worker, monitors, and merges. Good for
  "repeated, isolated tasks like lint, clean-ups, migrations, refactors."

**Supervisor / delegation across the rest:**

- **VoltAgent** — adding `subAgents: [...]` to any agent makes it a supervisor;
  the framework auto-injects a `delegate_task(task, targetAgents[], context)`
  tool and lists each sub-agent's `name`+`purpose` in the prompt. Routing is
  LLM-driven, by **agent name**. Every stream event carries `agentPath`,
  `parentAgentName`, etc. — which is what makes a *visual* delegation tree
  possible.
- **CrewAI** — `allow_delegation=True` auto-injects `Delegate work to coworker`
  and `Ask question to coworker`; or `Process.hierarchical` with a `manager_llm`
  / `manager_agent` that "assigns tasks strategically, considering each agent's
  capabilities and available tools." Tasks bind to agents declaratively in
  `tasks.yaml` via `agent: <agent-key>`.
- **OpenAI Agents SDK** — `handoffs=[...]` generates `transfer_to_<agent>` tools
  with optional `input_type`, `on_handoff`, `input_filter`, `is_enabled`.
- **LangGraph** — `create_supervisor([agents], model, prompt)` returns a graph;
  handoffs are `Command(goto=..., graph=Command.PARENT, update=...)`; the
  prebuilt lib auto-generates `transfer_to_<agent>` / `assign_to_<agent>` tools.

**Takeaways for Claudian:**

- "Assign Agent X to Work-Order Y" = **store the agent id on the work-order**,
  exactly like CrewAI's `agent:` field and Devin's ticket-assignment + label.
  Claudian's work-order frontmatter already has an `agent?` slot (today a
  lightweight persona id) — the roster makes that slot point at a real
  agent definition.
- **Work-Order Template + Agent = Devin's Playbook model.** A template that
  carries a default agent is the direct analogue of a Linear label → playbook.
- Delegation by **agent name/id** with a coordinator that sees each agent's
  `description` is the universal pattern; if/when Claudian wants multi-agent
  delegation, it should expose roster agents to the existing subagent/`Agent`
  tool by id rather than inventing a routing layer.

---

## 4. Claudian already has the substrate (codebase map)

The roster is mostly a **composition + management UI** over concepts that exist:

- **Subagents per provider** — `AgentDefinition` (Claude:
  `id, name, description, prompt, tools[], disallowedTools[], model, skills[],
  permissionMode, source, filePath, hooks`), `CodexSubagentDefinition` (TOML),
  Cursor (`.cursor/agents/*.md`), Opencode (`.opencode/agent/`). Claude's
  `AgentDefinition` is already a near-perfect roster shape. Discovery/storage:
  `AgentManager` (Claude), `CodexSubagentStorage` (Codex),
  `StorageBackedAgentMentionProvider<T>` (shared base). Surfaced via
  `AgentMentionProvider.searchAgents()` for `@`-mentions.
- **Agent Board / Work-Orders** — `TaskFrontmatter` already carries
  `agent?: string` (persona id, resolved via `resolvePersona()`), `provider?`,
  `model?`, `run_id`, `conversation_id`. `WorkOrderTemplate` carries
  `provider?`, `model?`, `priority?`, `body` with placeholders. Runs are
  coordinated by `TaskRunCoordinator` + `RunSession`, with sidecar
  heartbeat/ledger under `.claudian/runs/<runId>/`.
- **Skills** (`$`) — `ProviderCommandEntry { kind: 'command'|'skill', ... }`
  aggregated by `VaultSkillAggregator` per provider; Claude reads
  `.claude/skills/*/SKILL.md`, Codex `.codex/skills/`.
- **Tools** — canonical vocabulary in `src/core/tools/toolNames.ts`; each
  provider registration declares `canonicalToolNames: ReadonlySet<string>`;
  permissions flow through `ProviderRegistry.canUseTool()` / `ApprovalManager`.
- **Conversations** — `Conversation { id, providerId, providerState, ...,
  workOrderPath? }`. Created via `ConversationStore.createConversation({
  providerId? })`. **Today a conversation is provider-bound but agent-agnostic**
  — there is no "this chat uses agent X" binding, and `onAgentMentionSelect` is
  currently a stub. This is the main gap to fill for "new sidepanel chat with an
  Agent."
- **Settings registry** — tabs/sections/fields via `SettingsRegistry`;
  provider tabs mount through `registerProviderTab` and are visibility-gated by
  `isProviderEnabled`. A roster tab would register at the **app level** (not
  provider-gated).
- **Workspace registry** — `ProviderWorkspaceRegistry` owns `commandCatalog`,
  `agentMentionProvider`, `cliResolver`, `mcpServerManager`,
  `settingsTabRenderer` per provider.

### Seams where the roster attaches
1. A new **app-level `AgentRoster` service** + storage (`.claudian/agents/` or
   `.claudian/roster.json`).
2. A roster-aware **`AgentMentionProvider`** that merges roster agents with
   file-backed provider agents.
3. The **work-order agent picker** (writes `agent:` frontmatter) and the
   **template** default-agent field.
4. **`ConversationStore.createConversation`** gains an optional bound agent id;
   `InputController`/prompt encoding applies the agent at turn start.
5. A new **app-level "Agents" settings tab** for roster CRUD.

### Conflicts to resolve
- **Two "agent" meanings collide**: the lightweight work-order `AgentPersona`
  (id/name/color/initials) vs. a full chat `AgentDefinition`. Keep them
  distinct — a roster Agent *renders as* a persona on the board but *is* a
  capability definition.
- **ID namespace** — roster agents need a reserved prefix (e.g. `roster:<id>`)
  so they don't collide with file-backed agents (`plugin:agent-id` etc.).
- **Provider boundary** — roster sits at the app layer and is provider-neutral;
  file-backed provider subagents stay provider-scoped. A roster Agent
  *references/composes* them rather than replacing them (the user's chosen
  "new layer on top" direction).
- **Tool/skill availability is provider-specific** — a roster Agent's tool/skill
  selections must be validated/projected against the bound provider's actual
  capabilities at assignment time (Codex ≠ Claude vocabulary).

---

## 5. Design implications (carried into the spec)

1. **Adopt Claude's `AgentDefinition` as the canonical roster shape**, generalised
   to provider-neutral: `id, name, description, prompt, model, providerId?,
   tools[], disallowedTools[], skills[], permissionMode?, color/avatar`. This is
   the convergent schema from §1 and matches the codebase's strongest existing
   type.
2. **Separate durable agent config from per-task runs** (Devin's lesson). The
   roster is the durable layer; Work-Orders and conversations are runs that
   *reference* a roster agent id.
3. **Tools/skills are a picker over existing catalogs**, persisted as
   allow/deny + skill-name lists — no new execution machinery (§2).
4. **Assignment = store the agent id** on the work-order / template /
   conversation (§3, CrewAI `agent:` + Devin label→playbook).
5. **Routing description is a first-class field** distinct from the prompt
   (VoltAgent `purpose` / Claude `description`) — it powers both the picker UI
   and any future coordinator delegation.
6. **Defer multi-agent delegation**, but keep the door open: expose roster
   agents to the existing `Agent`/subagent tool by id, and ensure run events
   carry parent/child identity (VoltAgent `agentPath`) so a delegation tree can
   be visualised later.
7. **Roster lives at the app layer**, provider-neutral, projecting onto each
   provider's file-backed agent format when a chat/work-order actually runs
   (write-through to `.claude/agents/*.md` etc., or pass via SDK
   `AgentDefinition` at query time).

## Open questions for the spec
- Write-through vs. reference: does a roster Agent *materialise* a provider
  subagent file when bound, or stay app-level and inject at runtime via the SDK?
- Cross-provider agents: one roster entry usable by multiple providers (project
  tool/skill sets per provider) vs. one entry pinned to one `providerId`.
- How tightly to couple to the existing `AgentPersona` board avatar.

> Note on coverage: AutoGen was in scope but its deep-dive stream did not return
> verbatim-sourced material in this pass; its conversable-agent + group-chat
> orchestration follows the same supervisor/handoff family documented above and
> should be confirmed against `microsoft.github.io/autogen` before citing.
