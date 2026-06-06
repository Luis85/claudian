---
title: Remove the Orchestrator feature
date: 2026-06-06
status: approved (design)
scope: features/chat, providers, settings, i18n, docs/product
parent: "[[Agent Kanban Board]]"
relations:
  - "[[docs/ideas/Remove the Orchestrator feature]]"
  - "[[docs/product/features/Orchestrator]]"
  - "[[docs/product/features/Agent Kanban Board]]"
---

# Remove the Orchestrator feature

## Problem

Orchestrator was designed as a chat-panel feature that splits a goal into parallel worker tabs and synthesizes their results. Since Agent Board has matured into the durable work-handoff interface, Orchestrator is now a duplicate orchestration surface with weaker traceability: it lives in chat tabs, has its own prompt mode, owns separate settings, and does not use the Agent Board ledger, handoff, review, and work-order model.

The product direction is now clear: **Agent Board is the orchestration interface**. Keeping Orchestrator creates redundant UI, provider prompt paths, settings, documentation, tests, and future maintenance work.

## Goal

Hard-remove Orchestrator from Claudian so users no longer see, configure, trigger, or depend on it. After the change:

- Chat has no Orchestrator toolbar toggle, goal modal, worker-tab affordance, or inline Orchestrator plan action surface.
- Providers no longer receive Orchestrator-specific prompt options or append Orchestrator instructions.
- Settings have no Orchestrator trace in the active model, defaults, UI, registry, search, or i18n strings.
- Agent Board remains the only documented path for durable orchestration and delegated work.
- Old serialized Orchestrator fields are tolerated as inert legacy data, not migrated or used.

## Non-goals

- Do not add replacement Agent Board functionality in this removal slice.
- Do not migrate, rewrite, or delete users' historical conversation files solely to remove stale Orchestrator fields.
- Do not show a deprecation banner or compatibility UI. This is a removal, not a staged deprecation.
- Do not keep hidden Orchestrator internals for rollback.
- Do not change provider-native plan mode, instruction mode, subagents, inline edit, or normal Agent Board runs except where they currently depend on Orchestrator-specific code.

## Chosen approach

Use a **vertical hard removal with compatibility tolerance**.

This removes every active Orchestrator entry point and code path while allowing older JSON blobs to contain now-unknown keys. The implementation should avoid an explicit destructive migration. If existing settings/conversation loading naturally drops unknown keys when saving a normalized object, that is acceptable; if old files still physically contain removed keys until the user or a future cleanup rewrites them, Claudian must ignore them.

Rejected alternatives:

1. **Aggressive purge** — actively strip old Orchestrator keys from all persisted settings and conversations. This would create unnecessary migration and rollback risk.
2. **Soft deprecation** — hide Orchestrator but keep internals. This would leave maintenance burden and contradict the product decision.
3. **Removal plus new Agent Board affordance** — add a new chat/settings prompt pointing users to Agent Board. This may be useful later, but it expands the scope beyond removal.

## User-facing behavior

### Removed surfaces

- The chat input/toolbar no longer exposes an Orchestrator toggle.
- Starting a chat cannot enable Orchestrator mode.
- The Orchestrator goal modal is removed.
- Orchestrator plan JSON is not detected or rendered as a special inline action card.
- Parent/worker Orchestrator tab styling and labels are removed.
- The settings UI has no Orchestrator tab, fields, search hits, headings, labels, or descriptions.
- Product docs and user manuals no longer present Orchestrator as an active feature.

### Remaining behavior

- Normal chat continues to work through the existing provider-neutral `ChatRuntime` boundary.
- Provider plan mode and provider-owned plan approval flows remain intact when they are not Orchestrator-specific.
- Agent Board work-order execution continues to open/run chat tabs through `features/tasks` and `TaskExecutionSurface`.
- Chat tab limits apply normally; there is no Orchestrator worker-tab exception.

## Architecture

### 1. Chat UI layer

Remove Orchestrator-specific UI components and wiring from `features/chat`:

- Delete `OrchestratorGoalModal` and its styles.
- Delete inline Orchestrator plan rendering (`InlineOrchestratorPlan`) and the parser/action wiring used only by that renderer.
- Remove Orchestrator toggle construction from tab factories, toolbar wiring, and shared tab sync helpers.
- Remove Orchestrator parent/worker visual state from tab rendering and tab CSS.
- Remove Orchestrator callbacks from `ClaudianView`, `StreamController`, and tab UI types.

Normal message rendering, tool rendering, plan approval cards, subagent rendering, and Agent Board-linked chat tabs should remain separate and working.

### 2. Chat state and controller layer

Remove Orchestrator mode from active chat state and request flow:

- Remove `pendingOrchestratorMode` from chat state.
- Remove active use of `conversation.orchestratorMode` from controllers and renderers.
- Remove `orchestratorMode` from active `ChatTurnRequest` creation and runtime preparation.
- Remove `OrchestratorService` and worker dispatch/synthesis flow.
- Remove helper text/reporting utilities that only exist to feed Orchestrator workers or synthesis.

If an old conversation object still has `orchestratorMode: true`, loading it should produce an ordinary conversation with no special prompt behavior, tab styling, worker spawning, or synthesis.

### 3. Provider and prompt layer

Remove Orchestrator prompt injection from all providers:

- Delete the shared Orchestrator prompt module and default Orchestrator prompt text.
- Remove `orchestratorMode` from provider query/build option types.
- Remove `currentOrchestratorMode` tracking from Claude, Codex, and Opencode runtimes.
- Remove Cursor-specific Orchestrator prompt appending.
- Remove Opencode launch artifacts or prompt options that only support Orchestrator.

Provider runtimes should only receive supported non-Orchestrator modes and options. Provider-native plan mode must remain distinct from Orchestrator and continue through its existing supported path.

### 4. Settings layer

Settings must have no active Orchestrator trace:

- Remove `orchestratorEnabled` and `orchestratorSystemPrompt` from active settings types and defaults.
- Remove `OrchestratorSettingsTab` and the Orchestrator settings registry fields.
- Remove Orchestrator from feature-flag registry/search ordering where it exists only to render settings.
- Remove Orchestrator settings search results.
- Remove Orchestrator settings labels/descriptions from all locales and i18n types.
- Ensure settings rendering and search cannot produce an Orchestrator tab, field, or match.

Legacy user settings JSON may still contain stale Orchestrator keys. They are not meaningful configuration. Code must not read them to enable behavior or render UI.

### 5. Docs and product metadata

Update user-facing documentation to match the product direction:

- Remove or retire `docs/product/features/Orchestrator.md` as an active feature page.
- Remove or retire `docs/product/user-manuals/orchestrator.md` as an active manual.
- Update Agent Board feature/manual docs so they no longer recommend or link to Orchestrator.
- Update open Orchestrator integration idea/issue records as obsolete or superseded when they are part of the implementation branch.
- Keep this design spec as the canonical rationale for why Orchestrator was removed.

Historical idea/issue notes can remain if they are clearly archival and not presented as active product surface.

## Data and compatibility

### Settings

Active settings schemas, defaults, UI renderers, search indexes, and i18n types should not include Orchestrator fields. Old serialized settings files with stale keys must not crash load and must not activate hidden behavior.

The removal does not require a one-time migration. If the existing save path writes a sanitized settings object that omits unknown keys, stale Orchestrator keys may disappear on the next save. If not, they remain harmless on disk.

### Conversations

Existing conversation metadata may contain `orchestratorMode: true`. After removal, this field is ignored. Conversation history should still load as ordinary chat history where otherwise valid.

No worker hierarchy, parent-tab state, synthesis step, or Orchestrator-specific continuation should be reconstructed from old conversations.

### Tests and fixtures

Fixtures that include Orchestrator only to test Orchestrator behavior should be deleted. Fixtures that include old data for compatibility should be renamed or rewritten to make their legacy-data purpose explicit.

## Error handling and edge cases

| Case | Expected behavior |
|------|-------------------|
| Old settings JSON contains `orchestratorEnabled` | Load succeeds; key is ignored; no UI or behavior appears. |
| Old settings JSON contains `orchestratorSystemPrompt` | Load succeeds; prompt is ignored; no settings field appears. |
| Old conversation contains `orchestratorMode: true` | Conversation loads as ordinary chat; no worker/synthesis behavior. |
| Old Orchestrator plan JSON appears in an assistant message | It renders as ordinary assistant text/JSON, not as an action card. |
| Provider code receives no Orchestrator option | Runtime uses normal prompt construction. |
| Agent Board run opens a chat tab | Run flow continues through `TaskExecutionSurface`; no Orchestrator dependency. |
| Search settings for "orchestrator" | No active settings result appears. |

## Testing strategy

### Remove obsolete tests

Delete tests whose only purpose is validating Orchestrator functionality, including prompt text, plan parsing/rendering, settings field registration, and Orchestrator service behavior.

### Add or update regression tests

- **Settings defaults/types**: defaults do not include Orchestrator keys.
- **Settings registry/search**: Orchestrator tab/fields are not registered and cannot appear in search results.
- **i18n hygiene**: user-facing Orchestrator settings strings are removed from locale typings and locale files.
- **Chat UI/state**: no Orchestrator toggle, pending mode, parent/worker tab state, or inline Orchestrator plan card remains.
- **Provider prompt path**: provider turn preparation no longer receives or appends Orchestrator instructions.
- **Legacy tolerance**: loading old settings or conversation objects with stale Orchestrator keys does not crash and does not activate special behavior.
- **Agent Board isolation**: Agent Board execution remains independent of removed Orchestrator modules.

### Verification commands for implementation

The eventual implementation branch should run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Because this design-spec branch changes documentation only, spec verification is limited to self-review, git diff inspection, and commit creation.

## Acceptance criteria

- No Orchestrator entry point remains in chat UI.
- No active Orchestrator state or request field remains in chat/runtime types.
- No provider appends or tracks Orchestrator prompt instructions.
- No Orchestrator settings tab, field, default, active type, registry entry, search result, or i18n settings string remains.
- Old serialized Orchestrator settings/conversation fields are tolerated as inert unknown data.
- Agent Board docs no longer point users to Orchestrator as a companion feature.
- Orchestrator product/manual docs are removed or explicitly retired from active product docs.
- Relevant obsolete Orchestrator tests are deleted or replaced with removal/legacy-tolerance assertions.
- `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` pass on the implementation branch.

## Follow-up candidates

These are intentionally outside this removal spec:

- Add Agent Board affordances for decomposing a large goal into multiple work orders.
- Add a combined-review surface across a related set of Agent Board work orders.
- Add explicit archival cleanup for stale Orchestrator keys if future settings normalization work needs it.

