---
type: issue
id: issue-20260603-cursor-subagents
title: Ungate Cursor subagents (first-class in Cursor 2.4)
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PN-3)"
scope: cursor-capability
tags:
  - cursor
  - subagents
  - provider-parity
---

# Cursor subagents

## Problem

Cursor subagents are **gated** in Claudian, but Cursor 2.4 (Jan 2026) made them first-class in the CLI:
parallel, isolated context, custom prompts/tools/models, plus built-in research/terminal/parallel
subagents. This is a capability gap vs the provider's current surface.

Source: cursor.com/changelog/2-4 [DOCS].

## Proposed change

Map Cursor 2.4 subagent events in `cursorStreamMapper`, support subagent definitions under `.cursor/`, and
ungate the subagent surface for Cursor.

## Acceptance criteria

- Cursor subagents are discoverable and runnable from Claudian (parity with the other providers' subagent UX).
- Subagent stream/tool events normalize correctly through `cursorToolNormalization`.
- Verified against the `cursor-agent` CLI 2.4+.
