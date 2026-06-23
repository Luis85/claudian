# CLAUDE.md

## Project Overview

Specorator is an Obsidian plugin that embeds provider-backed chat runtimes in a sidebar and inline-edit flow. Claude is the default, full-feature provider. Codex, Opencode, and Cursor are opt-in and join the same conversation model through `Conversation.providerId` plus provider-owned `providerState`.

## Architecture Status

- Product status: Specorator is a multi-provider product hosting four chat backends.
  - **Claude** is the full-feature provider: send, stream, cancel, resume, history reload, fork, plan mode, image attachments, inline edit, `#` instruction mode, `/` commands, `$` skills, subagents, rewind, MCP management, and Claude plugin integration.
  - **Codex** supports send, stream, cancel, resume, history reload, fork, plan mode, image attachments, inline edit, `#` instruction mode, `$` skills, and subagents. Unsupported or gated surfaces are rewind, runtime-discovered provider commands, in-app MCP management, and Claude plugin integration.
  - **Opencode** runs via the Opencode CLI server and supports send, stream, cancel, resume, history reload, plan mode, image attachments, inline edit, `#` instruction mode, subagents, runtime-discovered slash commands, and Opencode-managed MCP. Plan turns route through Opencode's managed `plan` mode (toolbar toggle / Shift+Tab); when the turn produces assistant content, the runtime sets `planCompleted` and the shared post-plan approval card opens. Fork and rewind are gated.
  - **Cursor** runs via the Cursor Agent CLI directly (`cursor-agent --output-format stream-json`, parsed as NDJSON) — not ACP — and supports send, stream, cancel, resume, history reload, plan mode, image attachments, and inline edit. AskUserQuestion is supported via an auto-resumed follow-up turn: the one-shot `--print` CLI auto-rejects the tool in-process (no bidirectional channel), so Specorator collects the answer, marks the tool block neutrally, and delivers the answer to the agent as the next `--resume` turn (`ChatTurnMetadata.autoFollowUpText` → `InputController` auto-send). Subagent definitions are first-class: discovered (flat, non-recursive — matching Cursor's own root-only discovery) from `.cursor/agents/` (vault), `~/.cursor/agents/` (global), and read-only `.claude/agents/` (Markdown) + `.codex/agents/` (TOML) compat roots; only the vault/global agents Cursor itself loads are @-mentionable via `CursorAgentMentionProvider` (built-in Explore/Bash/Browser and the read-only compat agents appear in settings but aren't mentionable — Cursor can't delegate to them by name, and only the name is sent), and writable agents are manageable in Cursor settings; live async subagent lifecycle awaits the ACP transport decision (see `docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design.md`). Rewind and in-app MCP management are gated.
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
npm run check:loc        # LOC ratchet guard (see docs/build-ci/quality-gates.md)
npm run check:artifacts  # post-build artifact smoke (run after npm run build)
npm run check:quality    # fallow metric ratchet vs scripts/quality-baseline.json (blocking CI gate)
npm run quality          # fallow: dead-code + dupes + health (advisory detail)
npm run quality:audit    # fallow audit: changed-files review vs main
npm run quality:health   # fallow health: score + hotspots + refactor targets
```

CI gates and the lint severity policy (errors block; warnings are a tracked,
non-blocking backlog) are catalogued in
[`docs/build-ci/quality-gates.md`](docs/build-ci/quality-gates.md).

## Architecture

| Layer | Purpose | Details |
|-------|---------|---------|
| **app** | Shared defaults and plugin-level storage helpers | `defaultSettings`, `SpecoratorSettingsStorage`, `SharedStorageService` |
| **core** | Provider-neutral contracts and infrastructure | See [`src/core/CLAUDE.md`](src/core/CLAUDE.md). Includes `runtime/`, `providers/`, `auxiliary/`, `bootstrap/`, `commands/`, `context/`, `events/`, `logging/`, `mcp/`, `prompt/`, `security/`, `storage/`, `tools/`, `types/` |
| **providers/acp** | Agent Client Protocol shared transport | JSON-RPC client, subprocess wrapper, session config, tool stream adapter, update normalizer |
| **providers/claude** | Claude SDK adaptor | See [`src/providers/claude/CLAUDE.md`](src/providers/claude/CLAUDE.md) |
| **providers/codex** | Codex app-server adaptor | See [`src/providers/codex/CLAUDE.md`](src/providers/codex/CLAUDE.md) |
| **providers/opencode** | Opencode adaptor over ACP | Runtime, prompt encoding, history, settings, modes, models, commands, subagent storage, MCP, settings UI |
| **providers/cursor** | Cursor Agent adaptor over the `cursor-agent` stream-json CLI (not ACP) | Runtime, NDJSON stream/tool mapping, prompt encoding, JSONL history hydration, settings reconciliation, plan-path conventions, settings UI |
| **features/chat** | Main sidebar interface | See [`src/features/chat/CLAUDE.md`](src/features/chat/CLAUDE.md) |
| **features/inline-edit** | Inline edit modal and provider-backed edit services | `InlineEditModal` plus provider-owned inline edit services |
| **features/settings** | Settings shell + registry renderer | All seven tabs render through the settings registry (`registry/`, parity tests in `tests/integration/settings/`); provider-owned widgets mount via the `widgets` map on each provider's `settingsTabRenderer`. Legacy imperative renderers remain as fallback until the v4.0.0 deletion pass |
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

### Performance suite (blocking CI gate since 2026-06-10)

```bash
npm run test:perf                                   # run scaling guard rails + metrics
SPECORATOR_PERF_JSON=perf.jsonl npm run test:perf     # also append trend records
```

`tests/perf/*.perf.test.ts` run via `jest.perf.config.js`, separate from
`npm test` and coverage, and gate CI via the `perf` job. Each spec pairs
deterministic scaling assertions (cost must track a bounded window, not
unbounded input) with a report-only metrics table for long-term trend
tracking; timings are never asserted, which is what makes the suite gateable
on noisy shared runners.

Current coverage, by user-visible path:

| Spec | Guards | Scales with |
|------|--------|-------------|
| `messageRenderer.perf` | mounted DOM/listeners stay O(render window) | conversation length |
| `toolCallIndex.perf` | streaming tool lookup stays O(1)/chunk | tools per turn |
| `claudeHistory.perf` | `filterActiveBranch` stays ~linear | transcript length |
| `codexHistory.perf` | `parseCodexSessionContent` stays ~linear | transcript length |
| `conversationHistory.perf` | history-dropdown DOM growth (windowed) + `loadConversations` load/sort | conversation count |
| `navigationSidebar.perf` | prev/next scan stays O(mounted), bounded by render window | mounted messages |
| `agentBoard.perf` | board render stays ~linear (flat per-card DOM/listeners); `patchLiveStrip`/`patchCard` stay O(1) | work-order count |
| `taskRunCoordinator.perf` | launch validation stays O(1) vs active runs; drain pass bounded by slot cap × runnable, not board size | active runs / runnable cards |
| `multiTabStreaming.perf` | per-tab pending frames stay constant per flush; one tab's render work independent of other tabs | concurrent streaming tabs |

## Storage

| Path | Contents |
|------|----------|
| `.claude/settings.json` | Claude Code-compatible project settings, permissions, and plugin overrides |
| `.specorator/specorator-settings.json` | Shared Specorator app settings plus provider-specific configuration |
| `.claude/mcp.json` | Specorator-managed MCP servers for Claude |
| `.claude/commands/**/*.md` | Claude slash commands |
| `.claude/skills/*/SKILL.md` | Claude skills |
| `.claude/agents/*.md` | Claude vault agents |
| `.specorator/sessions/*.meta.json` | Provider-neutral session metadata |
| `.specorator/runs/<runId>/heartbeat.json` | Per-run sidecar heartbeat (`{ at, status, pauseReason? }`) — moved off the work-order note to avoid racing the agent's `Edit` tool; GC'd at terminal |
| `.specorator/runs/<runId>/ledger.jsonl` | Per-run sidecar ledger (one `TaskLedgerEntry` per line) — snapshotted into the work-order note once at terminal |
| loop folder (default `Agent Board/loops/*.md`) | Loop definitions (`type: specorator-loop`): reusable playbooks (Use when / Approach / Steps / Verify / Notes) attachable to a work order or template |
| `.codex/skills/*/SKILL.md` | Codex vault skills |
| `.agents/skills/*/SKILL.md` | Alternate Codex vault skill root |
| `.codex/agents/*.toml` | Codex vault subagent definitions |
| `.cursor/agents/*.md` | Cursor vault subagent definitions (markdown frontmatter) |
| `~/.claude/projects/{vault}/*.jsonl` | Claude-native transcripts |
| `~/.codex/sessions/**/*.jsonl` | Codex-native transcripts |

> Provider API keys, MCP auth headers, and MCP env vars persist via Obsidian `SecretStorage` (keychain-backed), not in vault config files. Substrate: `src/core/security/secretStore.ts`, `secretIds.ts`, `src/core/mcp/mcpSecrets.ts`. Requires `minAppVersion` 1.11.5.

## Development Notes

- **Provider-native first**: Prefer the official Claude SDK and Codex app-server behavior over reimplementing provider features locally. When the provider already owns a capability, adapt to it instead of shadowing it.
- **Runtime exploration**: For provider integrations, inspect real runtime output first. Claude data lands under `~/.claude/` and Codex data under `~/.codex/`. Real transcripts beat guessed event shapes. Put throwaway local scripts and raw runtime captures in `.context/`; only promote durable tooling into `dev/`.
- **Comments**: Comment why, not what. Avoid narration and redundant JSDoc.
- **TDD workflow**: For new behavior or bug fixes, write the failing test first in the mirrored `tests/` path, make it pass, then refactor.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` after editing.
- No `console.*` in production code.
- No `innerHTML`/`outerHTML`/`insertAdjacentHTML` in `src/` (lint-enforced via `no-restricted-syntax`). Build DOM with Obsidian `createEl`/`createDiv`/`createSpan`/`setText`/`.empty()`, and render markdown/agent content through `MarkdownRenderer`.
- **Docs vs `.context/`**: Durable design notes, plans, ADRs, handoffs, research, and reviews live under `docs/` as Markdown with YAML frontmatter (`title`, `date`, `status`, `scope`). ADRs go in `docs/adr/`, design specs in `docs/superpowers/specs/` and implementation plans in `docs/superpowers/plans/`, product specs in `docs/product/`, ideas in `docs/ideas/`, handoffs in `docs/handoffs/`, research in `docs/research/`, and reviews in `docs/reviews/`. `.context/` is for **throwaway only**: local scripts, raw patches, runtime captures, scratch notes that should never be committed or referenced as canonical. If a `.context/` file is worth keeping, promote it to `docs/` with proper frontmatter.
