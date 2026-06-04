---
type: issue
id: issue-20260603-deferred-view-load-time
title: Confirm chat view defers (isDeferred/loadIfDeferred) and no child process spawns at load
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (OBS-D)"
scope: obsidian-compliance
tags:
  - obsidian-compliance
  - performance
  - load-time
---

# Deferred-view / load-time confirmation

## Problem

Obsidian's load-time guidance flags eager heavy work at startup. OBS-1 moved heavy `onload` work into
`app.workspace.onLayoutReady`, but this issue is the explicit confirmation that the chat sidebar view
**defers** (honors `WorkspaceLeaf.isDeferred` / calls `loadIfDeferred()`) and that **no child process
spawns at load** — both are automated-review/startup-bloat flags.

## Proposed change

Verify the chat view's deferred-load behavior and that no provider subprocess is spawned during `onload`
or initial view mount; fix any eager spawn/IO.

## Acceptance criteria

- Chat view is deferred-load-safe; provider processes spawn only on first use, not at plugin/view load.
- Documented confirmation (or a guard test) of no load-time spawn.
