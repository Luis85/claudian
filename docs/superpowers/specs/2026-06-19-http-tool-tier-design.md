---
type: design
title: "Cross-Provider User Tools via an In-Process Local HTTP MCP Server"
date: 2026-06-19
status: draft
scope: agents
related:
  - "[[docs/superpowers/specs/2026-06-19-tool-and-skill-library-design]]"
  - "[[docs/research/2026-06-19-user-tools-and-mcp-transport]]"
  - "[[docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups]]"
---

# Cross-Provider User Tools via an In-Process Local HTTP MCP Server

## Decision (supersedes the stdio tier in the tool/skill spec)

The tool/skill spec proposed a **stdio** subprocess to expose user tools to
Codex/Cursor/Opencode. That subprocess cannot access the Obsidian app/vault, so
the manifest+handler tools (whose `ctx.app` is the Obsidian API) would not work
cross-provider. **User-confirmed replacement:** the plugin hosts **one
in-process local Streamable-HTTP MCP server** (`@modelcontextprotocol/sdk`) bound
to `127.0.0.1`; handlers run in the plugin with **full Obsidian context** —
identical to the Claude in-process tier (one tool implementation, no capability
split). Providers connect via an `http` MCP server config pointing at
`http://127.0.0.1:<port>/mcp`. Claude keeps its in-process SDK tier unchanged.

## Scope (this increment)

- **(A) HTTP MCP server infra** — net-new, provider-neutral.
- **(B) Opencode wiring** — the only non-Claude provider with a clean pre-spawn
  config writer (`prepareOpencodeLaunchArtifacts` → `.claudian/opencode/config.json`
  via `OPENCODE_CONFIG`).
- **Deferred (follow-ups):** Cursor (needs a net-new `~/.cursor/mcp.json` writer
  + pre-spawn hook) and Codex (its `app-server` MCP integration path is
  uncertain and needs runtime investigation). Documented in tech-debt.

## A. HTTP MCP server infra

New `src/features/tools/host/ClaudianHttpToolServer.ts`:
- Builds an `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`) and
  `registerTool(name, { description, inputSchema: zodRawShape }, handler)` for
  each error-free `LoadedTool` from `ClaudianToolRegistry` — the SAME tools as the
  Claude tier, handlers invoked with the full `ToolHostContext` (`{ app, signal }`).
- Connects it to a `StreamableHTTPServerTransport`
  (`@modelcontextprotocol/sdk/server/streamableHttp.js`) and a Node
  `http.createServer` that routes `POST/GET /mcp` to `transport.handleRequest`.
- `listen(0, '127.0.0.1')` → OS-assigned free port; expose
  `url = http://127.0.0.1:<port>/mcp`.
- **Security:** loopback-only bind; a per-process **bearer token** generated at
  start (`crypto.randomUUID()`); the transport/handler rejects requests whose
  `Authorization` header doesn't match. The token is passed to providers via the
  MCP config `headers`. (Loopback is allowed by `mcpRuntimeVetting`, but the
  token defends against other local processes.)
- **Lifecycle (`main.ts`):** start in `onload` after `toolRegistry.load()`;
  `onunload` closes the http server + transport. Rebuild the tool set on
  `toolLibrary:changed` (close+recreate the `McpServer`/transport, or
  re-register tools) — runs happen between turns, so a rebuild is safe.
- **Lazy/guarded:** if no tools are loaded, still run the server (empty tool set)
  or skip until first tool — MVP: start always, serve current tools.

Plugin exposes `getHttpToolServerConfig(): { url: string; headers: Record<string,string> } | null`
(core-typed, no features import — mirrors `getClaudianToolServer`) returning the
url + auth header, or null when unavailable.

## B. Opencode wiring

In `OpencodeLaunchArtifacts.buildOpencodeManagedConfig` / `prepareOpencodeLaunchArtifacts`
(pre-spawn), add an `mcp` entry to the managed `opencode.json` when a tool-server
config is available:
```jsonc
"mcp": {
  "claudian": { "type": "remote", "url": "http://127.0.0.1:<port>/mcp",
                "headers": { "Authorization": "Bearer <token>" }, "enabled": true }
}
```
The launch path already writes the config before spawn and points the CLI at it
via `OPENCODE_CONFIG`, so the URL+port (known at plugin load) is current. Thread
the plugin's `getHttpToolServerConfig()` into the Opencode launch-artifacts
builder (as data — keep providers free of features imports).

## Testing

- Unit: the tool→`registerTool` mapping (mock the mcp sdk like the Claude-tier
  test); the Opencode config builder emits the `mcp.claudian` remote entry when a
  server config is supplied and omits it when null.
- Manual: start Opencode, confirm `mcp__claudian__<tool>` is callable and returns
  the handler output (full Obsidian context).

## Gotchas
- StreamableHTTP is session-stateful; rebuild between runs only.
- The mcp-sdk `McpServer` is a different package from the Claude SDK's
  `createSdkMcpServer` — both consume the same Zod shapes + return
  `CallToolResult`, so the registry is the shared source.
- Keep `providers/` and `core/` free of `features/` imports (pass server config
  as plain data).
- Port changes each plugin load → config is rewritten pre-spawn (already the
  Opencode pattern).

## Out of scope
Cursor + Codex wiring; persistent cross-session server identity; remote (non-
loopback) exposure; per-tool auth scopes.
