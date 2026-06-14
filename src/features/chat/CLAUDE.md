# Chat Feature

Main sidebar chat interface. `ClaudianView` assembles tabs, controllers, renderers, and provider-backed services around the shared `ChatRuntime` boundary.

## Provider Boundary Status

- Chat features depend on `ChatRuntime`, `ProviderCapabilities`, and provider-neutral conversation data. `InputController` builds `ChatTurnRequest`; runtimes own prompt encoding through `prepareTurn()`.
- Session bookkeeping lives in `Conversation.providerState` and is usually updated through `ChatRuntime.buildSessionUpdates()`, with fork/bootstrap state also seeded through provider history services. Feature code must not read provider-specific fields directly.
- Provider-owned services are resolved through registries
  - `ProviderRegistry`: runtime, title generation, instruction refinement, inline edit, task-result interpretation
  - `ProviderWorkspaceRegistry`: command catalogs, agent mention providers, MCP managers, CLI resolution
- Current feature split (capability flags in `src/providers/<id>/capabilities.ts`; illustrative, not exhaustive)
  - Claude exposes rewind, fork, plan mode, instruction mode, runtime command discovery, in-app MCP controls, `/` commands, `$` skills, and subagents
  - Codex exposes fork, history reload, plan mode, instruction mode, images, inline edit, `$` skills, and subagents, but not rewind or in-app MCP
  - Opencode exposes plan mode (managed `plan` mode; post-plan approval card gated), runtime-discovered slash commands, subagents, and Opencode-managed MCP, but not fork or rewind
  - Cursor exposes plan mode, history reload, images, and inline edit, but not fork, rewind, in-app MCP, or subagents

## Architecture

```text
ClaudianView (lifecycle + assembly)
├── ChatState
├── Controllers
│   ├── ConversationController
│   ├── StreamController
│   ├── SubagentStreamCoordinator
│   ├── ProviderLifecycleSubagentCoordinator
│   ├── InputController
│   ├── InlinePromptController
│   ├── ChatDropController
│   ├── SelectionController
│   ├── BrowserSelectionController
│   ├── CanvasSelectionController
│   └── NavigationController
├── Services
│   ├── SubagentManager
│   └── BangBashService
├── Rendering
│   ├── MessageRenderer
│   ├── ToolCallRenderer
│   ├── ThinkingBlockRenderer
│   ├── WriteEditRenderer
│   ├── DiffRenderer
│   ├── TodoListRenderer
│   ├── SubagentRenderer
│   ├── InlineExitPlanMode
│   ├── InlinePlanApproval
│   ├── InlineAskUserQuestion
│   └── InlineRuntimeError
├── Tabs
│   ├── TabManager
│   ├── TabBar
│   └── Tab
└── UI Components
    ├── InputToolbar
    ├── FileContextManager
    ├── ImageContextManager
    ├── StatusPanel
    ├── ConversationHistoryView
    ├── NavigationSidebar
    ├── InstructionModeManager
    └── BangBashModeManager
```

## State Flow

```text
User Input
  -> InputController
  -> ensure runtime for active provider
  -> ChatRuntime.prepareTurn()
  -> ChatRuntime.query()
  -> StreamController
  -> MessageRenderer + ChatState persistence
```

The feature layer consumes provider-neutral `StreamChunk` values. Providers own prompt encoding, history/session fallback, and task-result interpretation.

## Controllers

| Controller | Responsibility |
|------------|----------------|
| `ConversationController` | Session switching, history reload, save, and rewind. Delegates the history-dropdown list UI to `ConversationHistoryView` (in `ui/`), passing it the two lifecycle escapes — `switchTo` and `loadActive` — as callbacks |
| `StreamController` | Consume stream chunks, update streaming state, auto-scroll, abort handling. Delegates subagent chunks (`tool_use`/`tool_result`/`subagent_*`/`async_subagent_result`) to the two subagent coordinators |
| `SubagentStreamCoordinator` | The `SubagentManager`-mediated Task subagent state machine (sync/async Task, child `subagent_*` chunks, `TaskOutput`, async hydration/retry, Task tool-call ↔ subagent linking). Reached via `StreamController`'s `dispatchToolUse`/`handleToolResult`/`handleSubagentChunk`/`handleAsyncSubagentResult` delegations; streaming primitives arrive as `deps` callbacks |
| `ProviderLifecycleSubagentCoordinator` | Provider lifecycle subagents (spawn → wait/close) for CLI providers; owns the spawn-callId/agentId tracking maps. Distinct mechanism from the `SubagentManager` Task path above |
| `InputController` | Text input, mentions, images, resume dispatch, command dispatch, and post-plan approval flow. Delegates the inline blocking prompts (tool approval, ask-user, exit-plan-mode, post-plan approval) to `InlinePromptController` |
| `InlinePromptController` | Inline prompts that block a turn on user input — tool-approval cards, ask-user-question, exit-plan-mode, post-plan approval — plus the input-container hide/restore and the "needs attention" tab badge. Reached through `InputController`'s RuntimeHost-wired delegators |
| `SelectionController` | Editor selection polling and CM6 decorations |
| `BrowserSelectionController` | Browser view selection tracking |
| `CanvasSelectionController` | Canvas selection tracking |
| `ChatDropController` | Drag-and-drop lifecycle for one chat tab — overlay, payload routing, vault/external/image dispatch |
| `NavigationController` | Vim-style keyboard navigation |

## Rendering Pipeline

| Renderer | Handles |
|----------|---------|
| `MessageRenderer` | Main message orchestration, rewind/fork affordances, interrupt markers |
| `ToolCallRenderer` | Tool blocks and tool state |
| `ThinkingBlockRenderer` | Thinking / reasoning summaries |
| `WriteEditRenderer` | File writes and edits with diff previews |
| `DiffRenderer` | Inline diff rendering |
| `InlineExitPlanMode` | Claude tool-driven exit-plan approval |
| `InlinePlanApproval` | Shared post-plan approval flow driven by consumed turn metadata (currently Codex) |
| `InlineAskUserQuestion` | Ask-user cards emitted by provider runtimes |
| `InlineRuntimeError` | Actionable runtime-error cards — classified via `classifyRuntimeError` (cli-not-found / unauthenticated / context-too-large / generic) with open-settings, provider login hint, and real retry re-dispatch |
| `TodoListRenderer` | Todo items and status icons |
| `SubagentRenderer` | Background agent lifecycle rendering |

## Key Patterns

### Lazy Runtime Initialization

Tabs stay cold until the first send. The tab wiring exposes `ensureServiceInitialized()` so provider runtime creation happens only when needed.

### Message Streaming

```typescript
const preparedTurn = runtime.prepareTurn(request);

for await (const chunk of runtime.query(preparedTurn, history)) {
  streamController.handleStreamChunk(chunk);
}
```

### Auto-Scroll

- Enabled by default during streaming
- User scroll-up disables it
- Scroll-to-bottom re-enables it
- Resets to the saved setting on a new query

## Gotchas

- Work-order run tabs are real `TabManager` tabs but hidden from the visible tab badge row. The chat header Work Orders dropdown is the navigation affordance for active work-order tabs; ordinary tab badges render chat tabs only.
- `ClaudianView.onClose()` must abort active tabs and dispose runtimes
- `ChatState` is per-tab; `TabManager` coordinates tab-level operations such as fork targets and provider-aware command catalogs
- Title generation runs concurrently per conversation and routes by the global title-generation model selection, not by the active chat tab provider
- `/compact`
  - Claude skips context injection so the provider recognizes the built-in command and persists the compaction boundary
  - Codex routes compact turns to `thread/compact/start` and persists the durable `context_compacted` boundary from JSONL history
- Plan mode
  - Claude uses provider/runtime events for enter and exit plan mode
  - Codex sets `collaborationMode` on `turn/start` and triggers shared post-plan approval from consumed turn metadata
- Bang-bash mode bypasses provider runtimes and executes a local shell command directly
  - It is available only when an enabled provider exposes it in `ProviderChatUIConfig` (currently Claude)
- Forking is provider-owned under the hood
  - Both Claude and Codex support fork
  - `ChatRuntime.resolveSessionIdForFork()` and provider history services own the provider-specific fork/session mapping
- Mod+Enter composer send fires from two places by design
  - Textarea-level handler in `tabInputWiring.ts` runs first and short-circuits via `sendTabInputMessageFromExplicitEnterShortcut` before the slash dropdown / resume / mention handlers, so the dropdown can't swallow the shortcut
  - Vault-level `ClaudianView.scope.register(['Mod'], 'Enter', ...)` is the safety net; gated by `requireInputFocus: true` so it only sends when the composer textarea is `document.activeElement`, and guards `e.isComposing` (IME) and `e.defaultPrevented`. Returns `false` on send (Obsidian "stop bubbling") and `undefined` on miss
