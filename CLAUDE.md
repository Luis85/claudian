# CLAUDE.md

## Project Overview

Claudian is an Obsidian plugin that embeds provider-backed chat runtimes in a sidebar and inline-edit flow. Claude is the default, full-feature provider. Codex, Opencode, and Cursor are opt-in and join the same conversation model through `Conversation.providerId` plus provider-owned `providerState`.

## Architecture Status

- Product status: Claudian is a multi-provider product hosting four chat backends.
  - **Claude** is the full-feature provider: send, stream, cancel, resume, history reload, fork, plan mode, image attachments, inline edit, `#` instruction mode, `/` commands, `$` skills, subagents, rewind, MCP management, and Claude plugin integration.
  - **Codex** supports send, stream, cancel, resume, history reload, fork, plan mode, image attachments, inline edit, `#` instruction mode, `$` skills, and subagents. Unsupported or gated surfaces are rewind, runtime-discovered provider commands, in-app MCP management, and Claude plugin integration.
  - **Opencode** runs via the Opencode CLI server and supports send, stream, cancel, resume, history reload, fork, image attachments, inline edit, `#` instruction mode, subagents, and Opencode-managed MCP. Plan mode and rewind are gated.
  - **Cursor** runs via the Cursor Agent CLI directly (`cursor-agent --output-format stream-json`, parsed as NDJSON) — not ACP — and supports send, stream, cancel, resume, history reload, plan mode, image attachments, and inline edit. Rewind, in-app MCP management, and subagents are gated.
- App shell: `src/app/` owns shared settings defaults and plugin-level storage helpers. `src/core/` owns provider-neutral runtime, registry, tool, and type contracts plus the shared event bus and leveled logger.
- Provider boundary: `src/core/runtime/` and `src/core/providers/` define the chat-facing seam. `ProviderRegistry` creates runtimes and provider-owned auxiliary services. `ProviderWorkspaceRegistry` owns workspace services such as command catalogs, agent mention providers, CLI resolution, MCP managers, and provider settings tabs.
- Shared transport: `src/providers/acp/` packages the Agent Client Protocol JSON-RPC client, subprocess wrapper, session config, tool stream adapter, and update normalizer. Only Opencode builds its runtime on top of it. Cursor does not use ACP; it spawns the `cursor-agent` CLI directly and parses its `stream-json` NDJSON output through its own `cursorStreamMapper` and `cursorToolNormalization`.
- Claude adaptor: `src/providers/claude/` owns the Claude runtime, prompt encoding, stream transforms, history hydration, CLI resolution, plugin and agent discovery, MCP storage, and Claude-specific settings UI. `ClaudeCommandCatalog` merges vault commands, vault skills, and runtime-supported commands behind the shared command catalog contract.
- Codex adaptor: `src/providers/codex/` owns the `codex app-server` runtime, JSON-RPC transport, prompt encoding, raw live stream projection, JSONL history reload, settings reconciliation, normalization, skill cataloging, subagent storage, and Codex settings UI. `CodexSkillCatalog` provides `$` skill discovery from `.codex/skills/` and `.agents/skills/` without relying on runtime command discovery.
- Opencode adaptor: `src/providers/opencode/` owns the Opencode runtime, ACP-backed transport, prompt encoding, history hydration, settings reconciliation, mode and model catalogs, command and skill discovery, subagent storage under `.opencode/agent/` (with legacy `.opencode/agents/` fallback), Opencode-managed MCP wiring, and Opencode settings UI.
- Cursor adaptor: `src/providers/cursor/` owns the Cursor Agent runtime, which spawns the `cursor-agent` CLI directly and parses its `stream-json` NDJSON output through `cursorStreamMapper` and `cursorToolNormalization` (no ACP), with a Windows-safe spawn lock around `~/.cursor/cli-config.json`, prompt encoding, JSONL history hydration from `~/.cursor/chats/<workspace>/<session>/`, settings reconciliation, plan-path conventions under `.cursor/plans/`, and Cursor settings UI.
- Conversations: `Conversation` carries `providerId` and opaque `providerState`. Claude state is typed behind `ClaudeProviderState`. Codex state is typed behind `CodexProviderState` and stores `threadId`, `sessionFilePath`, and optional fork metadata. Opencode state is typed behind `OpencodeProviderState` and stores an optional `databasePath`. Cursor state is typed behind `CursorProviderState` and stores the Cursor `chatSessionId`.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run lint:fix
npm run test
npm run test:watch
npm run test:coverage
```

## Architecture

| Layer | Purpose | Details |
|-------|---------|---------|
| **app** | Shared defaults and plugin-level storage helpers | `defaultSettings`, `ClaudianSettingsStorage`, `SharedStorageService` |
| **core** | Provider-neutral contracts and infrastructure | See [`src/core/CLAUDE.md`](src/core/CLAUDE.md). Includes `runtime/`, `providers/`, `auxiliary/`, `bootstrap/`, `commands/`, `events/`, `logging/`, `mcp/`, `prompt/`, `security/`, `storage/`, `tools/`, `types/` |
| **providers/acp** | Agent Client Protocol shared transport | JSON-RPC client, subprocess wrapper, session config, tool stream adapter, update normalizer |
| **providers/claude** | Claude SDK adaptor | See [`src/providers/claude/CLAUDE.md`](src/providers/claude/CLAUDE.md) |
| **providers/codex** | Codex app-server adaptor | See [`src/providers/codex/CLAUDE.md`](src/providers/codex/CLAUDE.md) |
| **providers/opencode** | Opencode adaptor over ACP | Runtime, prompt encoding, history, settings, modes, models, commands, subagent storage, MCP, settings UI |
| **providers/cursor** | Cursor Agent adaptor over the `cursor-agent` stream-json CLI (not ACP) | Runtime, NDJSON stream/tool mapping, prompt encoding, JSONL history hydration, settings reconciliation, plan-path conventions, settings UI |
| **features/chat** | Main sidebar interface | See [`src/features/chat/CLAUDE.md`](src/features/chat/CLAUDE.md) |
| **features/inline-edit** | Inline edit modal and provider-backed edit services | `InlineEditModal` plus provider-owned inline edit services |
| **features/settings** | Shared settings shell with provider tabs | General tab plus provider-owned Claude, Codex, Opencode, and Cursor tab renderers |
| **features/tasks** | Agent Board work orders and run coordination | See [`src/features/tasks/CLAUDE.md`](src/features/tasks/CLAUDE.md) |
| **features/quickActions** | Quick action parsing and storage | Vault-defined quick actions surfaced in chat |
| **shared** | Reusable UI building blocks | Dropdowns, modals, mention UI, icons |
| **i18n** | Internationalization | 10 locales |
| **utils** | Cross-cutting utilities | env, path, markdown, diff, context, file-link, image, browser, canvas, session, subagent helpers |
| **style** | Modular CSS | See [`src/style/CLAUDE.md`](src/style/CLAUDE.md) |

## Tests

```bash
npm run test -- --selectProjects unit
npm run test -- --selectProjects integration
npm run test:coverage -- --selectProjects unit
```

Tests mirror the `src/` layout under `tests/unit/` and `tests/integration/`.

### Performance suite (monitoring, not a gate)

```bash
npm run test:perf                                   # run scaling guard rails + metrics
CLAUDIAN_PERF_JSON=perf.jsonl npm run test:perf     # also append trend records
```

`tests/perf/*.perf.test.ts` run via `jest.perf.config.js` and are deliberately
excluded from `npm test`, CI, and coverage. Each spec pairs deterministic
scaling assertions (cost must track a bounded window, not unbounded input)
with a report-only metrics table for long-term trend tracking; timings are never
asserted, so the suite stays stable on noisy machines.

Current coverage, by user-visible path:

| Spec | Guards | Scales with |
|------|--------|-------------|
| `messageRenderer.perf` | mounted DOM/listeners stay O(render window) | conversation length |
| `toolCallIndex.perf` | streaming tool lookup stays O(1)/chunk | tools per turn |
| `claudeHistory.perf` | `filterActiveBranch` stays ~linear | transcript length |
| `codexHistory.perf` | `parseCodexSessionContent` stays ~linear | transcript length |
| `conversationHistory.perf` | history-dropdown DOM growth (monitored, unwindowed) + `loadConversations` load/sort | conversation count |

## Storage

| Path | Contents |
|------|----------|
| `.claude/settings.json` | Claude Code-compatible project settings, permissions, and plugin overrides |
| `.claudian/claudian-settings.json` | Shared Claudian app settings plus provider-specific configuration |
| `.claude/mcp.json` | Claudian-managed MCP servers for Claude |
| `.claude/commands/**/*.md` | Claude slash commands |
| `.claude/skills/*/SKILL.md` | Claude skills |
| `.claude/agents/*.md` | Claude vault agents |
| `.claudian/sessions/*.meta.json` | Provider-neutral session metadata |
| `.codex/skills/*/SKILL.md` | Codex vault skills |
| `.agents/skills/*/SKILL.md` | Alternate Codex vault skill root |
| `.codex/agents/*.toml` | Codex vault subagent definitions |
| `~/.claude/projects/{vault}/*.jsonl` | Claude-native transcripts |
| `~/.codex/sessions/**/*.jsonl` | Codex-native transcripts |

## Development Notes

- **Provider-native first**: Prefer the official Claude SDK and Codex app-server behavior over reimplementing provider features locally. When the provider already owns a capability, adapt to it instead of shadowing it.
- **Runtime exploration**: For provider integrations, inspect real runtime output first. Claude data lands under `~/.claude/` and Codex data under `~/.codex/`. Real transcripts beat guessed event shapes. Put throwaway local scripts in `.context/`; only promote durable tooling into `dev/`.
- **Comments**: Comment why, not what. Avoid narration and redundant JSDoc.
- **TDD workflow**: For new behavior or bug fixes, write the failing test first in the mirrored `tests/` path, make it pass, then refactor.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` after editing.
- No `console.*` in production code.
- Put non-committed notes, handoff files, and throwaway scripts in `.context/`.
