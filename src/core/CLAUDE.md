# Core Infrastructure

Core modules stay provider-neutral. Features depend on `core/`; providers implement the boundary behind it.

## Runtime Status

- `core/runtime/` and `core/providers/` define the chat-facing seam. `ChatRuntime` is the neutral runtime interface. The `claude`, `codex`, `opencode`, and `cursor` runtimes (`src/providers/<id>/runtime/`) provide the concrete implementations.
- `ProviderRegistry` owns runtime and auxiliary-service factories. `ProviderWorkspaceRegistry` owns provider workspace services such as command catalogs, agent mentions, CLI resolution, MCP managers, and provider settings tabs.
- Claude-specific agents, plugins, MCP, runtime command discovery, and storage live under `src/providers/claude/`.
- Codex-specific skills, subagents, JSONL history hydration, session tailing, and workspace services live under `src/providers/codex/`.

## Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `bootstrap/` | Provider-neutral session metadata storage and shared app-storage contracts | `SessionStorage`, `storage.ts` |
| `commands/` | Built-in cross-provider commands | `builtInCommands` |
| `context/` | Provider-neutral context envelope substrate (planned, slice 1.1 of [[2026-06-05-plugin-improvement-roadmap]]) | `buildContextEnvelope`, `ContextEnvelope`, `ContextSourceHandle` |
| `events/` | Typed in-process event bus (synchronous, error-isolated, optional error sink) | `EventBus` |
| `logging/` | Leveled, namespaced diagnostic logger: console + bounded ring buffer, secret redaction | `Logger`, `types`, `redact`, `consoleSink`, `formatLogEntries` |
| `mcp/` | Provider-neutral MCP coordination and config parsing | `McpConfigParser`, `McpServerManager`, `McpTester`, `McpStorageAdapter` |
| `prompt/` | Shared prompt templates | `mainAgent`, `inlineEdit`, `titleGeneration`, `instructionRefine` |
| `providers/` | Registry, capability, environment, and workspace-service contracts | `ProviderRegistry`, `ProviderWorkspaceRegistry`, `ProviderSettingsCoordinator`, `providerEnvironment`, `providerConfig`, `modelRouting`, `subprocessEnvironmentAllowlist`, `cursorSessionIdValidation`, `types` (defines `ModelPricing` + optional `ProviderChatUIConfig.getModelPricing` and optional `ProviderConversationHistoryService.extractLastUsage`) |
| `providers/commands/` | Shared command catalog contracts | `ProviderCommandCatalog`, `ProviderCommandEntry`, `hiddenCommands` |
| `providers/usage/` | Single canonical `UsageInfo` builder + percentage clamp; every provider emitter funnels through this | `buildUsageInfo` (requires non-empty model, floors integer fields, clamps percentage), `clampPercentage` (handles `window ≤ 0` / `NaN` / `Infinity` → 0) |
| `runtime/` | Provider-neutral runtime contracts | `ChatRuntime`, `ChatTurnRequest`, `PreparedChatTurn`, `SessionUpdateResult`, approval/query types |
| `security/` | Permission and approval helpers | `ApprovalManager` |
| `storage/` | Generic filesystem adapters | `VaultFileAdapter`, `HomeFileAdapter` |
| `tools/` | Shared tool constants and formatting helpers | `toolNames`, `toolIcons`, `toolInput`, `todo` |
| `types/` | Shared type definitions | `settings`, `mcp`, `chat`, `tools`, `diff`, `agent`, `plugins` |
| `usage/` | Cross-cutting per-entry usage counter (quick-actions + skills): typed events, composite key, debounced JSON persistence at `.claudian/usage.json` | `UsageTracker` (debounced flush + hydrate), `UsageStorage` (corrupt-file backup, schema-version cold-start), `serializeKey`/`parseKey`, `UsageEventMap` (`usage.recorded`, `usage.cleared`) |

## Dependency Rules

```text
types/ <- all modules
storage/ <- bootstrap/, provider workspace services
runtime/ + providers/ <- provider implementations
features/ -> core contracts only
```

## Key Patterns

### ChatRuntime

```typescript
const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId });
const preparedTurn = runtime.prepareTurn(request);

for await (const chunk of runtime.query(preparedTurn, history)) {
  // Feature layer consumes provider-neutral StreamChunk values.
}
```

### Provider Factories

```typescript
const titleService = ProviderRegistry.createTitleGenerationService(plugin);
const refineService = ProviderRegistry.createInstructionRefineService(plugin, providerId);
const inlineEditService = ProviderRegistry.createInlineEditService(plugin, providerId);
```

Title generation is provider-routed by the global `titleGenerationModel` setting.
It is intentionally independent from the active chat tab provider.

### Workspace Services

```typescript
const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
const agentMentions = ProviderWorkspaceRegistry.getAgentMentionProvider(providerId);
const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
```

### Storage

- `core/storage/` provides generic vault/home adapters only
- Provider-owned workspace storage/history lives under each provider directory (e.g. `src/providers/claude/storage/`, `src/providers/codex/`, `src/providers/opencode/`, `src/providers/cursor/history/`)
- Provider-owned transcript hydration and deletion live under provider `history/` services

## Gotchas

- `ChatRuntime.cleanup()` must run when a tab is disposed
- `Conversation.providerState` is intentionally opaque in feature code; provider-specific fields belong behind typed provider helpers
- Plan mode is capability-driven
  - Claude enters and exits plan mode through provider/runtime events
  - Codex sends `collaborationMode` on `turn/start` and uses post-stream plan approval metadata
- Command discovery differs by provider
  - Claude merges runtime-discovered commands with vault commands and skills
  - Codex skill discovery comes from `CodexSkillCatalog` and does not depend on runtime command discovery
- Logging: never use `console.*` in `src/` (the `no-console` lint rule forbids it; the only sanctioned site is `logging/consoleSink.ts`). Log through `plugin.logger.scope('area')`. Guard expensive arg building with `logger.isEnabled('debug')` on hot paths.
  - **Redaction contract:** `Logger` redacts every arg before it reaches the console or the ring buffer. Object keys matching `/(token|key|secret|password|credential|api[-_]?key|authorization|cookie)/i` are masked to `[redacted]` (deep, non-mutating). Never log `.env*` contents, provider configs, or private keys. Log prompt/transcript bodies only at `debug`, truncated.
- Usage emission contract: every provider that emits `UsageInfo` MUST route through `core/providers/usage/buildUsageInfo`. The builder throws on empty/non-string `model`, so each caller threads the active model at emission time. Cursor and the dormant Codex tail builder silently drop the usage chunk when the model is unknown rather than emit a contract-violating shape. The cross-provider contract is enforced by `tests/unit/providers/shared/usageContractMatrix.test.ts`.
- History-backed usage recovery: `ProviderConversationHistoryService.extractLastUsage?(conversation, ctx)` is optional. When present, `ConversationStore` hydration calls it after messages land if `Conversation.usage` is unset. Implementations MUST return `null` on parse failure (never throw); `ConversationStore` wraps the call in `.catch(() => null)` as a backstop. Catalog defaults supply the `contextWindow` fallback when the provider's persisted shape lacks one (Opencode in particular — `data` JSON carries `tokens` + `cost` but not the window).
- Subprocess env: every provider that spawns a CLI subprocess (Cursor, Opencode) MUST route the child env through `providers/subprocessEnvironmentAllowlist` and pass the allowlisted result as the **base** of the `spawn`/`AcpSubprocess` env (do NOT spread `process.env` on top of it — that reintroduces every host var and defeats the allowlist).
  - The allowlist + denylist are case-insensitive (Windows env-var names are case-insensitive; `Object.entries(process.env)` yields mixed-case keys).
  - Provider-prefix keys (`/^CURSOR_/i`, `/^OPENCODE_/i`) pass through alongside the allowlist; `NODE_TLS_REJECT_UNAUTHORIZED` is denied in every casing.
  - Custom user-entered env (provider settings → Environment) is opt-in and passes outside the allowlist, but the denylist still applies.
- Cursor-style session ids land in `path.join` against `~/.cursor/chats/...`. Validate every id through `providers/cursorSessionIdValidation` (`isValidCursorSessionId`) before any path operation. Rejects path-traversal (`..`), pure-dot ids (`.`, `..`, etc. that would collapse to parent dir), trailing-dot ids (Win32 silently trims trailing periods), separators, and overlong inputs.
