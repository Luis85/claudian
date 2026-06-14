# Tasks / Agent Board Feature

`features/tasks` owns Markdown work orders, Agent Board UI, task prompt rendering, run coordination, and generated ledger/handoff writes.

## Boundaries

- Task code may call chat only through `TaskExecutionSurface`.
- Direct chat must not depend on tasks.
- Provider-specific behavior stays behind `ChatRuntime`, `ProviderRegistry`, and existing chat controllers/renderers.
- Work-order notes are the durable source of task state for this feature slice.
- WO card right-click is a renderer→view callback seam (`AgentBoardRenderCallbacks.onContextMenu`) dispatched through `ui/workOrderContextMenu.ts`, which reuses `features/quickActions/` helpers without coupling tasks to chat.

## Run state — sidecar vs work-order note

To avoid racing the agent's `Edit` tool against the work-order checklist, run state is split across two surfaces:

| Surface | What lands | When |
|---|---|---|
| `.claudian/runs/<runId>/heartbeat.json` | `{ at, status, pauseReason? }` (`RunSidecarHeartbeat`) | every 30s heartbeat tick |
| `.claudian/runs/<runId>/ledger.jsonl` | one JSON-encoded `TaskLedgerEntry` per line | every ledger flush (per progress block, tool call, status transition) |
| Work-order note frontmatter | `status`, `run_id`, `heartbeat`, `started`, `attempts`, `pauseReason` | run start, pause, resume, terminal — turn boundaries only |
| Work-order note `<!-- claudian:run-ledger-* -->` region | full sidecar ledger rendered as `- <ts> [<status>] <message>` lines | once at terminal (after handoff write) |
| Work-order note `<!-- claudian:handoff-* -->` region | structured handoff markdown | once at terminal (review path) |

### Components

- **`ui/AgentBoardRenderer`** + **`ui/agentBoardCardActions`**: the board renderer keeps card/lane/toolbar DOM, patch-in-place, and `cardRefs`, and delegates the per-card hover action cluster (per-status primary button + ⋯ overflow menu) plus the single body-portaled overflow popover to `AgentBoardCardActions`. That sibling owns the `CARD_ACTIONS` spec table and the `AgentBoardRenderCallbacks` type (re-exported from `AgentBoardRenderer` so existing importers/tests are unchanged); the renderer feeds it live callbacks via a `getCallbacks` dep, so there is no renderer↔card-actions import cycle.
- **`ui/WorkOrderDetailModal`** + **`ui/workOrderPropertiesPanel`** + **`ui/workOrderActivitySection`**: the modal owns its shell, header, objective/acceptance, and footer; the right-pane properties sidebar (status pill + editable agent/provider/model/priority chips + created/updated/attempts + conversation link) renders through `renderWorkOrderProperties(parent, task, callbacks)`, and the status-driven activity block (Agent handoff cards / needs-handoff salvage / failed-run ledger, plus the shared collapsible card) through `renderWorkOrderActivity(parent, { task, app, markdownComponent })`. The panels take a type-only import of the modal's callback contract (no runtime cycle, mirroring `workOrderFooterActions`).
- **`ui/WorkOrderActivityProvider`**: plugin-level activity provider for the chat header dropdown. It indexes active `running` / `needs_input` / `needs_approval` work orders, exposes counts and rows through `core/types/workOrderActivity`, switches to live sidepanel tabs when possible, and falls back to a read-only-safe `WorkOrderDetailModal`.
- **`storage/RunSidecarStore`**: filesystem only. Owns `writeHeartbeat`, `readHeartbeat`, `appendLedger`, `readLedger`, `snapshotLedgerAsMarkdown(runId)`, `listRuns()`, `cleanupRun(runId)`. Recursive `ensureBaseDir` walks `.claudian` → `.claudian/runs` once (memoized). `readLedger` skips malformed JSON lines, tolerates CRLF; snapshot flattens embedded newlines in messages so one entry = one markdown line.
- **`storage/TaskNoteStore`**: `writeLedgerSnapshot(content, markdown)` mirrors `writeHandoff` — replaces the run-ledger region atomically. Throws on missing markers.
- **`execution/RunSession`**: deps `writeHeartbeat`, `appendLedger`, `finalizeLedgerToNote` are REQUIRED. Heartbeat tick + `LedgerWriter` flush callback route directly to sidecar. `writeLedgerSnapshotBestEffort()` runs on every terminal path (canceled / failed / canceled / needs_handoff / review) AFTER the terminal status write and (when present) the handoff write, BEFORE `settle(...)`. Best-effort: snapshot failures are swallowed so the run still settles.
- **`execution/TaskRunCoordinator`**: wires deps from view → session. `appendLedger` closure injects `task`; `writeHeartbeat`/`finalizeLedgerToNote` are direct method refs on the dep.
- **`ui/AgentBoardView`**: wires `plugin.runSidecarStore` into the coordinator. Owns three lifecycle hooks against the sidecar:
  - **GC on terminal**: `finalizeLedgerToNote` calls `cleanupRun(runId)` after the snapshot lands.
  - **Startup sweep**: `sweepStaleSidecars()` runs in `onOpen` after `refresh()` and before `recoverOrphanedRuns()`. Removes any `<runId>` dir not matched by a non-terminal task with that `run_id`.
  - **Periodic orphan re-check**: 60s interval re-runs `recoverOrphanedRuns()` so mid-session crashes don't strand cards until the next `onOpen`.
- **Orphan recovery** (`recoverOrphanedRuns`): for tasks in `{running, needs_input, needs_approval}` with no live session in `sharedRunRegistry`, reads `runSidecarStore.readHeartbeat(run_id)`. If the sidecar's `at` is within `DEFAULT_STALE_THRESHOLD_MS` (5 min, shared with `RunSession.staleThresholdMs`), the safety net skips adoption; otherwise marks the run failed with an `orphaned by plugin reload` ledger line.
- **Live heartbeat UI**: `AgentBoardView.liveHeartbeats: Map<taskId, isoString>` captures the `task:heartbeat` event `at` and `patchLiveStrip` prefers it over `frontmatter.heartbeat`. Evicted on terminal status.

### Why the split is safe

Status writes (frontmatter) align with turn boundaries where the agent has just paused or ended — it is not mid-`Edit`. The terminal ledger snapshot writes the note in a single `replaceGeneratedRegion` call after the run has settled and the stream is closed. Heartbeat ticks and per-ledger-entry appends — the high-frequency writes that previously raced the agent — never touch the note.