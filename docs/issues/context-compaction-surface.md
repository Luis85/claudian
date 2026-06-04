---
type: issue
id: issue-20260603-compaction-surface
title: Surface context compaction (/compact Claude, /compress Cursor) + auto-compaction/token budget
status: open
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PN-9)"
scope: context-management
tags:
  - claude
  - cursor
  - compaction
---

# Context compaction surface

## Problem

Claude (`/compact`) and Cursor (`/compress`) both support context compaction, and Claude auto-compacts at a
token threshold (re-reading `CLAUDE.md` afterward). Claudian does not surface manual compaction or the
auto-compaction/token-budget state to the user.

Sources: platform.claude.com compaction cookbook; cursor.com/docs/cli/using [DOCS].

## Proposed change

- Allow sending `/compact` (Claude) / `/compress` (Cursor) from the composer.
- Render compaction events and surface the token budget alongside the existing context-usage meter.

## Acceptance criteria

- Manual compaction is invokable per supporting provider; compaction events are visible in the transcript.
