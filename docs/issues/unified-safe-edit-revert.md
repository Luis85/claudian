---
type: issue
id: issue-20260603-unified-safe-edit-revert
title: Unify post-edit review/revert across all four providers (not Claude-only)
status: open
priority: 1 - high
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (UX-D, PN-5, PN-7)"
related:
  - "[[claude-lifecycle-hooks]]"
scope: edit-safety
tags:
  - ux
  - edit-safety
  - rewind
  - provider-parity
---

# Unified safe-edit / revert across providers

## Problem

Safe-edit/revert is fragmented and provider-skewed:

- Inline-edit has rich diff + accept/reject (all four providers).
- In-chat Write/Edit tool calls render a **display-only** diff — the file is already written, no per-edit
  undo (`WriteEditRenderer.ts`).
- Rewind-with-file-restore is **Claude-only** (`supportsRewind:false` for Codex/Opencode/Cursor,
  `MessageRenderer.ts:96`). So chat-initiated note edits via 3 of 4 providers have **no in-app revert**.

## Provider-uneven reality (file revert)

- **Claude:** real file-checkpoint primitive (verify it uses the official `enableFileCheckpointing` +
  `rewindFiles()` API — PN-7).
- **Codex:** app-server `thread/rollback` is **transcript-only** (drops N turns + a marker); it does NOT
  restore file edits. Surface it under a clearly transcript-only affordance, distinct from file rewind (PN-5).
- **Opencode:** git-snapshot `/undo` is **unsupported over ACP** (CLI/TUI only).
- **Cursor:** auto-checkpoints only; no documented CLI rewind.

## Proposed change

For non-Claude providers the durable answer is a **Claudian-owned pre-edit snapshot** (feasible because
edits flow through the tool stream), not a provider transcript-rollback dressed up as file revert. Build a
unified post-edit review/revert path; use Claude lifecycle hooks (`claude-lifecycle-hooks`) to snapshot
before edits where available.

## Acceptance criteria

- A chat-initiated note edit can be reviewed as a diff and reverted in-app for **all four** providers.
- Codex transcript rollback (if exposed) is labelled transcript-only and never wired into a file-rewind affordance.
