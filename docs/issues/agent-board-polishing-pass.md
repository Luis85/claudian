---
type: polish
id: issue-20260606-agent-board-polishing-pass
title: Agent Board polishing pass — review findings across UI, execution, and storage layers
status: open
priority: 2 - medium
triage: ready-for-agent
created: 2026-06-06
updated: 2026-06-06
owner: Claudian
related:
  - "[[agent-board-mvp]]"
  - "[[agent-board-evidence-review]]"
  - "[[agent-board-background-runs]]"
scope: dedicated-polishing-session
tags:
  - agent-board
  - tasks
  - polish
  - i18n
  - accessibility
  - bugs
relations:
  - "[[Agent Kanban Board]]"
---

# Agent Board polishing pass — review findings

> Output of a thorough cross-cutting review of the `features/tasks` slice (UI, execution, storage, prompt, indexing) against `src/features/tasks/CLAUDE.md` and `src/core/CLAUDE.md`. Findings are ranked by impact; pick up in a dedicated session and triage before fixing.
>
> Out of scope here: feature additions tracked in `agent-board-evidence-review.md`, `agent-board-background-runs.md`, `agent-board-drag-and-drop.md`, `Bug - selected provider and model on work-orders not respected.md`, `Work-Order execution shall not consume available chat tabs.md`. This issue is about correctness, polish, and contract drift in what already exists.

## Pre-fixed in current session

Already landed in the session that produced this issue — do NOT re-fix:

- **Stale "full" tab budget after restore** — `ClaudianView.ts` now fires `chat:tabs-changed` after `tabsRestored = true` so the Agent Board's free-slot gate stops reporting `0 free` once restore finishes.
- **Slot label mislabeled as "Chat tabs"** — `AgentBoardRenderer.ts` toolbar now reads `Work-order tabs X/Y · N free`, matching what `state.slots` actually tracks (WO-tab budget, not the chat budget).

## High-impact findings (do these first)

### H1 — Resume on status-write failure emits stale `task:resumed`

`src/features/tasks/execution/RunSession.ts` resume path: `persistStatus()` is awaited but its rejection is not handled before the `task:resumed` emit. If the frontmatter write fails, the board's `onStatusChanged` handler deletes the `pauseState` even though the run is still effectively paused on disk. Result: the card looks running, but the next reload reindexes it as `needs_input`/`needs_approval` again with no reply surface available until the user opens detail.

Fix sketch: gate the emit on the write resolving; on rejection, surface a `task:run-failed` ledger note and keep `pauseState` intact.

### H2 — Background `pendingStatusWrites` rejection clobbers terminal result

`src/features/tasks/execution/RunSession.ts` awaits `Promise.all(pendingStatusWrites)` near terminal. A rejected background heartbeat or status write will throw on the first rejection and route through `settleAfterFailure`, marking an otherwise-successful run as failed.

Fix sketch: `Promise.allSettled` for background writes; log rejections to the ledger; never let a heartbeat write fail the run.

### H3 — `LedgerWriter` retry counter off-by-one

`src/features/tasks/execution/LedgerWriter.ts` retry exhaustion check uses `retryAttempt > RETRY_BACKOFF_MS.length` where `>=` is intended. A third transient failure still retries instead of degrading to drop.

Fix sketch: change comparator; add a unit test that simulates N+1 failures and asserts disposal.

### H4 — Empty title can persist via rapid blur on `WorkOrderDetailModal`

`src/features/tasks/ui/WorkOrderDetailModal.ts` title field blur handler. Guard prevents saving empty if the field is empty on blur, but rapid focus/blur cycles or paste-of-whitespace bypass the check.

Fix sketch: trim before compare; reject `.length === 0` post-trim; debounce blur-save.

### H5 — Collapsed lane is mouse-only (a11y)

`src/features/tasks/ui/AgentBoardRenderer.ts` `renderCollapsedLane`: `role="button"` set but no `tabindex="0"` and no key handler. Keyboard users cannot reach or expand a collapsed lane.

Fix sketch: add `tabindex="0"`, key handler for Enter/Space, mirror collapse toggle in expanded header (also missing `aria-expanded`).

### H6 — Hard-coded UI strings throughout the board (i18n drift)

The Agent Board toolbar, queue chrome, lane definitions, card actions, skip chip, and detail modal contain dozens of hard-coded English strings while the rest of the plugin routes through `t('tasks.board.*')`. Examples:

- `AgentBoardRenderer.ts`: "Add work order", "Run next ready", "Run queue" / "Pause queue", "Queue halted: …", "{n} failures", "⊘ Queue skipped: …", "Ready when" / "Done when", every action label (Run/Stop/Accept/Rework/Retry/Reopen/Review/Mark failed/Back to inbox/Mark ready), "Collapse lane" / "Expand lane".
- `WorkOrderDetailModal.ts`: field labels (Title, Provider, Model, Priority), every action button, "Provider default" model placeholder.
- The "No free work-order tabs…" hint (and the new "Work-order tabs N/M · K free" toolbar label landed in this session) are also hard-coded.

Fix sketch: add a `tasks.board.*` block to `src/i18n/locales/en.json` and the nine locale mirrors; route every literal through `t()`; cover with a lint pattern if practical.

### H7 — `cardRefs` never cleared when a card is removed mid-render

`src/features/tasks/ui/AgentBoardRenderer.ts` clears `cardRefs` at the top of `render()` but `patchCard`/`patchLiveStrip` are external entry points. Between renders, removed tasks (vault delete, archive, status moved out of a lane the model still has stale) leave `CardRefs` entries pointing at detached DOM. Long-lived boards accumulate refs and closures.

Fix sketch: prune on `patchModelStatus` when the task is gone; or reconcile `cardRefs.keys()` against `model.tasks` after every refresh.

### H8 — `pauseState` not evicted when a task is deleted

`src/features/tasks/ui/AgentBoardView.ts` evicts `pauseState` on terminal status transition, but a task deleted from the vault while paused never sees a status change emit. Entries leak.

Fix sketch: on `onVaultChange` for a `delete` event, drop matching `pauseState` and `liveHeartbeats` entries.

## Medium findings (rough edges, contract drift)

### M1 — `saveTaskFields` re-indexes the whole vault per field edit

`AgentBoardView.ts` calls `refresh()` after every `WorkOrderDetailModal` field save. Editing title → provider → model in sequence triggers three full vault indexes.

Fix sketch: batch field saves at modal level (one write per OK), or debounce `refresh()` to coalesce.

### M2 — Implicit pause reason truncates from the right

`RunSession.ts` `extractImplicitPauseReason` keeps the last 240 chars of agent prose. A multi-question prompt loses the first question; users see only the trailing fragment.

Fix sketch: prefer the last paragraph; truncate within paragraph; show "…" prefix when truncated.

### M3 — Live strip color-only freshness indicator

`AgentBoardRenderer.applyLiveStrip` switches `claudian-stale-{green|amber|red}` classes. Color-blind users cannot distinguish tiers.

Fix sketch: add a textual `aria-label` ("Fresh", "Stale {ageHuman}", "Very stale {ageHuman}") on `meta` el; add an icon glyph beside the elapsed text.

### M4 — Vault-change handlers have no batching beyond 100 ms debounce

`AgentBoardView.onVaultChange` schedules a single refresh per 100 ms tick. Bulk creates (backup restore, git checkout) still trigger many sequential 100 ms reindexes.

Fix sketch: extend debounce window when many events arrive within a window; coalesce.

### M5 — Reply input has no length hint or limit

`AgentBoardRenderer.renderReplySurface` `needs_input` field accepts any length; pasted megabyte will hit the runtime and fail.

Fix sketch: add `maxLength` matching the runtime ceiling; render a character counter for very large pastes.

### M6 — `extractGeneratedRegion` vs `replaceGeneratedRegion` asymmetry

`TaskNoteStore.ts`: extract returns `''` when markers are missing (silent), replace throws (loud). The asymmetry is safe but surprising. `appendLedger` happily writes into an empty extracted region when markers are gone, then loses the line because replace later throws.

Fix sketch: make `appendLedger` check for marker presence and fail loudly the same way replace does, or extract returns a sentinel that callers must handle.

### M7 — Prompt rendering does not escape work-order metadata

`TaskPromptRenderer.ts` interpolates task title, objective, acceptance criteria, and context raw. A title containing `<claudian_handoff>` or other block markers will confuse the agent's downstream parser.

Fix sketch: escape `<claudian_*>` substrings in metadata fields, or document the constraint and reject at index time.

### M8 — `recoverOrphanedRuns` has no concurrency guard

`AgentBoardView.ts` runs orphan recovery on a 60 s interval AND on board open AND on every `task:status-changed`. Idempotent in practice, but two overlapping passes scan the model and write `failed` for the same orphan twice on the path where the first write hasn't landed yet.

Fix sketch: in-flight bool guard around `recoverOrphanedRuns`; collapse re-entrant calls.

### M9 — `RunSidecarStore.listRuns` assumes forward slashes

`RunSidecarStore.ts` extracts run id with `path.split('/').at(-1)`. Obsidian normalizes, but the assumption is undocumented and a vault adapter change could break it.

Fix sketch: use `path.basename` or split on `/[\\\\/]/`; add a comment.

### M10 — Sentence-case lint exception only on board's display text

`AgentBoardView.getDisplayText()` opts out of sentence-case with an eslint-disable. Other "Agent Board" mentions in UI text (modal titles, settings copy, button labels) inconsistently use "Agent board" vs "Agent Board".

Fix sketch: pick one (product name = "Agent Board"); audit and align UI copy.

### M11 — Inline malformed-handoff path goes straight to `needs_handoff`

`RunSession.ts` implicit-pause guard. If the agent emits a malformed `<claudian_handoff>` block (typo, missing field), the run is terminal as `needs_handoff` even though there is plenty of content to give it a second chance.

Fix sketch: on parse failure with non-empty content, treat as implicit pause once and retry; if still malformed, terminal. Document the behavior either way.

### M12 — `BoardConfigStore` silently normalizes lane titles

`BoardConfigStore.ts` trims leading/trailing whitespace from lane titles on load. Users editing config by hand get no feedback that "Ready " was silently trimmed.

Fix sketch: surface a board-config notice via the existing `errors` channel when normalization changes a value.

### M13 — Reply card text rendered as plain text (correct) but no sanitization for line breaks

`AgentBoardRenderer.renderReplySurface` shows the pause question/action via `createDiv({ text })`. Multi-line pause reasons collapse to one line because the div is rendered with `text:` which strips newlines on display.

Fix sketch: preserve newlines via `white-space: pre-wrap` or render each paragraph as a separate div.

### M14 — `Provider default` model option is a hidden contract

`WorkOrderDetailModal.ts` uses empty-string value with "Provider default" label. The form coupling is implicit; a future maintainer setting `value=''` for "none" would shadow this convention.

Fix sketch: extract a `PROVIDER_DEFAULT_MODEL_VALUE` constant and reference everywhere.

## Low / nitpick

- **L1** — `LedgerWriter.ts` `TAIL_CAP = 20` comment says "in case an open tag is split across chunks" but the value is entries, not bytes. Reword.
- **L2** — `AgentBoardRenderer.renderCard` card div lacks `role="article"` / `aria-labelledby` linking to the title.
- **L3** — `AgentBoardRenderer.renderQueueInfo` shows "{n} failures" with no singular. "1 failures" reads poorly.
- **L4** — `extractGeneratedRegion` is O(n²) on pathological input via paired `indexOf`. Single forward pass is cleaner.
- **L5** — `RunSession.attemptNumber` is written to both frontmatter `attempts` and the ledger line. Document the dual write.
- **L6** — `LedgerWriter.flushNow` swallow path is intentional (best-effort terminal flush) but the silent catch is undocumented.
- **L7** — `taskCommands.archiveWorkOrder` confirmation text is hard-coded and not i18n'd.
- **L8** — `AgentBoardRenderer.renderErrors` renders unbounded message strings; very long paths overflow the lane width.
- **L9** — `selectNextEligibleTask` priority + creation-date ordering is correct but undocumented; cite the contract from CLAUDE.md.
- **L10** — Inline comment in `QueueRunner.launch` says "before runAcquired's async reload" but the reservation happens *during* `launch`, not at runAcquired entry; clarify.

## Documentation drift (against `src/features/tasks/CLAUDE.md`)

- The CLAUDE.md table lists ledger snapshot timing as "once at terminal (after handoff write)". Verify across all five terminal paths (canceled / failed / needs_handoff / review / done) that the snapshot consistently lands AFTER handoff and BEFORE settle. The H2 finding above suggests the order is held; add a regression test that asserts call order.
- The "Live heartbeat UI" section says the live map is evicted on terminal. Verify against H8 (deletion path) — current code does not evict on vault delete.

## Suggested ordering for the polishing session

1. **Correctness first (H1, H2, H3, H4)** — these are silent bugs, not polish. Each lands with a unit test (the perf suite is the wrong vehicle; mirror under `tests/unit/features/tasks/`).
2. **A11y + i18n sweep (H5, H6)** — single large PR that touches every UI string and every keyboard-only affordance. Update all 10 locale mirrors.
3. **Leak prevention (H7, H8, M8)** — small focused PR; assert via fake-timers test.
4. **Rough edges and contract drift (M-series and L-series)** — batch by file owner.

## Acceptance

- All H findings closed or explicitly punted with a follow-up issue.
- New i18n keys exist in all 10 locales; lint or test prevents regression.
- `tests/unit/features/tasks/` gains at least: resume-on-write-failure, background-write-rejection, retry-exhaustion, vault-delete-evicts-paused-state.
- `npm run typecheck && npm run lint && npm run test && npm run build` clean.
- This issue is closed with links to the PRs that resolved it.
