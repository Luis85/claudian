---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Multi Provider Support]]"
---
# Claudian — Multi-provider setup

This manual covers running more than one AI provider inside the same Specorator workspace. Each provider keeps its own settings, models, commands, and session storage. A chat tab belongs to the provider you opened it with until you close it.

For the feature pitch and capability matrix see [[Multi Provider Support]]. For provider-specific install steps see [[install-claude]], [[install-codex]], [[install-cursor]], [[install-opencode]].

---

## Before you start

You need at least one provider's CLI installed and reachable. Specorator does not bundle CLIs — it drives the ones already on your machine.

| Provider | Runtime | Install guide |
|----------|---------|---------------|
| **Claude** | Claude Code CLI | [[install-claude]] |
| **Codex** | Codex CLI (native Windows or WSL) | [[install-codex]] |
| **Opencode** | Opencode CLI (`opencode acp`) | [[install-opencode]] |
| **Cursor** | Cursor Agent CLI (`cursor-agent`) | [[install-cursor]] |

You can enable any subset — one, several, or all four. Disabled providers stay invisible until you toggle them on.

---

## Enabling providers

Open **Settings → Specorator → General → Providers** and toggle the providers you want active.

| Toggle | Effect |
|--------|--------|
| **Enable Claude** | Shows Claude in the chat provider list and reveals the Claude tab. |
| **Enable Codex** | Same, for Codex. |
| **Enable Opencode** | Same, for Opencode. |
| **Enable Cursor** | Same, for Cursor. |

Toggling **off** hides the provider tab and removes its models from the chat selector, but does not delete saved sessions. Toggling **on** later restores the tab with your previous settings.

After enabling a provider, point Specorator at its CLI in the provider's own tab (e.g. **Settings → Claude → Claude CLI path**). Empty = auto-detect from `PATH`.

---

## Provider capability snapshot

Each provider exposes a different feature surface. The full table lives in [[Multi Provider Support]]; the highlights:

| Capability | Claude | Codex | Opencode | Cursor |
|------------|--------|-------|----------|--------|
| Send, stream, stop | Full | Full | Full | Full |
| Fork a conversation | Full | Full | — | — |
| Plan mode | Full | Full | Mode runs, no approval card | Full |
| `/` slash commands | Full | — | Runtime-discovered | — |
| `$` skills | Full | Full | — | — |
| Subagents | Full | Full | Full | — |
| In-app MCP management | Full | — | Provider-managed | — |
| Rewind | Full | — | — | — |
| Claude plugin integration | Full | — | — | — |

Check the row you care about before you commit to a provider for a given job. Claude is the full-feature reference. Codex covers most of the same ground but no rewind, in-app MCP, or plugins. Opencode owns its own external-tool wiring. Cursor focuses on chat plus inline edits.

---

## Switching between providers

You cannot change a tab's provider mid-conversation. The model is per-tab, the provider is per-tab.

- **Open a chat on a different provider** — click the provider name in the chat tab header (or open **Specorator: New Tab** and pick).
- **Run several providers in parallel** — open one chat tab per provider. They run side by side; the tab cap is **Settings → General → Display → Maximum chat tabs** (default 3, up to 10).
- **Compare answers** — fire the same Quick Action into two tabs on different providers. See [[quick-actions]].

---

## Per-provider settings

Each provider has its own tab in **Settings → Specorator**. The tab is hidden when the provider is disabled.

| Tab | When visible | What it covers |
|-----|--------------|----------------|
| **Claude** | Claude enabled | CLI path, safety, models, slash commands, subagents, MCP servers, Claude Code plugins, environment, experimental flags. |
| **Codex** | Codex enabled | CLI path (Windows: native vs WSL), safety, models, skills, subagents, MCP notice (managed by `codex mcp`), environment. |
| **Opencode** | Opencode enabled | CLI path, visible-model picker, hidden commands, subagents, environment. |
| **Cursor** | Cursor enabled | CLI path, visible-model picker, model refresh, environment. |

Shared knobs (language, quick actions folder, display, hotkeys, shared environment, diagnostics) live in **General**. See [[settings]] for the full panel layout.

---

## Sessions stay neutral

Conversations are saved as Specorator session files under `.specorator/sessions/` regardless of which provider ran them. You can resume a session even after disabling the provider that created it — re-enable, point at the CLI, and the session reloads.

Provider-native transcripts (`~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor/chats/`) stay where the provider writes them. Specorator hydrates from these when you reload a session; the session metadata lives in `.specorator/sessions/`.

---

## MCP servers across providers

MCP is configured per provider, not globally. To make a server visible everywhere, register it in each provider's own config. See [[mcp-servers]] for the per-provider matrix:

- **Claude** — managed in **Settings → Claude → MCP Servers** (writes `.claude/mcp.json`).
- **Codex** — managed by the `codex mcp` CLI, surfaced read-only in Claudian.
- **Opencode** — managed by the Opencode CLI; Opencode announces its catalog over ACP.
- **Cursor** — managed by the Cursor Agent CLI itself.

---

## Reference

| Path / location | Notes |
|-----------------|-------|
| `.specorator/sessions/*.meta.json` | Provider-neutral session metadata. |
| `.claudian/claudian-settings.json` | All Specorator settings, including per-provider config bags. |
| **Settings → Specorator → General → Providers** | Master enable toggles. |
| **Settings → Specorator → <Provider>** | Provider-specific CLI path, models, MCP, environment. |
| [[install-claude]] / [[install-codex]] / [[install-cursor]] / [[install-opencode]] | CLI install steps per provider. |
| [[Multi Provider Support]] | Feature pitch and full capability matrix. |
