---
type: design
title: "Roster → Run Binding: Chat Conversations Bound to a Roster Agent"
date: 2026-06-19
status: draft
scope: agents
related:
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/superpowers/plans/2026-06-19-agent-roster-tools-skills]]"
  - "[[docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups]]"
---

# Roster → Run Binding: Chat Conversations Bound to a Roster Agent

## Goal

Turn a stored `RosterAgent` into something usable: a "Start chat with this Agent"
action opens a chat **bound** to the agent, and the agent's **system prompt** and
**model** are applied to every Claude turn in that conversation.

## Scope (MVP)

- **Provider:** Claude (the tool tier is Claude-only today).
- **Projected:** the agent's `prompt` (appended to the system prompt) and
  `modelSelection.modelId` (model override, only when the agent set one).
- **Deferred (follow-ups):** tool/skill *enforcement* (Claude's persistent query
  has no `allowedTools` SDK field — requires the `canUseTool` path), work-order →
  roster assignment, and non-Claude providers. The agent's granted user tools are
  available regardless via the in-process MCP server.

## Data model

```typescript
// src/core/types/chat.ts — Conversation gains:
boundAgentId?: string;   // e.g. 'roster:researcher'
```
Persisted/hydrated transparently through `SessionStorage` (flexible metadata).
`createConversation(options?: { providerId?; sessionId?; boundAgentId? })` carries
it at creation (single write).

## Flow

1. **Roster detail view** — a "Start chat with this Agent" button calls
   `plugin.createConversation({ providerId: 'claude', boundAgentId: agent.id })`
   then `plugin.openConversation(id)`.
2. **Per turn (InputController)** — before `runtime.query(...)`, resolve the
   conversation's `boundAgentId` via `AgentRosterStore.get(id)`; if found, pass on
   `ChatRuntimeQueryOptions`:
   - `boundAgentPrompt = agent.prompt`
   - `boundAgentModel = agent.modelSelection?.modelId`
   (Model precedence: explicit tab/work-order override → bound-agent model →
   global default.)
3. **ClaudeChatRuntime / ClaudeQueryOptionsBuilder** — thread `boundAgentPrompt`/
   `boundAgentModel` into BOTH the cold-start and persistent contexts:
   - **Model:** use `boundAgentModel` ahead of `settings.model` (but behind an
     explicit per-turn `modelOverride`).
   - **System prompt:** pass `boundAgentPrompt` as a `buildSystemPrompt(...,
     { appendices })` entry.
   - **Restart correctness:** include `boundAgentPrompt` in
     `computeSystemPromptKey` so switching/clearing the bound agent restarts the
     persistent query (the SDK system prompt is built once per query).

## Contracts touched

- `ChatRuntimeQueryOptions` (`src/core/runtime/types.ts`): add
  `boundAgentPrompt?: string`, `boundAgentModel?: string`.
- `PersistentQueryContext` / `ColdStartQueryContext` / `QueryOptionsContext` as
  needed to reach `buildBaseOptions`.

## Gotchas (from codebase exploration)

- System prompt is keyed for restart — the bound prompt MUST be in the key.
- Persistent query has no `allowedTools`; only `disallowedTools` + `canUseTool`.
  That's why tool enforcement is deferred.
- Model override priority must not clobber an explicit work-order/tab override.

## Out of scope
Tool/skill enforcement, work-order assignment, multi-provider projection,
mid-conversation rebind UI.
