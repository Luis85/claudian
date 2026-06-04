---
type: issue
id: issue-20260603-yolo-label-rename
title: Replace user-facing "YOLO"/"Safe" permission labels with clearer terms
status: closed
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (UX-I)"
related:
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
scope: chat-ux
tags:
  - ux
  - labels
  - safety
  - wont-do
---

# Rename YOLO / Safe permission labels

## Problem

The chat permission toggle still ships user-facing "YOLO"/"Safe" labels — off-brand for the
non-developer audience the product targets, and flagged in the 2026-05-28 research proposal and Obsidian
review norms. (`src/providers/claude/ui/ClaudeChatUIConfig.ts` permission-mode labels; similar in other
providers' `*ChatUIConfig.ts`.)

## Proposed change

Rename the user-facing labels to clearer terms — **Review actions / Auto-approve workspace edits / Plan
first / Read-only** — while keeping the internal `yolo` value for compatibility. A one-time danger-mode
warning already gates the opt-in; keep it.

## Acceptance criteria

- No user-facing "YOLO"/"Safe" strings remain in the chat toggle; internal `yolo` value unchanged.
- i18n keys added for the new labels across locales (fallback to English allowed).
