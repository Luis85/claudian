---
status: partially-shipped
priority: 1 - high
relations:
  - "[[Multi Provider Support]]"
  - "[[unified-in-app-mcp-control-plane]]"
tags:
---
MCP shall be added so that every provider can access the same set of mcp per vault.

> **Status (2026-06-07): partially shipped.** Claude ships in-app MCP management plus `.claude/mcp.json` storage; Opencode ships Opencode-managed MCP through its native config (per project `CLAUDE.md` provider matrix). Codex and Cursor remain gated — they accept MCP via their own config files (`~/.codex/config.toml`, `.cursor/mcp.json`) but Claudian has no in-app management for either. Cross-provider parity is tracked by [[unified-in-app-mcp-control-plane]].
