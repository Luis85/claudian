---
title: Files changed by the agent — clickable list above the composer
date: 2026-06-14
status: implemented
scope: features/chat
---

## Problem

When the agent creates or edits a file, the change happens silently in the
background. To see the result the user has to manually navigate to the file,
which interrupts the chat workflow.

## Goal

After the agent finishes writing a file, surface that file as a clickable chip
in a row directly above the chat textarea, tied to the chat tab. Clicking a chip
opens the file in Obsidian. On by default; an opt-out setting preserves the
previous silent behavior.

## Decisions (from brainstorming)

- **Default on** — the strip is passive and non-intrusive, so it ships enabled
  with a setting to turn it off, rather than hidden behind opt-in.
- **Clickable list only** — no auto-opening of files in tabs (would get noisy on
  multi-file turns).
- **Creates & edits, per conversation** — track Write/Edit/NotebookEdit and
  Codex `apply_patch`; dedupe repeats; mark created vs edited; ignore reads;
  deletions are not listed (the list is "files you can open"). The list is tied
  to the conversation and clears when you switch/start a different chat.

## Design

### Detection (provider-neutral)

All four providers normalize file mutations to the same canonical tool names
(`Write`, `Edit`, `NotebookEdit`, `apply_patch`) and reach a single seam:
`StreamController.applyRegularToolResult`. After a successful (non-error,
non-blocked) completion, `recordEditedFiles` extracts the changed path(s) via
`collectEditedPathsFromToolCall` (a pure helper), resolves each to an openable
vault path (`resolveOpenableVaultPath`), and appends it to per-tab state. The
created-vs-edited kind: `Edit`/`NotebookEdit` → edited; `Write` → created unless
its diff removed lines (overwrite) → edited; `apply_patch` markers map
`Add File` → created, `Update File` → edited.

### State (per tab, conversation-derived)

`ChatState.editedFiles` holds the list (most-recent first, deduped by path,
"created" sticky). It is:

- **appended live** during streaming (the detection seam above), and
- **rebuilt from the transcript** whenever a conversation loads
  (`ConversationController.restoreConversation` → `deriveEditedFilesFromMessages`),
  and **cleared** on new chat / conversation switch / rewind.

Deriving from the persisted transcript means the list survives tab switches and
Obsidian reloads for free, with no extra persistence plumbing, and always
reflects the active conversation.

### UI

A dedicated `claudian-edited-files-row` is the first child of the input wrapper,
above the existing context row (image/file-context chips), so agent **outputs**
read as visually distinct from user **inputs**. `EditedFilesView` renders a small
leading label plus one chip per file (created `file-plus` / edited `file-pen`
icon, basename, full path tooltip). The row self-manages visibility (hidden when
empty). Clicking a chip re-resolves the path (so a since-deleted file shows a
Notice) and opens it in a tab via `workspace.openLinkText`.

### Setting

`showAgentEditedFiles` (default `true`) in Settings → General → Display,
registered in both the settings registry and the legacy renderer (parity), with
localized copy in all 10 locales. When off, nothing is tracked or rendered.

## Scope guardrails (v1)

List-only (no auto-open); creates + edits only (no deletions); vault files only
(every chip opens); no per-chip dismiss; top-level tool calls only (subagent
edits not tracked).

## Tests

- `editedFiles` util: path/kind extraction across provider tool shapes; dedupe /
  order / sticky-created merge; transcript derivation (skips reads, running,
  errored, and unresolvable paths).
- `ChatState`: record / set / clear + callback semantics; reset clears.
- `EditedFilesView`: chip rendering, created/edited modifiers, empty-hides,
  click-to-open.
- `StreamController`: records a completed Write; skips when the setting is off,
  on errored edits, and for read-only tools.
- Settings registry parity (`generalPort`) and locale structural alignment.
