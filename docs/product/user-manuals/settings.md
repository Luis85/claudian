---
date: 2026-06-04
status: shipped
type: user-manual
parent: Product
---
# Claudian — Settings

This manual is the index for the Claudian settings panel. Each tab gets a section. Where a feature has its own manual, follow the cross-link instead of looking for the depth here.

Settings are scoped to a single Obsidian vault and stored in plain JSON files inside the vault (see [Where settings are stored](#where-settings-are-stored)). Switching vaults switches the whole configuration.

---

## Opening settings

Open Obsidian's settings (gear icon → **Settings**, or `Cmd/Ctrl+,`), scroll the left sidebar to **Community plugins**, and click **Claudian**.

The panel is organized as a tab bar at the top:

| Tab | When visible | What it covers |
|-----|--------------|----------------|
| **General** | Always | Provider on/off toggles, language, quick actions, display, conversations, content, input, hotkeys, shared environment, diagnostics. |
| **Agent Board** | Always | Work-order folders, default provider/model, common-template installer, lane editor. |
| **Claude** | When Claude is enabled in **General → Providers** | CLI path, safety, models, slash commands, subagents, MCP servers, Claude Code plugins, Claude environment, experimental flags. |
| **Codex** | When Codex is enabled | CLI path (and WSL settings on Windows), safety, models, skills, subagents, MCP notice, Codex environment. |
| **Opencode** | When Opencode is enabled | CLI path, visible-model picker, hidden commands, subagents, Opencode environment. |
| **Cursor** | When Cursor is enabled | Visible-model picker, model refresh, Cursor Agent CLI path, Cursor environment. |

Closing the settings dialog persists every change immediately — there is no save button.

---

## General

### Providers

Toggle each provider on or off. Toggling **on** reveals that provider's tab. Toggling **off** hides the tab and removes the provider's models from the chat selector, but does not delete saved sessions.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable Claude** | Show Claude in the chat provider list and reveal the Claude tab. | Off |
| **Enable Codex** | Show Codex and reveal the Codex tab. | Off |
| **Enable Opencode** | Show Opencode and reveal the Opencode tab. | Off |
| **Enable Cursor** | Show Cursor and reveal the Cursor tab. | Off |

### Language

| Setting | What it does | Default |
|---------|--------------|---------|
| **Language** | Switches the plugin's interface language. Re-renders the settings panel. | English |

### Quick actions

| Setting | What it does | Default |
|---------|--------------|---------|
| **Quick actions folder** | Vault folder scanned for quick-action notes. Empty falls back to `Quick Actions`. | `Quick Actions` |

See [[quick-actions]] for the quick-action note format and how they show up in the composer.

### Display

| Setting | What it does | Default |
|---------|--------------|---------|
| **Tab bar position** | Where the chat tab bar sits — **Above input** or **In header**. | Above input |
| **Maximum chat tabs** | Concurrent chat tabs allowed (3–10). Above 5 a warning appears about memory impact. | 3 |
| **Open Claudian in** | Where the chat view opens — **Right sidebar**, **Left sidebar**, or **Main editor tab**. | Right sidebar |
| **Auto-scroll during streaming** | Follow the latest streamed token. Off pins the scroll at the top. | On |
| **Defer math rendering during streaming** | Show raw LaTeX while streaming, render KaTeX once each text block completes. | On |

### Conversations

| Setting | What it does | Default |
|---------|--------------|---------|
| **Auto-generate conversation titles** | Have a model name a conversation after its first user message. | On |
| **Title generation model** | Model used for the title call. **Auto (Haiku)** picks a sensible default; otherwise any registered provider's model id. Hidden when auto-titling is off. | Auto |

### Content

| Setting | What it does | Default |
|---------|--------------|---------|
| **What should Claudian call you?** | Name injected into the system prompt for personalized greetings. | Empty |
| **Custom system prompt** | Appendix appended to the built-in system prompt. | Empty |
| **Excluded tags** | One tag per line (no `#`). Notes with these tags do not auto-load as context. | Empty |
| **Media folder** | Folder Claude looks in when a note embeds `![[image.jpg]]`. Empty means vault root. | Empty |

Editing **What should Claudian call you?**, **Custom system prompt**, or **Media folder** triggers a session restart on blur so the new prompt takes effect on the next turn.

### Input

| Setting | What it does | Default |
|---------|--------------|---------|
| **Require Command/Ctrl+Enter to send** | When on, Enter inserts a newline; Cmd+Enter (macOS) or Ctrl+Enter sends. | Off |
| **Vim-style navigation mappings** | One mapping per line in the form `map <key> <action>` where action is `scrollUp`, `scrollDown`, or `focusInput`. Defaults are `w / s / i`. | `w / s / i` |

### Hotkeys

A grid of read-only badges for the Claudian commands that support hotkeys — **Inline Edit**, **Open Chat**, **New Session**, **New Tab**, **Close Tab**. Clicking a row opens Obsidian's Hotkeys settings filtered to Claudian commands. Hotkeys themselves are bound in Obsidian's Hotkeys settings, not here.

### Environment

A shared environment scope plus a snippet manager.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Shared environment** | `KEY=VALUE` lines (one per line, shell `export` prefix accepted) passed to every provider. Intended for `PATH`, proxies, certs, temp dirs. | Empty |
| **Secret variables** | API keys / tokens stored in Obsidian's keychain-backed SecretStorage (OS keychain), not in plaintext. Each row is a variable name + a selected/created secret; only the secret's name is saved in settings. | Empty |
| **Snippets** | Save and reapply named environment blocks. Each snippet can attach its own custom context-window overrides and model aliases. | Empty |

**Secret variables** (requires Obsidian **1.11.5+**): use this instead of typing API keys into the plaintext textarea. The value lives in your OS keychain (outside the vault); the vault settings store only a reference. Secret-shaped keys you've already typed into the environment fields are migrated into SecretStorage automatically on load. Secrets are **device-local** — on a synced vault opened on another machine, a row shows "not set on this device" until you re-enter it (a one-time notice also reminds you). Honest scope: this keeps keys out of synced/committed vault files, but does not isolate them from other plugins or same-user processes.

A review warning surfaces when a key in the shared scope (e.g. `OPENAI_API_KEY`) probably belongs in a provider-scoped section instead.

Below the textarea, if any custom model ids are discovered from `*_MODEL` variables, **Custom model overrides** appears: per-model **Alias** (selector label) and context-window input (`200k`, `1m`, or a number 1000–10000000). See [[composer-context-pills]] for how the context window is surfaced in chat.

For Codex (`gpt-5.2`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`) and Cursor (Claude/Composer/Sonic/Grok/GPT/Gemini families) Claudian ships an exact-id catalog of known windows; a custom override here applies only to ids the catalog does not recognise.

### Diagnostics

See the [Diagnostics](#diagnostics) section below and [[configurable-logger]].

---

## Agent Board

Cross-link: [[agent-board]] for the board UI, [[work-order-templates]] for templates, [[agent-board-configurable-lanes]] for lanes, [[agent-board-chat-interop-and-capture]] for chat capture.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Work order folder** | Folder where new work-order notes are created. | `Agent Board/tasks` |
| **Template folder** | Folder where work-order template notes live. If it matches the work order folder, an inline warning is shown — templates would otherwise render as invalid work orders on the board. | `Agent Board/templates` |
| **Common templates → Install** | Writes the starter set (Bug fix, Feature, Refactor, Research spike, Documentation, Test backfill) into the template folder. Skips any whose filename already exists. Detail in [[work-order-templates]]. | — |
| **Archive folder** | Where archived work orders move. Keep it outside the work order folder. | `Agent Board/archive` |
| **Default provider** | Provider stamped on captured work orders. Dropdown lists only enabled providers; selection is auto-corrected to the first enabled provider if the stored choice is now disabled. | unset (`null`) until a provider is enabled, then the first enabled provider in registration order (Claude, Codex, Opencode, Cursor) |
| **Default model** | Model stamped on captured work orders. Resets to **Provider default** whenever the provider changes. | Provider default |

### Board lanes

The **Board lanes** sub-section beneath the table embeds the lane editor described in [[agent-board-configurable-lanes]]: per-lane title, visibility, status assignment, definition of ready, definition of done, move up/down, and remove. Changes are persisted as you edit.

---


## Claude

Visible when Claude is enabled.

### Setup

| Setting | What it does | Default |
|---------|--------------|---------|
| **Claude CLI path** | Per-device path to the Claude Code CLI. Empty = auto-detect from `PATH`. On Windows, prefer `cli-wrapper.cjs` over `claude.cmd`. On macOS/Linux, paste `which claude`. Validated on input. | Auto-detect |

### Safety

| Setting | What it does | Default |
|---------|--------------|---------|
| **Safe mode** | Permission mode used when the Safe toggle is active in chat: `acceptEdits`, `auto`, or `default`. See [[plan-mode]] for how Plan mode interacts with this. | `acceptEdits` |
| **Load user Claude settings** | Load `~/.claude/settings.json` (the Claude Code CLI's user-level rules). When on, those permission rules may bypass Safe mode. | On |

### Models

| Setting | What it does | Default |
|---------|--------------|---------|
| **Opus 1M context window** | Expose `opus[1m]` in the model selector. Plan-gated by Anthropic — see the description in the panel. | Off |
| **Sonnet 1M context window** | Expose `sonnet[1m]`. Same plan caveats. | Off |
| **Custom models** | Append custom Claude model ids, one per line (e.g. `claude-opus-4-6-20251101`). The `ANTHROPIC_MODEL` env var still overrides the picker. | Empty |

### Commands and skills

A list view of vault commands (`.claude/commands/*.md`) and skills (`.claude/skills/*/SKILL.md`) with edit, delete, and create-from-scratch controls.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Hidden Commands and Skills** | One name per line (no leading `/`). Hides those entries from the chat `/` dropdown — useful for muting noisy Claude Code builtins. | Empty |

### Subagents

Vault subagents under `.claude/agents/*.md`. Each entry has a modal editor for name, description, model override, allowed/disallowed tools, skills, and system prompt.

### MCP Servers

Manage Claudian-owned MCP servers stored in `.claude/mcp.json`. Each row supports enable/disable, edit, delete, and a test command. Servers with context-saving mode only activate when @-mentioned in chat.

### Claude Code Plugins

Discovers Claude Code plugins from `~/.claude/plugins`. Toggling a plugin updates `.claude/settings.json` (so the CLI also respects it) and triggers a session restart. Subagents that ship with a plugin are surfaced under the **Subagents** section automatically.

### Environment

| Setting | What it does | Default |
|---------|--------------|---------|
| **Custom variables** (Claude scope) | `KEY=VALUE` lines passed only to Claude. Intended for `ANTHROPIC_*`, `CLAUDE_CODE_USE_BEDROCK`, etc. | Empty |
| **Snippets** | Same shape as the general snippet manager, scoped to Claude. | Empty |

Custom-model overrides for Claude-scope custom models appear here automatically when the env vars declare them.

### Experimental

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable Chrome extension** | Allow Claude to drive Chrome via the `claude-in-chrome` extension. Requires session restart. | Off |
| **Enable bash mode (!)** | Lets `!` on an empty input line execute a shell command via Node `child_process`. Requires Node on `PATH`; the toggle reverts to off and shows a notice if Node is not found. | Off |

---

## Codex

Visible when Codex is enabled.

### Setup

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable Codex provider** | Mirror of the General → Providers toggle. Disabling here hides Codex models for new chats; existing Codex sessions are preserved. | Off |
| **Installation method** *(Windows only)* | **Native Windows** (run `codex.exe` directly) or **WSL** (launch the Linux CLI inside a WSL distro). Changes the CLI-path placeholder and validation. | Native Windows |
| **Codex CLI path** | Per-device path. Empty = auto-detect from `PATH`. In WSL mode it expects a Linux command or absolute Linux path; entering a Windows-style path is rejected. | Auto-detect |
| **WSL distro override** *(Windows only, WSL mode)* | Optional override of the WSL distro name. Empty infers from the workspace path or falls back to the default distro. | Empty |

### Safety

| Setting | What it does | Default |
|---------|--------------|---------|
| **Safe mode** | Sandbox mode used when the Safe toggle is active: **Workspace write** or **Read only**. | Workspace write |

### Models

| Setting | What it does | Default |
|---------|--------------|---------|
| **Custom models** | Append Codex model ids, one per line. `OPENAI_MODEL` still takes precedence. | Empty |
| **Reasoning summary** | Visibility of the reasoning trace in the thinking block: **Auto**, **Concise**, **Detailed**, or **Off**. Forced to **Off** for the Codex Spark model. | Detailed |

### Codex skills

Lists vault skills under `.codex/skills/` and `.agents/skills/`. Home-level skills are intentionally excluded.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Hidden Skills** | Skill names (no leading `$`) to hide from the Codex `$` dropdown, one per line. | Empty |

### Codex subagents

Manage vault subagents stored as `.codex/agents/*.toml`. Each TOML file defines one agent; the editor exposes name, description, model, tools, and prompt.

### MCP Servers

A read-only notice — Codex MCP is managed via the `codex mcp` CLI, not in Claudian. Servers configured there are picked up automatically.

### Environment

| Setting | What it does | Default |
|---------|--------------|---------|
| **Codex environment** | `KEY=VALUE` lines passed only to Codex. Intended for `OPENAI_*` and `CODEX_*`. PATH additions for Codex auto-detection belong in the shared scope, not here. | Empty |
| **Snippets** | Codex-scoped snippet manager. | Empty |

---

## Opencode

Visible when Opencode is enabled.

### Setup

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable OpenCode** | Launch `opencode acp` as a provider. | Off |
| **CLI path** | Per-device absolute path to the Opencode CLI. Empty = look up `opencode` on `PATH`. Validated on input. Changing the path recycles Opencode chat tabs. | Auto-detect |

### Models

| Setting | What it does | Default |
|---------|--------------|---------|
| **Visible models** | A picker showing every model Opencode has discovered, grouped by provider. Filter by free-text or by provider. Selected models appear in the chat picker; each entry has an **Alias** field for a custom selector label and a remove button. **Browse models** expands the full catalog. The current session's model stays pinned even if it is unchecked. **Clear all** removes every selection. | Empty (catalog appears auto-expanded) |

Discovery runs on first expansion of **Browse models**; if Opencode is offline or unsigned-in, a notice describes the failure and the list stays empty.

### Commands and skills

A read-only notice: Opencode auto-detects vault Claude slash commands and skills from `.claude/commands/`, `.claude/skills/`, `.codex/skills/`, and `.agents/skills/`. Manage those entries in the Claude or Codex tabs.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Hidden Commands and Skills** | Names (no leading `/`) to hide from the Opencode dropdown, one per line. | Empty |

### Subagents

Visible when an Opencode workspace is available. Manages subagents under `.opencode/agent/` (with legacy `.opencode/agents/` fallback). Saving a new entry creates a subagent-only file and refreshes the chat `@mention` menu.

### Environment

| Setting | What it does | Default |
|---------|--------------|---------|
| **Environment Variables** | Opencode-scoped `KEY=VALUE` lines. `OPENCODE_ENABLE_EXA=1` is included by default; remove it to disable Exa integration. | `OPENCODE_ENABLE_EXA=1` |
| **Snippets** | Opencode-scoped snippet manager. | Empty |

---

## Cursor

Visible when Cursor is enabled. Cross-link: [[cursor-model-families-and-modes]] for how families and modes show up in chat.

### Models

| Setting | What it does | Default |
|---------|--------------|---------|
| **Visible models** | Family-grouped picker over discovered Cursor models. `auto` is always available and excluded from the list. Toggle a family on to enable every member raw id; off removes them all. Search filter, **Select all**, and **Select none** buttons sit above the list. | Empty (only `auto`) |
| **Refresh models** | Runs `agent --list-models` against the configured CLI to repopulate the catalog. Shows a notice with the count, or asks you to run `cursor-agent login` if zero models came back. | — |
| **Cursor Agent CLI path (`<hostname>`)** | Per-device path to the `agent` binary, or empty to search `PATH`. Validated on input. | Auto-detect |

A warm discovery runs on first render to populate the list.

### Environment

| Setting | What it does | Default |
|---------|--------------|---------|
| **Cursor Agent environment** | Cursor-scoped `KEY=VALUE` lines, e.g. `CURSOR_API_KEY`. Cursor chats themselves live under `~/.cursor/chats/<workspace-hash>/<session-id>/`. | Empty |
| **Snippets** | Cursor-scoped snippet manager. | Empty |

---

## Diagnostics

Lives at the bottom of the **General** tab. Detail in [[configurable-logger]].

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable logging** | Turn the diagnostic logger on. Logs go to the developer console and an in-memory ring buffer. | Off |
| **Log level** | Minimum captured level: **Off**, **Error**, **Warn**, **Info**, or **Debug**. Debug is the most verbose. | Warn |
| **Diagnostic log buffer → Copy logs** | Copies the recent ring-buffer entries to the clipboard. | — |
| **Diagnostic log buffer → Clear logs** | Empties the ring buffer and shows a confirmation notice. | — |

---

## Where settings are stored

All paths are relative to your vault root unless noted.

| Path | Owner | Contents |
|------|-------|----------|
| `.claudian/claudian-settings.json` | Claudian | Every setting on this page — general, agent board, and each provider's settings bag, plus `agentBoardConfig` for the lane editor. |
| `.claude/settings.json` | Claude Code CLI (shared with Claudian) | Permission rules and enabled Claude Code plugins. Claudian merges with the CLI's own writes. |
| `.claude/mcp.json` | Claudian-managed MCP for Claude | Servers in two namespaces — `mcpServers` (CLI-compatible) and `_claudian.servers` (Claudian metadata: enabled, contextSaving, disabledTools, description). |
| `.claude/commands/**/*.md` | Vault | Claude slash commands listed under **Claude → Commands and skills**. |
| `.claude/skills/*/SKILL.md` | Vault | Claude skills listed under the same section. |
| `.claude/agents/*.md` | Vault | Claude vault subagents. |
| `.codex/skills/*/SKILL.md`, `.agents/skills/*/SKILL.md` | Vault | Codex vault skills surfaced in **Codex → Codex skills**. |
| `.codex/agents/*.toml` | Vault | Codex subagents surfaced in **Codex → Codex subagents**. |
| `.opencode/agent/*`, `.opencode/agents/*` | Vault | Opencode subagents surfaced in **Opencode → Subagents**. |
| `~/.claude/settings.json` | Claude Code CLI (user-level) | Loaded into Claude when **Load user Claude settings** is on. |
| `~/.claude/plugins/**` | Claude Code CLI | Discovered as plugins in **Claude → Claude Code Plugins**. |
| `~/.cursor/cli-config.json` | Cursor Agent CLI | Touched by Cursor itself; Claudian serializes spawns against it. |
| `~/.cursor/chats/<workspace>/<session>/` | Cursor Agent CLI | JSONL transcripts hydrated by the Cursor adaptor. |
| `~/.claude/projects/<vault>/*.jsonl` | Claude Code CLI | Claude-native transcripts. |
| `~/.codex/sessions/**/*.jsonl` | Codex CLI | Codex-native transcripts. |
| `.claudian/sessions/*.meta.json` | Claudian | Provider-neutral session metadata. |

Settings are read and written only at `.claudian/claudian-settings.json`. There is no legacy file path; retired in-file fields are stripped on load (`DEPRECATED_SETTING_FIELDS`) rather than read from another location.
