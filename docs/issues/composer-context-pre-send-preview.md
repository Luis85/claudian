---
type: issue
id: issue-20260603-context-pre-send-preview
title: Pre-send "what will be sent" context preview + attached-vs-workspace disclosure (ComposerContextBuilder)
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (UX-B)"
related:
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
  - "[[docs/issues/explicit-context-citations.md]]"
scope: composer-context
tags:
  - ux
  - context
  - trust
---

# Pre-send context preview + ComposerContextBuilder

## Problem

There is no pre-send "what will be sent" preview. The "Attached context" card renders *after* send;
composer pills show basenames only — **no token estimate, no folder file-count, no large-folder warning,
no excluded/private indicator**. A privacy-sensitive user cannot see what leaves the vault before it
leaves. Context is also assembled imperatively across `InputController`, file-context state/view, selection
controllers, and the provider prompt encoders — there is no normalized envelope.

## Evidence

- `src/features/chat/ui/file-context/FileChipsView.ts`, `MessageContextCard.ts` (basename-only, post-send).
- No `ComposerContextBuilder` / context-envelope module exists.

## Proposed change

Introduce a normalized `ComposerContextBuilder` envelope (producing context items, not provider prompt
strings — provider encoders stay) and a pre-send preview drawer showing token estimate, folder file-count,
and large-folder/excluded/private warnings. Add a separate "agent workspace access" disclosure clarifying
that tools may read the whole vault + external paths regardless of what is attached.

## Acceptance criteria

- The composer can show exactly which context is attached to the next message, before send.
- The UI separately explains broader workspace/tool access.
- Golden unit tests for the builder cover current-note, file, folder, selection, image, MCP, and external-path cases.
