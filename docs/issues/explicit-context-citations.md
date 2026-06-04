---
type: issue
id: issue-20260603-explicit-context-citations
title: Cite explicitly attached context (ContextSourceHandle) in agent answers — Phase A, no embeddings
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (UX-C)"
related:
  - "[[docs/issues/composer-context-pre-send-preview.md]]"
scope: citations
tags:
  - ux
  - citations
  - trust
---

# Explicit-context citations (Phase A)

## Problem

There is **zero citation rendering**. Agent answers never cite which note/selection/range grounded them;
`ContextSourceHandle` does not exist. Citations are "table stakes" in the Obsidian AI market; Claudian is
at parity-zero here.

## Evidence

- grep for citation/cite/source-handle/grounding returns only unrelated hits.

## Proposed change

Phase A only (no embeddings/RAG): emit `ContextSourceHandle` entries from the context envelope
(see `composer-context-pre-send-preview`) for explicitly attached files, selections, current note, folders,
and MCP resources, and render them as citations on grounded answers.

## Acceptance criteria

- A current-note answer can cite the note or selected range that grounded it.
- Citation fixture tests cover attached file / selection / current-note / MCP-resource cases.

## Out of scope

- Local keyword/metadata retrieval (Phase B) and embeddings (Phase C) — separate, later.
