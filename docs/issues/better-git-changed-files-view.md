---
type: issue
id: issue-20260603-git-changed-files-view
title: Add a lightweight changed-files view to the Git integration
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (backlog); [[docs/ideas/Better Git integration.md]]"
scope: git-integration
tags:
  - git
  - ux
  - quality-of-life
---

# Better Git integration — changed-files view

## Problem

The Git integration today is only a commit/push button plus a status watcher — there is **no dedicated
changed-files view** (`GitActionButton.ts`, `GitService.ts`, `GitStatusWatcher.ts`; no file-list UI). A
lightweight view of what the agent changed is high daily quality-of-life and saves tokens (the user can
review changes without asking the agent to enumerate them).

## Proposed change

Add a compact changed-files view (staged/unstaged, click-to-open/diff) backed by the existing
`GitService`/`GitStatusWatcher`. Keep it lightweight — not a full Git client.

## Acceptance criteria

- A changed-files list is visible, reflects the working tree, and lets the user open/diff each file.
- Backed by existing Git services; no heavy new dependency.

## Related

Tracks the existing idea doc `Better Git integration.md`.
