---
type: tech-debt
title: "Provider-native capability parity remains uneven"
date: 2026-06-07
updated: 2026-06-07
status: open
priority: "2 - normal"
severity: medium
scope: provider-parity
tags:
  - tech-debt
  - provider-parity
  - mcp
  - cursor
  - codex
related:
  - "[[unified-in-app-mcp-control-plane]]"
  - "[[cursor-subagents]]"
  - "[[context-compaction-surface]]"
  - "[[claude-lifecycle-hooks]]"
  - "[[unified-safe-edit-revert]]"
---

# Provider-native capability parity remains uneven

## Summary

Claudian is architected as a multi-provider product, but some provider-native surfaces are still uneven or gated. The codebase already models capabilities, yet user-visible parity is not complete across Claude, Codex, Opencode, and Cursor.

## Evidence

- Root `CLAUDE.md` documents that Claude is full-featured while Codex, Opencode, and Cursor have gated or unsupported surfaces.
- In-app MCP management is still Claude-only or incomplete by capability flags; [[unified-in-app-mcp-control-plane]] tracks the unified control-plane work.
- Cursor subagents are still tracked separately in [[cursor-subagents]].
- Manual context compaction / token-budget surfaces are tracked in [[context-compaction-surface]].
- Safe edit/revert is provider-skewed; [[unified-safe-edit-revert]] tracks the cross-provider path.
- Claude lifecycle hooks are tracked in [[claude-lifecycle-hooks]] and would feed audit/evidence/revert flows.

## Why it matters

Provider breadth is a product promise only if each provider gets a deep enough adapter. Otherwise users must remember a provider-specific matrix of missing controls, and feature code accumulates conditional gaps. The current capability registry helps avoid provider-id branches, but parity debt remains at the product seam.

## Suggested remediation

1. Keep capability flags honest and user-visible; never imply parity from provider roster alone.
2. Prioritize provider-native surfaces that strengthen trust and supervision: MCP management, subagents, lifecycle hooks, compaction, and edit revert.
3. Add provider capability tests that assert both the flag and the visible UI behavior.
4. Use the registry/workspace seams rather than importing provider internals into features.

## Acceptance criteria

- [ ] The provider matrix in docs and UI matches actual capability flags.
- [ ] Non-Claude providers expose in-app MCP management or clearly explain why not.
- [ ] Cursor subagents are either implemented or visibly gated with a roadmap note.
- [ ] Cross-provider edit/revert uses a common Claudian-owned snapshot path where provider-native rewind is absent.
