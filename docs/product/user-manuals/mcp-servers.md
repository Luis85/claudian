---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Multi Provider Support]]"
---
# Claudian — MCP Servers

This manual covers Model Context Protocol (MCP) servers in Claudian: what they are, how to add them per provider, how to work with them in chat, and where the configuration lives on disk.

MCP servers extend a provider with additional tools (file search, GitHub APIs, browser drivers, vendor SDKs, vault graph queries, etc.). Once a server is connected and enabled, its tools become callable by the agent during a conversation.

---

## Quick reference — which provider manages MCP where

| Provider | In-app management | Where servers are configured |
|----------|-------------------|------------------------------|
| **Claude** | Full UI in **Settings → Claude → MCP Servers** | `.claude/mcp.json` (Claudian-owned, CLI-compatible) |
| **Codex** | Read-only notice only | Via the `codex mcp` CLI; Claudian picks up what Codex already knows about |
| **Opencode** | Managed by the Opencode CLI | Opencode owns its MCP wiring; Claudian launches `opencode acp` and inherits the server set |
| **Cursor** | Not exposed | Cursor Agent CLI manages its own integrations |

If you want a server visible to **all four providers**, you must register it in each provider's own configuration. Claudian does not bridge tools across providers.

See [[settings]] for the full settings panel layout, [[install-claude]], [[install-codex]], [[install-opencode]], and [[install-cursor]] for CLI installation steps.

---

## MCP transports

Claudian supports the three MCP transports defined by the protocol:

| Type | When to use | Required fields |
|------|-------------|-----------------|
| **stdio** | Local command-line program (npm/uvx/docker/python binary running on your machine). Default and most common. | `command`, optional `args`, optional `env` |
| **http** | Remote HTTP endpoint (Streamable HTTP transport). Most modern hosted MCP servers. | `url`, optional `headers` |
| **sse** | Legacy Server-Sent Events endpoint. Use only if a server explicitly requires SSE. | `url`, optional `headers` |

A configuration without an explicit `type` field is treated as `stdio` when it has a `command`, and as `http` when it has a `url`.

---

## Adding MCP servers to Claude

This is the main flow most users care about. The Claude provider exposes the full add/edit/test/delete UI.

### Prerequisites

1. Claude provider enabled in **Settings → Claudian → General → Providers**. See [[install-claude]].
2. The Claude tab visible in the settings panel.

### Open the MCP section

**Settings → Claude → MCP Servers**.

If no servers are configured yet, you will see *"No mcp servers configured. Click 'add' to add one."* and a `+` button in the header.

### Add via the modal

Click `+` next to **MCP Servers**. A dropdown appears with three options:

| Option | What it does |
|--------|--------------|
| **stdio (local command)** | Opens the add modal preset to stdio. |
| **http / sse (remote)** | Opens the add modal preset to http (you can switch to sse inside). |
| **Import from clipboard** | Reads JSON from the clipboard and either opens the modal pre-filled or imports multiple servers in bulk. |

The modal asks for:

| Field | Notes |
|-------|-------|
| **Server name** | Unique identifier. Allowed characters: letters, numbers, dots, hyphens, underscores (regex `^[a-zA-Z0-9._-]+$`). The name is what you will `@`-mention in chat (see *Context-saving mode* below). |
| **Type** | `stdio`, `sse`, or `http`. Changing this re-renders the field block below. |
| **Command** *(stdio)* | Full command with arguments on one line, e.g. `npx -y @modelcontextprotocol/server-filesystem /path/to/dir`. Claudian splits the first token as the command and the rest as args, with quote handling. |
| **Environment variables** *(stdio)* | `KEY=VALUE` per line. Lines starting with `#` and empty lines are ignored. |
| **URL** *(http/sse)* | The remote endpoint, e.g. `https://mcp.example.com/sse`. |
| **Headers** *(http/sse)* | `KEY=VALUE` per line. Typically used for `Authorization=Bearer …`. |
| **Enabled** | Toggle. New servers default to enabled. |
| **Context-saving mode** | Toggle. New servers default to context-saving on. See *Context-saving mode* below. |

Press **Add** (or **Update** when editing). The list refreshes immediately and a notice confirms the save.

### Add via clipboard import

Copy any of these JSON shapes to your clipboard, then click `+` → **Import from clipboard**:

1. Full Claude Code format (recommended):

   ```json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
       },
       "github": {
         "type": "http",
         "url": "https://api.githubcopilot.com/mcp",
         "headers": { "Authorization": "Bearer ghp_…" }
       }
     }
   }
   ```

2. Single named server, no `mcpServers` wrapper:

   ```json
   { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] } }
   ```

3. Single server config without a name (Claudian prompts you for one):

   ```json
   { "command": "uvx", "args": ["mcp-server-time"] }
   ```

4. Multiple named servers, no wrapper — same as format 1 but flat.

When one server is on the clipboard, the add modal opens pre-filled. When multiple servers are detected, Claudian imports them in bulk; invalid names are skipped and the notice tells you how many were added vs skipped.

### Edit, enable/disable, delete

Each row exposes four icon buttons on the right:

| Icon | Action |
|------|--------|
| ⚡ **Verify** | Opens the test modal. See *Verifying a server* below. |
| 🔁 **Toggle** | Enables or disables the server. Disabled servers stay in the config but are not loaded by the runtime. |
| ✏️ **Edit** | Reopens the add modal with the existing values. |
| 🗑️ **Delete** | Asks for confirmation, then removes the server from `.claude/mcp.json`. |

Any save, toggle, or delete writes `.claude/mcp.json` and tells the Claude runtime to reload its MCP servers without restarting the whole CLI session.

---

## Verifying a server

Click the ⚡ icon on a server row. Claudian opens a modal labelled **Verify: `<name>`** that:

1. Spawns the server (stdio) or opens a transport connection (http/sse), with a 10-second timeout.
2. Calls the MCP `tools/list` endpoint and renders each tool as a row.
3. Shows the server's reported name and version when available.

Each tool row has a toggle. Switching a tool off writes the tool name into the server's `disabledTools` list and tells the runtime to add it to its disallowed-tools set; the agent will no longer be able to call it. The **Disable all / Enable All** button bulk-applies the same operation.

Tools that fail to enumerate (e.g. servers that don't implement `tools/list`) show *"No tools information available. Tools will be loaded when used in chat."* — the server is still usable, you just can't pre-toggle its tools from the modal.

### Common verification errors

| Symptom | Likely cause |
|---------|--------------|
| `Connection timeout (10s)` | stdio command never returned, or the URL is unreachable / behind a firewall. |
| `spawn ENOENT` | The command in your config is not on `PATH`. Use an absolute path or set `PATH` in the shared environment (see [[settings]] → Environment). |
| `401 / 403` | Missing or wrong `Authorization` header for an http/sse server. |
| `Permission denied. Check .claude/ folder permissions.` | Claudian could not write `.claude/mcp.json`. Check vault filesystem permissions. |
| `Config file corrupted. Check .claude/mcp.json` | The JSON file was edited by hand and is no longer parseable. |

---

## Context-saving mode

Each server has a **Context-saving mode** toggle. It controls whether the server's tools are advertised to the agent on every turn.

| Mode | What the agent sees |
|------|--------------------|
| **Off** | Every tool from every enabled server is advertised on every turn. Larger context, no friction. |
| **On** (default for new servers) | The server's tools are hidden until you `@`-mention the server in the message, e.g. `@github please open a PR for this`. The `@` token only matches against enabled context-saving servers. |

A small **@** badge appears next to context-saving servers in the list. The badge tooltip reminds you of the mention syntax.

How the mention is detected:

- Matches `@<name>` where `<name>` belongs to an enabled context-saving server.
- Does not match if followed by `/` (that's the context-folder syntax) or by another alphanumeric/underscore/dash (avoids partial matches like `@github-actions` against `@github`).
- Detection runs on the prompt text only; you do not see it in the rendered message.

When Claudian forwards the prompt to the Claude SDK, every matched `@server` is rewritten to `@server MCP` so the model treats it as a tool-route hint. The original input shown in the UI is untouched.

The same `@` mention also matches for the alias purpose of the `extractMentions` filter — meaning the server's tools become visible to that single turn, and the disabled-tool list of every other context-saving server is still enforced.

---

## How storage works on disk

For Claude, MCP servers live at `.claude/mcp.json` relative to the vault root. The file has two top-level keys that Claudian manages together:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  },
  "_claudian": {
    "servers": {
      "filesystem": {
        "enabled": true,
        "contextSaving": false,
        "disabledTools": ["delete_file"],
        "description": "Read/write a project directory"
      }
    }
  }
}
```

| Namespace | Owner | Purpose |
|-----------|-------|---------|
| `mcpServers` | Claude Code CLI compatible | Read by the Claude CLI directly when it spawns. |
| `_claudian.servers` | Claudian only | Stores `enabled`, `contextSaving`, `disabledTools`, and optional `description`. The Claude CLI ignores this key. |

This split exists so Claudian metadata does not pollute the CLI-compatible format, and so a hand-edited `.claude/mcp.json` can still drive both Claudian and the Claude CLI without reconciliation steps.

### Security model (default-untrusted)

A vault MCP server is enabled **only when** its `_claudian.servers.<name>` metadata explicitly sets `enabled: true`. Anything else — missing metadata, empty metadata, or `enabled: false` — is treated as untrusted and is loaded **disabled**. Opening a vault you don't fully trust will not silently auto-spawn MCP processes.

The first time you upgrade a vault that already had servers under `mcpServers`, a one-time grandfather migration writes `enabled: true` for every pre-existing server so your existing setup is preserved. After that, new servers synced into the vault from elsewhere must be enabled explicitly.

stdio servers are spawned with a **curated environment** — system essentials plus an enhanced `PATH` plus the server's own configured `env` — instead of the host's full `process.env`. This keeps unrelated cloud credentials, API tokens, and host secrets out of every stdio MCP spawn. SSE/HTTP servers have no child env.

---

## Using MCP tools in chat

Once enabled, MCP tools appear inside the agent's tool catalog. You don't pick tools manually — the agent decides when to call them based on the task.

What you can do from the composer:

- **Just ask**: e.g. *"List the open PRs in this repo"* with a GitHub MCP server enabled (non context-saving) is enough; the agent will pick the tool.
- **Mention a context-saving server**: `@github list the open PRs` activates the `github` server's tools for that turn only.
- **Combine with skills, plans, and subagents**: MCP tools are visible to subagents that inherit your toolset. Servers with `contextSaving: true` are still gated by the `@` mention on the parent turn.

When the agent invokes a tool, it shows up in the conversation transcript as a tool call, with the tool name prefixed by `mcp__<server-name>__` (e.g. `mcp__github__list_pull_requests`). The result block is the tool's raw response, formatted by the chat view.

---

## Adding MCP servers to other providers

### Codex

Claudian's Codex tab shows a read-only notice in the MCP section: *MCP for Codex is managed by the `codex mcp` CLI, not in Claudian.* To add a server:

```bash
codex mcp add <name> -- <command> [args...]
codex mcp list
```

Refer to the Codex CLI's own documentation for the full subcommand surface. Once registered there, Codex picks the server up on its next session start; Claudian launches `codex app-server` and inherits whatever MCP set Codex resolved.

### Opencode

Opencode manages MCP servers itself. Claudian's Opencode tab does not expose an MCP UI — the Opencode CLI's config (typically `~/.opencode/`) is the source of truth. Configure the server with the Opencode CLI, then enable the Opencode provider in **Settings → Claudian → General → Providers**.

When Opencode spawns the ACP server, its MCP catalog is announced to Claudian via the protocol's session events and surfaces in chat the same way Claude's tools do — but the lifecycle is owned by Opencode.

### Cursor

Cursor MCP support is not surfaced in Claudian. The Cursor Agent CLI handles its own integrations. See Cursor's product documentation for MCP configuration; once configured there, Cursor sessions launched from Claudian inherit it.

---

## Reference

| Path / location | Notes |
|-----------------|-------|
| `.claude/mcp.json` | Claudian-managed MCP config for Claude (dual namespace). |
| **Settings → Claude → MCP Servers** | Add, edit, enable/disable, verify, delete servers. |
| **Settings → Claudian → General → Environment** | Shared `PATH` entries usable by every provider's stdio MCP. |
| **Settings → Claude → Environment** | Claude-scoped env vars; available to stdio MCP servers as part of the curated env. |
| **Settings → Codex → MCP Servers** | Read-only notice pointing at the `codex mcp` CLI. |

For deeper architecture notes (event flow, manager API, storage adapter), see `src/core/mcp/` and `src/providers/claude/storage/McpStorage.ts`.
