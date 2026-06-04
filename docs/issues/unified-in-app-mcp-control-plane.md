---
type: issue
id: issue-20260603-unified-mcp-control-plane
title: Unified in-app MCP control plane across all four providers (Codex, Cursor, Opencode in-app)
status: open
priority: 1 - high
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PN-1, PN-2, D3 / matrix correction)"
related:
  - "[[remote-mcp-ssrf-blocking-guard]]"
scope: mcp-parity
tags:
  - mcp
  - provider-parity
  - differentiator
---

# Unified in-app MCP control plane

## Problem

Only **Claude** exposes in-app MCP management today: `supportsMcpTools: true` for Claude, but `false` for
Codex, Cursor, and Opencode (`src/providers/opencode/capabilities.ts:13` etc.), and the in-app MCP selector
is gated on that flag at `src/features/chat/tabs/tabShared.ts:189-197`. So Opencode runs MCP via its own
Opencode-managed config but has **no in-app management surface**; Codex and Cursor have none either. Rivals
punt MCP to each CLI — a single unified control plane is a concrete differentiator.

## Per-provider work

- **Codex (PN-1):** the `codex app-server` already exposes MCP server status, resource reading, and OAuth
  login flows; `[mcp_servers.*]` config. Wire a Codex MCP management surface to Claude parity.
  (developers.openai.com/codex/app-server + /mcp)
- **Cursor (PN-2):** the CLI auto-detects `.cursor/mcp.json`; `agent mcp list/list-tools`, `--approve-mcps`,
  in-session `/mcp`. Surface and manage these. (cursor.com/docs/cli/mcp)
- **Opencode (in-app):** `supportsMcpTools` is `false` and no in-app surface exists — add an in-app
  management path so "unified across all four" is real, not just Codex/Cursor.

## Acceptance criteria

- Each non-Claude provider has an in-app MCP management surface (list/status/enable, OAuth where supported).
- "Unified MCP control plane across all four" is true at ship — not claimed while a provider is still
  runtime-only/unmanaged.
- Human-in-the-loop, un-bypassable tool approval with remembered per-server/per-tool scopes; tool
  annotations treated as untrusted.

## Related

SSRF/transport hygiene for remote MCP is tracked in `remote-mcp-ssrf-blocking-guard`.
