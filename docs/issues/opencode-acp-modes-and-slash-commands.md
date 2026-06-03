---
type: issue
id: issue-20260603-opencode-acp-modes-slash
title: Opencode — adopt ACP session modes (ungate plan mode) and runtime-discovered slash commands
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PN-4, PN-8)"
scope: opencode-capability
tags:
  - opencode
  - acp
  - plan-mode
  - slash-commands
---

# Opencode: ACP modes + slash commands

## Problem

Two ACP capabilities the Opencode adaptor does not yet use:

- **Plan mode (PN-4):** Opencode's Plan is a native restricted primary agent (edits/bash set to `ask`),
  switchable via ACP `session/set_mode` + `current_mode_update`. It is currently **gated** in Claudian.
- **Slash commands (PN-8):** ACP `available_commands_update` provides runtime-discovered `/commands`,
  which Claudian's Opencode adaptor does not surface.

Sources: opencode.ai/docs/agents, agentclientprotocol.com [DOCS].

## Proposed change

- Wire ACP `session/set_mode` + `current_mode_update` to ungate Opencode plan mode (switch to the built-in
  Plan agent).
- Handle the `available_commands_update` notification in `src/providers/acp/` and render runtime-discovered
  `/commands` in the command catalog.

## Acceptance criteria

- Opencode plan mode is selectable and behaves as the restricted Plan agent.
- Runtime-discovered Opencode slash commands appear in the command catalog and invoke correctly.

## Note

ACP has **no rewind primitive** — Opencode `/undo` is unsupported over ACP (CLI/TUI only); rewind is out of
scope here (see `unified-safe-edit-revert`).
