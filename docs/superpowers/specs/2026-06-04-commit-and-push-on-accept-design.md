---
status: approved
date: 2026-06-04
scope: features/tasks, features/chat, app/settings
parent: "[[Agent Kanban Board]]"
relations:
  - "[[2026-05-26-git-commit-push-button-design]]"
  - "[[Push and Commit accepted Work-Orders]]"
tags:
  - quality-of-life
  - tasks
  - git
---

# Commit & push on Accept — design

**Date:** 2026-06-04
**Status:** Approved design, pending implementation plan

## Summary

When a user clicks **Accept** on a Work-Order (review → done), and the vault sits inside a git repo with uncommitted changes, a modal asks whether to commit and push. If confirmed, the work-order's own chat conversation receives a scoped commit prompt referencing the accepted Work-Order (title, id, objective, completed acceptance criteria), composed on top of the existing `GIT_COMMIT_PROMPT`. The provider's agent stages, commits, and pushes; the plugin owns gating, the modal, and prompt composition only.

This builds on the shipped chat-toolbar Commit & push button ([[2026-05-26-git-commit-push-button-design]]) by reusing its prompt template and the `GitStatusWatcher` already polling repo state. No new git mutation runs from the plugin.

## Goals

- Prompt the user to commit and push when they accept a Work-Order in a dirty git-backed vault.
- Scope each commit to one Work-Order: title, id, objective, completed acceptance criteria embedded in the prompt.
- Route the commit turn through the work-order's own conversation tab (or a fresh tab if none exists).
- Provide a one-click "Don't ask again for this vault" opt-out.
- Honor existing provider opt-in via `ProviderChatUIConfig.isGitActionsEnabled?`.

## Non-goals

- Plugin does not run git stage/commit/push itself. The agent owns all git mutation (unchanged from existing button feature).
- No file-level tracking of which files this Work-Order changed; the agent still inspects the diff itself.
- No batching of multiple accepted Work-Orders into one commit. One Accept → one commit turn → one commit.
- No rollback of Work-Order status if the commit turn fails (status stays `done`).
- No new UX in Inline Edit, Tasks Run, or other entry points — only the Agent Board Accept flow.

## Decisions

| Question | Decision |
|---|---|
| Trigger | Accept transition only (`review → done`). Not "Mark ready", not "Reopen". |
| Where the commit agent runs | The work-order's own chat tab (`task.frontmatter.conversation_id`). Fallback: new chat tab on the work-order's provider (or default provider) if no conversation. |
| Prompt scope | `GIT_COMMIT_PROMPT` + work-order id + title + Objective section + checked acceptance items. Sourced entirely from work-order frontmatter and sections — no new tracking infra. |
| UX | Obsidian `Modal` confirm. Title "Commit & push?". Body shows work-order title + N changed files. Checkbox "Don't ask again for this vault". Buttons `[Skip]` and `[Commit & push]` (CTA). |
| Not a repo / clean repo | Silent skip. No modal. No notice. |
| No `conversation_id` on work-order | Fall back to a fresh chat tab on the work-order's provider (with default provider as fallback if `task.frontmatter.provider` is absent), inject the scoped prompt there. |
| `conversation_id` set, tab currently closed | Reopen / focus the tab from session metadata, then inject. |
| `conversation_id` set but the conversation record is missing or unrecoverable | Treat as no-conversation-id: open a fresh tab and inject. |
| Tab streaming | Inject anyway through the existing `InputController.sendMessage` queue. No special handling. |
| Provider for commit turn | Work-order's provider (matches the conversation). |
| Multiple rapid Accepts | One modal per Accept. No batching, no debouncing in the coordinator. |
| Plan mode active on target tab | Inject anyway. `GIT_COMMIT_PROMPT` is benign metadata work. |
| Master toggle default | **On**. Per-vault setting `promptCommitOnAccept` in `.claudian/claudian-settings.json`. |
| Provider opt-in | Reuse existing `ProviderChatUIConfig.isGitActionsEnabled?(settings)`. If `false`, silent skip — no new capability flag. |
| Settings UI location | Claudian → General settings tab → "Git" subsection, new row under existing Git-action toggle. |
| Failure rollback | None. Status stays `done`. User can retry via the existing toolbar `GitActionButton`. |

## Architecture

```text
AgentBoardView.transitionTask(task, 'done', ...)
  └─ writes frontmatter + ledger
  └─ emits 'task:status-changed' { taskId, path, status: 'done' }
        │
        ▼
CommitOnAcceptCoordinator (subscribed at plugin lifecycle init)
  ├─ filter: status === 'done' && masterToggle && providerSupportsGit
  ├─ load task spec from path (TaskNoteStore.parse)
  ├─ ask GitStatusWatcher.getLastStatus()  →  isRepo && dirtyCount > 0 ?
  ├─ render CommitOnAcceptModal
  │     ├─ user [Skip]            → optional settings write, done
  │     ├─ user checks "Don't ask again" → write settings.promptCommitOnAccept = false
  │     └─ user [Commit & push]   → build scoped prompt → surface call
  └─ TaskExecutionSurface.requestCommitTurn(task, scopedPrompt)
        │
        ▼
ChatTabExecutionSurface
  ├─ open work-order's Conversation (by conversation_id) — focus existing tab or open new
  ├─ if conversation missing → open new tab on task provider (or default) with task linkage
  └─ InputController.sendMessage({ content: scopedPrompt })
        │
        ▼
ChatRuntime.query → agent inspects diff, stages, commits with
Conventional-Commits subject derived from work-order title, pushes
```

Key seams:

- The **coordinator** owns orchestration. It has no direct chat access — its only chat-side dependency is `TaskExecutionSurface`.
- The **modal** is a plain Obsidian `Modal` subclass with no provider awareness.
- The **scoped prompt builder** is a pure function `(task, dirtyCount) => string`, trivial to unit-test.
- The **`GitStatusWatcher` is reused unchanged** — the coordinator reads `getLastStatus()` and calls `refresh()` if needed.
- The **settings field** `promptCommitOnAccept: boolean` (default `true`) is added to `defaultSettings` and read/written through existing `ClaudianSettingsStorage`.

## Components

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| `CommitOnAcceptCoordinator` | `src/features/tasks/commit/CommitOnAcceptCoordinator.ts` | Subscribe to `task:status-changed`. On `'done'`, gate (toggle + provider + git dirty), load task spec, open modal, dispatch to surface. `start()` / `stop()` lifecycle, idempotent. | `EventBus`, `TaskNoteStore`, `GitStatusWatcher`, settings reader/writer, `CommitOnAcceptModal`, `TaskExecutionSurface`, `ProviderRegistry`, `buildScopedCommitPrompt`, `Logger` |
| `CommitOnAcceptModal` | `src/features/tasks/commit/CommitOnAcceptModal.ts` | Obsidian `Modal`. Renders title, body (work-order title + N changed files), "Don't ask again for this vault" checkbox, `[Skip]` and `[Commit & push]` buttons. Resolves a Promise with `{ confirmed: boolean; dontAskAgain: boolean }`. | `obsidian.Modal`, i18n strings |
| `buildScopedCommitPrompt` | `src/features/tasks/commit/scopedCommitPrompt.ts` | Pure function. `(task: TaskSpec, dirtyCount: number) => string`. Composes `GIT_COMMIT_PROMPT` + work-order title/id + Objective + checked acceptance items. Deterministic. | `GIT_COMMIT_PROMPT`, `parseAcceptanceProgress` |
| `TaskExecutionSurface.requestCommitTurn` | `src/features/tasks/execution/TaskExecutionSurface.ts` (extend interface) | New optional method: `requestCommitTurn?(task: TaskSpec, prompt: string): Promise<void>`. Optional so non-chat surfaces stay valid. | — |
| `ChatTabExecutionSurface.requestCommitTurn` | `src/features/tasks/execution/ChatTabExecutionSurface.ts` (extend impl) | Resolve work-order conversation by `conversation_id`. If the record exists, open or focus its tab (reopen from session metadata if disposed). If `conversation_id` is null or the record is missing, open a new chat tab on `task.frontmatter.provider` (default provider if absent). Inject `prompt` through the existing `InputController.sendMessage` path. | tab manager / `ConversationController`, `InputController`, `ProviderRegistry` |
| `defaultSettings.promptCommitOnAccept` | `src/app/settings/defaultSettings.ts` (extend) | New boolean field, defaults `true`. Loaded/saved via existing `ClaudianSettingsStorage`. | settings storage |
| General settings tab row | `src/features/settings/general/GeneralSettingsTab.ts` (extend) | Toggle row "Prompt to commit and push on Accept" under the existing Git subsection. | settings storage, i18n |
| Plugin lifecycle wiring | `src/app/lifecycle/PluginLifecycle.ts` (extend) | Instantiate `CommitOnAcceptCoordinator` after `GitStatusWatcher` and the surface are ready; `start()` on plugin load, `stop()` on unload. | all of above |

Each unit is testable in isolation: the coordinator with mocked event bus, surface, modal, git reader, and settings; the modal in detached DOM; the prompt builder as input → string; the surface impl with a mocked input controller.

## Scoped prompt template

The builder emits (sketch — concrete strings finalized in implementation):

```text
{GIT_COMMIT_PROMPT body, instructions 1-5}

Scope this commit to the following accepted Work-Order:

Work-Order: {task.frontmatter.id} — {task.frontmatter.title}

Objective:
{task.sections.objective}

Acceptance criteria completed:
- {checked item 1}
- {checked item 2}
- ...

{GIT_COMMIT_PROMPT tail: push instructions, no-upstream fallback, reporting}
```

Rules:

- The work-order's title becomes the basis of the Conventional-Commits subject; agent must still constrain to ~50 chars.
- The Objective block is omitted if empty.
- The Acceptance criteria block is omitted if `parseAcceptanceProgress` reports zero checked items.
- Builder output is deterministic — no timestamps, no env reads — so unit tests can string-compare.

## Data flow

Happy path — Accept from board card, dirty repo, work-order has a conversation:

1. User clicks Accept on a board card (`review → done`).
2. `AgentBoardView.transitionTask` writes `status='done'` and a ledger entry.
3. `EventBus.emit('task:status-changed', { taskId, path, status: 'done' })`.
4. `CommitOnAcceptCoordinator.handleStatusChange` runs:
   - `settings.promptCommitOnAccept === true` ✓
   - `TaskNoteStore.read(path) → TaskSpec`
   - `task.frontmatter.status === 'done'` ✓
   - resolve `provider = task.frontmatter.provider` (or default)
   - `ProviderRegistry.getChatUIConfig(provider).isGitActionsEnabled?(settings) !== false` ✓
   - `GitStatusWatcher.refresh()` → `{ isRepo: true, dirtyCount: 7 }`
   - open `CommitOnAcceptModal({ taskTitle, dirtyCount: 7 })`
5. User clicks **[Commit & push]** → modal resolves `{ confirmed: true, dontAskAgain: false }`.
6. Coordinator builds the scoped prompt (see template above).
7. Coordinator calls `TaskExecutionSurface.requestCommitTurn(task, prompt)`.
8. `ChatTabExecutionSurface.requestCommitTurn`:
   - resolves work-order conversation by `conversation_id`
   - opens/focuses its tab (creates the tab if disposed)
   - calls `inputController.sendMessage({ content: prompt })`
9. Provider runtime streams: inspects diff, stages, commits with a Conventional-Commits subject derived from the work-order title, pushes.
10. User watches the stream in the work-order's chat tab.

Skip + Don't ask again branch:

- Step 5 → user checks "Don't ask again", clicks **[Skip]**
- Modal resolves `{ confirmed: false, dontAskAgain: true }`
- Coordinator writes `settings.promptCommitOnAccept = false` via `ClaudianSettingsStorage`
- No surface call

Branches summarized:

| Condition | Behavior |
|---|---|
| Not a repo | Silent skip. |
| Clean repo (`dirtyCount === 0`) | Silent skip. |
| Provider opt-out (`isGitActionsEnabled === false`) | Silent skip. |
| No `conversation_id` | Surface opens a fresh tab on the task's provider (default provider if `task.frontmatter.provider` is absent); injects the scoped prompt there. |
| `conversation_id` set, tab closed | Surface reopens the tab from session metadata; injects. |
| `conversation_id` set but conversation record missing | Surface falls back to opening a fresh tab on the task's provider (or default); injects. |
| Tab currently streaming | Inject anyway; existing `sendMessage` queue handles it. |
| Plan mode active | Inject anyway. |
| Two rapid Accepts | Two modals, two surface calls, two commit turns. |

## Error handling

| Failure | Behavior |
|---|---|
| `TaskNoteStore.parse` throws (corrupt frontmatter, race) | Coordinator catches, logs `warn` via `plugin.logger.scope('tasks.commitOnAccept')`, silent skip. No modal. |
| `GitStatusWatcher.refresh()` throws / watcher uninitialized | Coordinator catches, treats as `{ isRepo: false }`, silent skip. |
| Settings write fails when toggling "Don't ask again" | `Notice` "Failed to save preference. Try again from settings." Modal still closes. |
| `requestCommitTurn` rejects (tab manager error, runtime not ready) | Surface returns rejected promise; coordinator shows `Notice` "Commit prompt failed: \<message\>". Logged at `error`. Status stays `done`. |
| Conversation record missing despite a valid `conversation_id` | Fall back to a new chat tab on the task's provider (default if absent). Same code path as the no-conversation-id branch. No user-visible error. |
| `InputController.sendMessage` rejects mid-queue | Surfaced through the existing chat error path. Coordinator does not intercept past handoff. |
| Provider runtime missing (registered but disabled mid-session) | `requestCommitTurn` rejects with a clear message → `Notice` as above. |
| Coordinator initialized before `GitStatusWatcher` ready | `start()` is idempotent; coordinator subscribes lazily and calls `refresh()` on first event. |

**Rollback policy:** the Work-Order stays `done` on commit failure. Accept and Commit & push are orthogonal side-effects. Users can retry via the existing toolbar `GitActionButton`.

**Logging contract:**

- `logger.scope('tasks.commitOnAccept')` for all coordinator events.
- `debug` for gate decisions: `skip: notRepo`, `skip: clean`, `skip: providerOptOut`, `skip: toggleOff`.
- `warn` for parse failures and settings-write failures.
- `error` for surface call failures.
- No prompt body in logs above `debug`; truncate to the first 200 chars at `debug`.

## Testing (TDD, mirrored under `tests/`)

**Unit tests — `tests/unit/features/tasks/commit/`:**

| Spec | Cases |
|---|---|
| `CommitOnAcceptCoordinator.test.ts` | Status ≠ `'done'` → no action. Toggle off → silent skip. Provider opt-out → silent skip. `isRepo=false` → silent skip. `dirtyCount=0` → silent skip. Happy path → modal opens with correct title and count, surface called with the built prompt. Skip + `dontAskAgain` → settings write, surface **not** called. Skip + `!dontAskAgain` → no settings write, no surface call. Confirm → surface called. Parse failure → `warn` log, no throw, no modal. Surface rejection → `error` log + `Notice`. Two rapid accepts → two modals, two surface calls. `stop()` unsubscribes. |
| `CommitOnAcceptModal.test.ts` | Title renders. Body shows work-order title and the dirty file count (singular vs plural). Checkbox toggles. `[Skip]` resolves `{ confirmed: false, dontAskAgain: <checkbox> }`. `[Commit & push]` resolves `{ confirmed: true, dontAskAgain: <checkbox> }`. ESC / close button resolves `{ confirmed: false, dontAskAgain: false }`. |
| `scopedCommitPrompt.test.ts` | Prompt embeds work-order id and title. Objective section included verbatim. Only checked acceptance items included. Empty Objective → "Objective:" block omitted. Zero acceptance criteria → "Acceptance criteria" block omitted. Trailing `GIT_COMMIT_PROMPT` instructions preserved verbatim. Deterministic output. |
| `ChatTabExecutionSurface.test.ts` (extend existing) | `requestCommitTurn` with an existing conversation → focuses the tab and calls `sendMessage` with the prompt. Missing conversation → opens a new tab on the task's provider and calls `sendMessage`. Disposed conversation → falls back to a new tab. Rejects when no provider registered. |

**Integration tests — `tests/integration/features/tasks/commit/`:**

| Spec | Verifies |
|---|---|
| `acceptCommitFlow.integration.test.ts` | Real `EventBus`, real `TaskNoteStore` over an in-memory vault, fake `GitStatusWatcher` returning `dirtyCount=3`, spy surface. Trigger the `transitionTask` Accept path. Assert: settings respected, modal flow drives the surface call exactly once with the composed prompt. |
| `acceptCommitFlow.settingsOff.integration.test.ts` | Same wiring with `promptCommitOnAccept = false`. Assert: no modal, no surface call. |

**Test infra notes:**

- Modal tests use detached DOM and `jest-environment-jsdom` (existing setup).
- Coordinator tests use the fake `EventBus` from existing `tests/unit/core/events/` helpers.
- No new Jest config or perf-suite entries needed — this is feature code, not a hot path.

**Out of scope:**

- No perf test (feature is one-shot per Accept, not iterated).
- No end-to-end test against real Obsidian (unit + integration covers behavior).

## Open questions

None blocking. Future extensions (deferred):

- File-level tracking of mutations during a `TaskRunCoordinator` run, so the prompt can stage only those paths.
- Batching across rapid Accepts into a single commit.
- Exposing the scoped prompt template as a user-editable setting.
- Symmetric "commit on Done" for other terminal transitions if user demand emerges.
