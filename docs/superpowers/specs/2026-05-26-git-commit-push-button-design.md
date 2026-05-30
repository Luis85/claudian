---
status: approved
---
# Git commit & push button — design

**Date:** 2026-05-26
**Status:** Approved design, pending implementation plan

## Summary

Add a git-aware action to the chat panel. When the vault sits inside a git repo and there are uncommitted changes, a git icon button appears in the chat input toolbar showing the number of changed files. Clicking it injects a prompt that asks the current chat agent to stage the changes, write a Conventional-Commits message reflecting the actual diff, commit, and push to the upstream remote. The agent performs all git work through its own shell tool; the plugin only detects repo state and surfaces the button.

## Goals

- Detect whether the vault is inside a git repository.
- Detect whether the repo has uncommitted changes, and how many files changed.
- Show a toolbar button only when: repo present AND dirty AND the active provider's agent can run shell commands.
- On click, drive the active chat to commit and push with an agent-generated message.

## Non-goals

- Plugin does not run git stage/commit/push itself. The agent owns all git mutation.
- No user-editable commit prompt, commit-message presets, or branch/PR management in v1 (YAGNI).
- No in-app diff viewer, no conflict resolution UI.

## Decisions

| Question | Decision |
|----------|----------|
| Who runs git? | The chat agent, via its own shell tool. Plugin only detects state and injects the prompt. |
| Push or commit only? | Commit then push to upstream. If no remote/upstream, agent commits and reports push skipped. |
| Change detection | Poll `git status --porcelain` on an interval while the panel is visible, plus refresh after each agent turn and on debounced vault file events. |
| Button placement | Icon in the existing input toolbar, with a badge showing the changed-file count. |
| Provider scope | Capability/UI-config gated. Any provider whose agent runs shell commands (Claude, Codex, Cursor, future) shows the button by default; a provider may opt out. |
| Architecture | One shared `GitStatusWatcher` per vault (single poller); each tab's toolbar button is a pure subscriber. |

## Architecture

```text
interval tick / turn-complete / vault event
  -> GitStatusWatcher.refresh()
  -> GitService.getStatus()        (git status --porcelain at vault cwd, enhanced PATH)
  -> diff vs last status
  -> if changed: notify subscribers
  -> GitActionButton.update({ isRepo, dirtyCount })
  -> show/hide + badge

click GitActionButton
  -> inputController.sendMessage({ content: GIT_COMMIT_PROMPT })
  -> normal agent turn (agent runs git via its shell tool)
```

## Components

| Unit | Location | Responsibility | Depends on |
|------|----------|----------------|------------|
| `GitService` | `src/features/chat/services/GitService.ts` | Thin `child_process` wrapper. `getStatus(): Promise<{ isRepo: boolean; dirtyCount: number }>` via `git status --porcelain`. Runs at vault cwd with enhanced PATH. Mirrors `BangBashService` shape (timeout, maxBuffer, shell per platform). | `child_process`, vault path, enhanced PATH |
| `GitStatusWatcher` | `src/features/chat/services/GitStatusWatcher.ts` | One instance per vault. `start()` / `stop()` / `subscribe(cb)` / `refresh()`. Polls `GitService.getStatus()` on an interval, holds last status, notifies subscribers only when status changes. | `GitService` |
| `GitActionButton` | `src/features/chat/ui/InputToolbar.ts` (new class, returned from `createInputToolbar`) | Toolbar icon button. Subscribes to the watcher. Hidden unless `isRepo && dirtyCount > 0 && gate`. Badge shows `dirtyCount`. Disabled while streaming. Click injects the commit prompt. | watcher, provider UI config, input controller |
| `GIT_COMMIT_PROMPT` | `src/core/prompt/` | Prompt template instructing the agent to inspect status/diff, stage, write a concise Conventional-Commits message, commit, and push. | none |

Each unit is testable in isolation: `GitService` mocks `exec`; `GitStatusWatcher` mocks `GitService`; `GitActionButton` mocks the watcher.

## Gating & lifecycle

- **Visibility:** `isRepo && dirtyCount > 0 && uiConfig.isGitActionsEnabled?.(settings) !== false`.
- **New contract:** optional `ProviderChatUIConfig.isGitActionsEnabled?(settings): boolean`. Default-true semantics — a provider that does not implement it still shows the button. A provider returns `false` to opt out. Mirrors the existing `isBangBashEnabled?` pattern.
- **Ownership:** `GitStatusWatcher` is owned by `ClaudianView`. `start()` when the view opens; `stop()` in `onClose()`. Interval registered via `registerInterval` (~7s) and only active while the panel is visible.
- **Refresh triggers:** interval tick; `StreamController` turn-complete; debounced Obsidian vault `modify`/`create`/`delete` events.
- **Streaming:** button is disabled while `state.isStreaming`; a click follows the normal `sendMessage` queueing path.
- **Multi-tab:** one watcher feeds every tab's toolbar button. The button lives per tab (per toolbar) but holds no polling state.

## Prompt template

`GIT_COMMIT_PROMPT` instructs the agent to:

1. Inspect the working tree (`git status`, `git diff`).
2. Stage the changes.
3. Write a concise Conventional-Commits message that reflects the actual diff.
4. Commit.
5. Push to the upstream remote.
6. If there is no upstream/remote, commit and report that push was skipped.
7. Report the outcome (commit hash, push result) in the chat.

Fixed constant for v1. No settings knob.

## Error handling

- `git` not installed, or vault not inside a repo → `GitService.getStatus()` returns `isRepo: false`; button stays hidden. No notices.
- Poll failure (timeout / exec error) → treated as no-change; logged once (not per tick); last good status retained.
- Push failure → surfaced by the agent in the chat. The plugin is not involved in git mutation, so it does not handle push errors directly.

## Testing (TDD, mirrored under `tests/unit/`)

- **`GitService`**: porcelain output parses to correct `dirtyCount`; non-repo exit code maps to `isRepo: false`; timeout path does not throw.
- **`GitStatusWatcher`**: notifies subscribers only when status changes; `start()`/`stop()` idempotent; `refresh()` dedupes identical status.
- **`GitActionButton`**: visibility matrix across `isRepo × dirtyCount × gate`; badge reflects count; click injects `GIT_COMMIT_PROMPT` via `sendMessage`; disabled while streaming.

## Open questions

None blocking. Future extensions (deferred): user-editable prompt, branch/PR actions, Codex/Cursor opt-out defaults if shell behavior differs.
