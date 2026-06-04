---
type: issue
id: issue-20260603-normalizepath-coverage
title: Ensure normalizePath() coverage on every user/agent-constructed vault path
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (OBS-C)"
scope: obsidian-compliance
tags:
  - obsidian-compliance
  - paths
---

# normalizePath() coverage

## Problem

Obsidian submission requirements explicitly flag missing `normalizePath()` on user/agent-constructed paths.
With agents writing vault files, every plugin-side vault path built from user/agent input should pass
through `normalizePath()`.

## Proposed change

Audit vault path construction (note writes, context attachment, work-order/ledger writes, MCP config paths)
and apply `normalizePath()` where missing.

## Acceptance criteria

- User/agent-constructed vault paths are normalized; an audit (or lint rule) documents coverage.
