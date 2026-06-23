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
  - "[[docs/superpowers/specs/2026-06-19-work-order-loop-controls-design]]"
  - "[[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design]]"
  - "[[docs/superpowers/specs/2026-05-29-work-order-templates-design]]"
  - "[[docs/superpowers/specs/2026-06-07-co-worker-chat-design]]"
---

# Agent Roster: Provider-Neutral Agents Layered Over Provider Subagents

## Status & decisions

- **Direction (user-confirmed):** *new layer on top.* A Claudian **Agent** is a
  higher-level, provider-neutral roster entity that **references/composes**
  existing provider subagents, skills, and tools — it does not replace them.
- **Provider-agnostic, user-friendly (user-confirmed):** the end user is never
  asked to understand AI-provider intricacies. Providers are an implementation
  detail the plugin resolves; Agents are perceived as a native plugin concept.
  - **Provider resolution:** *global default + hidden override.* A single
    plugin-wide default provider is set once in global settings. A per-agent
    provider override exists but is **advanced/hidden**, not part of the normal
    authoring flow.
  - **Model:** an Agent inherits the **global default model** by default. The
    user may **opt in** to choose a specific model, presented as a friendly,
    merged list of **models from the currently active providers** (no "provider"
    framing forced on them). Kept deliberately careful so the roster stays
    flexible as providers are enabled/disabled.
- **Dedicated UI (user-confirmed):** the roster does **not** live in a settings
  tab. It is its own **workspace view** — an **Agent Roster list/dashboard** plus
  an **Agent detail view** where the user composes an agent and grants it
  **skills and tools from a repository (library)**.
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

  // Provider binding — hidden from the normal authoring flow (advanced only)
  providerOverride?: ProviderId;    // advanced; absent = use the global default provider
  // Model — opt-in. Absent = inherit the global default model. When set, it is a
  // concrete model chosen from the currently-active providers' model lists.
  modelSelection?: {
    modelId: string;                // friendly id surfaced in the merged active-provider list
    providerId: ProviderId;         // recorded so resolution is unambiguous; not shown by default
  };
  permissionMode?: string;          // maps to provider permission modes where supported

  // Loop participation (see work-order loop-controls spec)
  roles?: Array<'worker' | 'verifier'>;   // default ['worker']; 'verifier' = selectable as a completion-oracle judge
  defaultBudgets?: { maxTurns?: number; maxCostUsd?: number; maxRuntimeSec?: number }; // inherited by work-orders unless overridden

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
- **Capabilities are stored provider-neutrally** and **projected** onto the
  resolved provider's real vocabulary at run time (Codex tool names ≠ Claude's).
  Selections invalid for the resolved provider are surfaced as gentle warnings in
  the detail view, not silently dropped — but the user is never asked to reason
  about *which* provider; the warning is phrased in capability terms.
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
  AgentRosterStore.ts            // CRUD over .claudian/agents/*.json; EventBus on change
  RosterAgentMentionProvider.ts  // merges roster + file-backed agents for @-mentions
  rosterResolution.ts            // RosterAgent -> resolved { providerId, modelId } (hidden from user)
  rosterProjection.ts            // RosterAgent + resolved provider/model -> provider-native config
  view/
    AgentRosterView.ts           // ItemView (workspace leaf); ribbon + command registration
    RosterDashboard.ts           // A1: list/cards + dashboard actions
    AgentDetailView.ts           // A2: compose/maintain; skills+tools library pickers
    capabilityLibrary.ts         // friendly tool/skill catalog projection for the pickers
```

1. **`AgentRosterStore`** — load/save/list/delete; emits `roster:changed` on the
   shared EventBus; cached like `VaultSkillAggregator`.
2. **`RosterAgentMentionProvider`** — wraps the existing per-provider
   `StorageBackedAgentMentionProvider` results and merges roster agents, so `@`
   in chat surfaces both. Resolves the current no-op `onAgentMentionSelect` stub
   into a real **bind** action (see chat binding).
3. **`rosterResolution`** — pure function implementing the hidden provider/model
   resolution order (override → surface → global default; opt-in model wins its
   provider). Keeps the provider-agnostic promise in one testable place.
4. **`rosterProjection`** — pure function turning a `RosterAgent` + the resolved
   provider/model into that provider's native agent config (Claude
   `AgentDefinition`, Codex `CodexSubagentDefinition`, etc.), validating
   tool/skill selections against the provider's `canonicalToolNames` and skill
   catalog.
5. **`capabilityLibrary`** — backs the detail-view pickers: exposes the `$` skill
   catalog and the canonical tool vocabulary as a provider-neutral, friendly
   library (capability-phrased tool toggles + MCP tools when configured).

## UI surfaces

### A. The Agent Roster view (dedicated workspace view — primary surface)

A first-class Obsidian **`ItemView`** (its own workspace leaf), opened from a
**ribbon icon** and a **command** ("Open Agent Roster"), the same way the chat
sidebar and Agent Board are surfaced. This is *not* a settings tab — Agents are a
native plugin destination, not buried configuration. Two screens within the view:

**A1. Roster list & dashboard.**
- Card/grid of all roster Agents (avatar = color/initials/icon, name, routing
  `description`, a capability summary chip: "3 skills · 5 tools").
- Dashboard affordances: search/filter, "New Agent", duplicate, delete, and
  light usage signals where cheap (e.g. recent work-orders / chats that used the
  agent — reuses existing run/conversation metadata; no new tracking).
- Primary actions per card map straight to the bindings: **Start chat with
  this Agent**, **Assign to a Work-Order**, **Edit**.

**A2. Agent detail view (compose & maintain an agent).**
The authoring surface. Plain-language fields only; no provider jargon:
- **Identity & behaviour:** name, avatar (color/initials/icon), a short
  "what it's for" (`description`, the routing blurb), and the instructions
  (`prompt`).
- **Skills & Tools from a repository (library):** two pickers backed by the
  existing catalogs —
  - **Skills repository** = the existing `$` skill catalog
    (`VaultSkillAggregator` over `.claude/skills`, `.codex/skills`, …),
    presented as a searchable library the user grants to the agent
    (`skills: string[]`).
  - **Tools repository** = the canonical tool vocabulary
    (`src/core/tools/toolNames.ts`), presented as friendly capability toggles
    (e.g. "Read files", "Edit files", "Run commands", "Search the web") that map
    to the allow/deny lists (`tools` / `disallowedTools`). MCP-provided tools
    appear here too once their server is configured.
  - Both pickers read from a shared, **provider-neutral** library; what an agent
    is granted is stored neutrally and validated per resolved provider at run
    time.
- **Brain (model) — collapsed by default.** Shows "Uses the default model" with
  an **opt-in** "Choose a specific model" control that reveals a friendly,
  merged list of models from the **currently active providers** (writes
  `modelSelection`). No provider picker in the normal flow.
- **Advanced (hidden/expandable):** `permissionMode`, the per-agent
  `providerOverride`, and **composed agents** (`composedAgentRefs`) — a
  multi-select over the merged file-backed subagent set, for the "layer on top"
  composition.

Global settings (the existing settings shell) keeps only the **plugin-wide
default provider/model** the roster inherits from — set once, away from the
day-to-day Agent authoring flow.

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
2. **Resolve the provider (user never prompted):**
   `agent.providerOverride` (advanced) → the surface's existing provider if any
   (e.g. a work-order's `provider`) → **the plugin-wide default provider**.
3. **Resolve the model:** `agent.modelSelection` (opt-in) → otherwise the
   **plugin-wide default model**. If the opt-in model belongs to a provider other
   than the resolved one, the model's recorded `providerId` wins the provider
   resolution (so an explicit model choice stays coherent).
4. `rosterProjection(agent, resolvedProvider, resolvedModel)` → native agent
   config.
5. Pass it to the provider runtime as the turn's agent definition (Claude SDK
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
| Tool/skill vocabulary differs per provider | `rosterProjection` validates+projects; the detail view shows capability-phrased warnings (never provider jargon). |
| Mention callback ambiguity (chat vs assignment) | `onAgentMentionSelect` resolves to context-aware bind: in chat → bind conversation; in work-order field → set `agent:`. |
| Exposing provider/model to a provider-agnostic user | Provider is hidden (global default + advanced override); model defaults to the global default with an opt-in friendly model list from active providers. |
| Where the roster lives | A dedicated workspace `ItemView` (ribbon + command), not a settings tab; global settings holds only the default provider/model. |

## Phasing

- **Phase 1 — Roster core + dedicated view.** `RosterAgent` type,
  `AgentRosterStore`, `.claudian/agents/*.json`, and the **Agent Roster
  `ItemView`** (ribbon + command): list/dashboard (A1) and the detail view (A2)
  with the skills/tools library pickers and the opt-in model control. Provider is
  resolved to the global default; no work-order/chat bindings yet. Ship value: a
  native place to author and maintain reusable, provider-agnostic agents.
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

## Resolved decisions

- **Cross-provider Agents:** Agents are provider-neutral; provider is hidden
  (global default + advanced override), so a single roster entry works regardless
  of which provider is active. *(Confirmed.)*
- **Model UX:** inherit the global default; opt-in to a concrete model from the
  active providers' merged list. *(Confirmed.)*
- **Roster home:** a dedicated workspace view, not a settings tab. *(Confirmed.)*

## Decisions still needing the user

1. **Write-through vs inject:** confirm inject-at-runtime (recommended) over
   materialising provider subagent files.
2. **Composition depth:** whether Phase 1 ships `composedAgentRefs` as display-only
   metadata or wires it immediately (recommend display-only until Phase 4).
3. **Tool capability grouping:** confirm the friendly tool toggles (e.g. "Read
   files", "Run commands") and how granular they should be vs. exposing raw
   canonical tool names in an advanced sub-list.
