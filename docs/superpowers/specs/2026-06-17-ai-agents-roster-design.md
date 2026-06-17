---
type: design
title: "Agent Roster: Provider-Neutral Agents Layered Over Provider Subagents"
date: 2026-06-17
status: draft
scope: agents
tags:
  - design
  - agents
  - multi-agent
related:
  - "[[docs/research/2026-06-17-ai-agents-roster-frameworks]]"
  - "[[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design]]"
  - "[[docs/superpowers/specs/2026-05-29-work-order-templates-design]]"
  - "[[docs/superpowers/specs/2026-06-07-co-worker-chat-design]]"
---

# Agent Roster: Provider-Neutral Agents Layered Over Provider Subagents

## Status & decisions

- **Direction (user-confirmed):** *new layer on top.* A Claudian **Agent** is a
  higher-level, provider-neutral roster entity that **references/composes**
  existing provider subagents, skills, and tools — it does not replace them.
- **This document is a design spec**, not an implementation plan. It defines the
  data model, storage, UI surfaces, runtime binding, and a phased rollout. The
  research that grounds it is in
  [`2026-06-17-ai-agents-roster-frameworks`](../../research/2026-06-17-ai-agents-roster-frameworks.md).

## Problem

Users want to author and maintain a **roster of named Agents**, each composed
from a **library of skills and tools**, then:

1. **Assign** an Agent to a Work-Order on the Agent Board.
2. **Attach** a default Agent to a Work-Order **Template**.
3. **Open a sidepanel chat** bound to a specific Agent.

Today Claudian has the substrate but no unifying entity: provider subagents are
file-backed and provider-scoped (`.claude/agents/*.md`, `.codex/agents/*.toml`,
`.cursor/agents/*.md`, `.opencode/agent/`); work-orders carry a lightweight
`AgentPersona` (id/name/color); conversations are provider-bound but
agent-agnostic; tools and `$` skills already have catalogs. The roster is mostly
a **composition + management layer** over these, plus three thin binding points.

## Guiding principles (from the research)

1. **Adopt the convergent agent schema.** Every surveyed framework (Mastra,
   VoltAgent, CrewAI, OpenAI Agents SDK, Claude, LangGraph) collapses an agent
   to: identity, a short **routing description** distinct from the prompt, a
   system prompt, a model, a **tool allow/deny set**, and a delegation hook.
   Claude's `AgentDefinition` already matches this almost exactly.
2. **Own the data-driven definition layer.** Mastra deliberately leaves
   user-authored, serialised agent definitions to user-land. That gap is the
   roster's core value-add, and Claudian already deserialises vault files into
   typed agent objects.
3. **Separate durable config from per-task runs** (Devin's Knowledge/Playbooks
   vs. session split). The roster is durable; work-orders and conversations are
   runs that *reference an Agent id*.
4. **Tools/skills are a picker over existing catalogs** — persisted as
   allow/deny + skill-name lists. No new tool-execution machinery.
5. **Assignment = store the Agent id** on the work-order / template /
   conversation (CrewAI `agent:`; Devin ticket-assignment + label→playbook).
6. **Defer multi-agent delegation**, but keep run events carrying parent/child
   identity so a delegation tree can be visualised later (VoltAgent `agentPath`).

## Data model

A roster Agent is a provider-neutral capability definition. It is **not** a
work-order persona — it *renders as* one on the board.

```typescript
// src/features/agents/roster/rosterTypes.ts (new)
export interface RosterAgent {
  id: string;                       // stable; persisted as `roster:<slug-or-uuid>`
  name: string;
  description: string;              // routing blurb — drives picker UI + future delegation
  prompt: string;                   // system prompt / instructions

  // Capability library (provider-neutral selections; projected per provider at bind time)
  tools?: string[];                 // canonical tool allowlist (omit = inherit provider default)
  disallowedTools?: string[];       // canonical denylist (MCP patterns allowed)
  skills?: string[];                // skill names from the existing `$` skill catalog

  // Provider binding
  defaultProviderId?: ProviderId;   // preferred provider; null = pick at use time
  model?: string;                   // model id/alias; validated against the bound provider
  permissionMode?: string;          // maps to provider permission modes where supported

  // Composition (the "new layer on top" hook — references, not copies)
  composedAgentRefs?: ProviderAgentRef[]; // existing file-backed subagents this Agent reuses

  // Board presentation (persona projection)
  color?: string;
  initials?: string;
  icon?: string;

  // Provenance
  source: 'roster';
  createdAt: number;
  updatedAt: number;
}

export interface ProviderAgentRef {
  providerId: ProviderId;
  agentId: string;                  // id within that provider's file-backed agent set
}
```

Notes:
- **ID namespace.** Roster ids are prefixed `roster:` so they never collide with
  file-backed agents (`plugin:agent-id`, vault, global) in the merged mention
  provider.
- **Capabilities are stored provider-neutrally** and **projected** onto the bound
  provider's real vocabulary at run time (Codex tool names ≠ Claude's). Selections
  invalid for the bound provider are surfaced as warnings in the editor, not
  silently dropped.
- **Composition is by reference.** `composedAgentRefs` points at existing
  provider subagents; the roster never duplicates their file content. This is the
  literal "layer on top."

## Storage

App-level, provider-neutral, vault-committed:

| Path | Contents |
|------|----------|
| `.claudian/agents/<id>.json` | One `RosterAgent` per file (diff-friendly, mergeable, matches the per-file convention of provider agents) |

Rationale: a single `roster.json` blob races multi-device sync and muddies
diffs; per-file mirrors `.claude/agents/*.md`. JSON (not markdown frontmatter)
because a roster Agent is structured config, not a prose document, and the
`prompt` can hold markdown as a string field.

> Open question carried from research: whether binding an Agent should
> **write-through** a provider subagent file (e.g. materialise `.claude/agents/
> roster-<id>.md`) or stay app-level and inject via the SDK `AgentDefinition` at
> query time. Recommendation below (Runtime binding) is **inject-at-runtime** to
> avoid file churn and keep the roster the single source of truth.

## Services & seams

```
src/features/agents/roster/
  rosterTypes.ts
  AgentRosterStore.ts        // CRUD over .claudian/agents/*.json; EventBus on change
  RosterAgentMentionProvider.ts  // merges roster + file-backed agents for @-mentions
  rosterProjection.ts        // RosterAgent + ProviderId -> provider-native agent config
```

1. **`AgentRosterStore`** — load/save/list/delete; emits `roster:changed` on the
   shared EventBus; cached like `VaultSkillAggregator`.
2. **`RosterAgentMentionProvider`** — wraps the existing per-provider
   `StorageBackedAgentMentionProvider` results and merges roster agents, so `@`
   in chat surfaces both. Resolves the current no-op `onAgentMentionSelect` stub
   into a real **bind** action (see chat binding).
3. **`rosterProjection`** — pure function turning a `RosterAgent` + target
   `ProviderId` into that provider's native agent config (Claude
   `AgentDefinition`, Codex `CodexSubagentDefinition`, etc.), validating
   tool/skill/model selections against the provider's `canonicalToolNames` and
   skill catalog.

## UI surfaces

### A. Roster management (new app-level Settings tab "Agents")

Registered at the **app level** (not provider-gated by `isProviderEnabled`), via
the settings registry. Provides:
- A list/cards view of roster Agents (`getAgents()`-style enumeration).
- An editor: name, description, prompt, model, **tool picker** (over canonical
  tool vocabulary), **skill picker** (over the `$` skill catalog), default
  provider, permission mode, board color/initials/icon, and a **composed
  subagents** multi-select drawing from the merged file-backed agent set.
- Provider-capability validation inline (warn when a selected tool/skill/model
  is unavailable for the chosen `defaultProviderId`).

### B. Work-Order assignment

- Extend the work-order creation/edit UI with a **roster Agent picker**.
- Selecting an Agent writes `agent: roster:<id>` into `TaskFrontmatter.agent`
  (the slot already exists), and may pre-fill `provider`/`model` from the Agent.
- `resolvePersona()` is extended so a `roster:` id resolves to the Agent's
  board presentation (color/initials/icon) — the board renders the Agent as its
  card avatar without changing the lightweight persona concept.
- At run time, `TaskRunCoordinator`/`RunSession` reads the Agent id and applies
  the projected provider config when launching the turn.

### C. Work-Order Template default agent

- Add `defaultAgentId?: string` to `WorkOrderTemplate`.
- Templates carrying a default Agent are Claudian's analogue of Devin's
  Linear/Jira label→playbook: instantiating the template seeds the work-order's
  `agent:` frontmatter. User can still override per work-order.

### D. New sidepanel chat bound to an Agent

- `ConversationStore.createConversation` gains an optional `agentId?: string`.
- Persist on `Conversation` as `boundAgentId?: string` (new field alongside
  `workOrderPath?`).
- "New chat with Agent…" entry point (command palette + roster card action +
  the resolved `@`-mention bind action).
- `InputController` / prompt encoding applies the projected agent config at turn
  start (system prompt, tool allow/deny, skills, model) for the bound provider.

## Runtime binding (inject, don't materialise)

When a work-order run or bound chat turn starts:
1. Resolve `RosterAgent` by id from `AgentRosterStore`.
2. Determine the provider (`defaultProviderId` → conversation/work-order provider
   → default).
3. `rosterProjection(agent, providerId)` → native agent config.
4. Pass it to the provider runtime as the turn's agent definition (Claude SDK
   accepts `AgentDefinition` at query time; Codex/others via their existing
   subagent paths). Composed subagent refs are passed through as that provider's
   delegatable agents.

This keeps the roster the single source of truth, avoids generating/cleaning up
shadow `.claude/agents/*.md` files, and sidesteps drift between roster and
provider files.

## Conflicts & how they're resolved

| Conflict | Resolution |
|---|---|
| Two "agent" meanings (`AgentPersona` vs `AgentDefinition`) | Keep persona lightweight; a roster Agent *projects onto* a persona for board display via `resolvePersona()`. |
| ID collisions with file-backed agents | Reserve `roster:` prefix in the merged mention provider. |
| Provider boundary | Roster is app-level/provider-neutral; provider subagents stay provider-scoped and are referenced, not absorbed. |
| Tool/skill vocabulary differs per provider | `rosterProjection` validates+projects; editor warns on unavailable selections. |
| Mention callback ambiguity (chat vs assignment) | `onAgentMentionSelect` resolves to context-aware bind: in chat → bind conversation; in work-order field → set `agent:`. |
| Settings tab visibility | Roster "Agents" tab registers app-level, always visible. |

## Phasing

- **Phase 1 — Roster core.** `RosterAgent` type, `AgentRosterStore`,
  `.claudian/agents/*.json`, the app-level "Agents" settings tab with the editor
  (name/description/prompt/model/tool picker/skill picker). No bindings yet.
  Ship value: authored, reusable agent definitions.
- **Phase 2 — Chat binding.** `boundAgentId` on `Conversation`,
  `createConversation({ agentId })`, runtime projection + injection,
  `RosterAgentMentionProvider`, resolved bind action. Ship value: "new chat with
  an Agent."
- **Phase 3 — Work-Order + Template assignment.** Picker writes `agent: roster:`,
  `resolvePersona()` extension, template `defaultAgentId`, coordinator applies
  projected config. Ship value: assign Agents to board work.
- **Phase 4 (deferred) — Composition & delegation.** `composedAgentRefs` wired
  into provider delegation; run events carry parent/child identity for a future
  delegation-tree visualisation (VoltAgent `agentPath` pattern).

## Out of scope (this spec)

- A bespoke multi-agent orchestration/supervisor engine (rely on each provider's
  native delegation; revisit in Phase 4).
- Hosted observability console (VoltOps-style); local trace visualisation is a
  later, separate design.
- Per-agent isolated VM/snapshot environments (Devin-style); Claudian runs in
  the vault's working context.

## Decisions still needing the user

1. **Cross-provider Agents:** one roster entry reusable across providers (project
   tool/skill sets per provider) vs. each entry pinned to one `defaultProviderId`.
   *Recommendation: allow neutral entries, pin a default, validate per provider.*
2. **Write-through vs inject:** confirm inject-at-runtime (recommended) over
   materialising provider subagent files.
3. **Composition depth:** whether Phase 1 ships `composedAgentRefs` as display-only
   metadata or wires it immediately (recommend display-only until Phase 4).
