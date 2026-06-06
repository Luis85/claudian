---
title: Work-order execution — visibility + agent protocols (P0+P1)
date: 2026-06-04
status: ready-for-review
scope: agent-board-execution
parent: "[[agent-board-mvp]]"
related:
  - "[[2026-05-28-agent-board-thin-slice-design]]"
  - "[[agent-board-background-runs]]"
  - "[[agent-board-evidence-review]]"
---

# Work-order execution — visibility + agent protocols (P0+P1)

## Summary

The Agent Board executes work orders today as a binary state flip: `ready → running → review`. Between those flips the board is silent: no live progress, no last-tool, no elapsed time, no way for the agent to ask a question or request approval. The transcript exists only in a hidden chat tab the user has to open.

This spec closes that gap. It (P0) makes the run state observable on the card without opening the tab, and (P1) activates the dormant `needs_input` / `needs_approval` states by giving the agent inline protocol blocks the runtime watches for in the stream.

Scope intentionally excludes scheduling (queues, dependencies), DoR/DoD validators, indexing performance, and provider-native background runs. Those are tracked elsewhere and warrant their own specs.

## Implementation status

Implemented per [[2026-06-04-work-order-execution]] (PR #35). All automated gates pass: `typecheck`, `lint`, the full unit + integration suites, and `build`.

One deliberate deviation from the plan, confirmed with the maintainer: a **single neutral stream adapter** taps the shared `StreamController` (every provider runtime already normalizes its raw stream to `StreamChunk` before the feature layer sees it), rather than four per-provider adapters. The `RunSession` contract and the rest of the design are unchanged.

**Pending before `shipped`:** per-provider manual smoke in a real vault (Claude, Codex, Opencode, Cursor) — it cannot run headlessly — then merge.

## Goals

- Stream live ledger entries from the provider into the work order during a run (debounced batched writes).
- Render a live strip on the card: elapsed timer, attempt counter, last ledger line, heartbeat-stale dot.
- Detect stuck runs via a heartbeat watchdog and fail them with a clear reason.
- Add three inline agent protocol blocks: `<claudian_progress>`, `<claudian_needs_input>`, `<claudian_needs_approval>`. Wire them to ledger entries and state transitions.
- Add `needs_handoff` status for partial-handoff recovery (assistant produced content but no handoff block).
- Implement same-conversation pause/resume: a paused run keeps its tab and conversation; user reply becomes the next user turn.
- Ship across all four providers (Claude, Codex, Opencode, Cursor) behind a small `ProviderStreamAdapter` interface.

## Non-goals

- Tab queue / `waiting` status / per-provider concurrency caps.
- Per-work-order timeouts beyond the heartbeat watchdog.
- Work-order dependencies (`depends_on`).
- Programmatic DoR / DoD validators.
- Incremental indexing.
- Subagent-level stream attribution (nested per-subagent ledger).
- Provider-native background (Claude `/bg`, Codex Automations).
- Resume-after-plugin-reload for paused runs.
- Cost / token usage on card.

## Locked decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Slice | P0 visibility + P1 protocols |
| Signal source | Provider stream events + agent text blocks (both) |
| Resume mechanics | Same conversation, follow-up turn |
| Provider coverage | All four (Claude/Codex/Opencode/Cursor) day 1 |
| Ledger write strategy | Debounced vault writes + in-memory tail |
| Architectural spine | Coordinator-as-bus, split into `RunSession`, `ClaudianBlockParser`, `LedgerWriter`, per-provider `ProviderStreamAdapter` |

## State machine changes

`needs_input` and `needs_approval` are legal targets from `running` today but no code emits them. This spec activates both. Adds `needs_handoff` for partial-handoff recovery.

Transition additions and changes:

| From | To | Trigger |
|------|----|---------|
| `running` | `needs_input` | Agent emits `<claudian_needs_input>` |
| `running` | `needs_approval` | Agent emits `<claudian_needs_approval>` |
| `running` | `needs_handoff` (new) | Stream ended, no handoff block, content non-empty |
| `needs_input` | `running` | User answers via card / chat |
| `needs_approval` | `running` | User clicks Approve |
| `needs_approval` | `canceled` | User clicks Reject (with reason) |
| `needs_handoff` | `review` | Regenerate-handoff follow-up succeeded (see below) |
| `needs_handoff` | `failed` | Regenerate-handoff follow-up also failed |

**Regenerate-handoff mechanism.** On `needs_handoff`, the card surfaces a "Regenerate handoff" action. Clicking it calls `RunSession.regenerateHandoff()` which uses the still-open chat tab's conversation: `surface.sendFollowUp(runId, REGENERATE_PROMPT)` where `REGENERATE_PROMPT` asks the agent to emit only a `<claudian_handoff>` block summarizing the prior turn. The session re-enters the streaming loop with a short stale threshold (60s). On success → `review`. On failure or empty → `failed`. No new `attempts` increment; same attempt continues.

`canceled` remains terminal. `done → inbox` unchanged. All other existing transitions unchanged.

Frontmatter additions on `TaskFrontmatter`:

- `attempts: number` — already declared, this spec is first writer. Increments on every entry into `running` (initial start and rework reruns; **not** on resume from pause).
- `heartbeat: string | null` — last live-signal ISO timestamp; populated by coordinator; cleared on terminal status.
- `pause_reason: string | null` — last pause block's `question` / `action`; cleared on resume.

## Components and files

### New

| File | Purpose | LoC budget |
|------|---------|-----------|
| `src/features/tasks/execution/RunSession.ts` | Per-run object. Lifecycle, heartbeat timer, pause state, debounced flush, event emission. One per active run. | ~250 |
| `src/features/tasks/execution/ClaudianBlockParser.ts` | Streaming parser for the three new blocks. Cross-chunk tail buffer. Pure. | ~150 |
| `src/features/tasks/execution/LedgerWriter.ts` | Debounced batched writer over `noteStore.appendLedger`. In-memory tail buffer. | ~120 |
| `src/features/tasks/execution/ProviderStreamAdapter.ts` | Interface contract. | ~40 |
| `src/providers/claude/runtime/ClaudeStreamAdapter.ts` | Claude SDK → handlers. | ~120 |
| `src/providers/codex/runtime/CodexStreamAdapter.ts` | Codex app-server → handlers. | ~120 |
| `src/providers/opencode/runtime/OpencodeStreamAdapter.ts` | ACP updates → handlers. | ~120 |
| `src/providers/cursor/runtime/CursorStreamAdapter.ts` | `cursor-agent` stream-json → handlers. | ~120 |

### Changed

| File | Change |
|------|--------|
| `src/features/tasks/execution/TaskRunCoordinator.ts` | Thin: pre-flight + construct `RunSession` + await terminal. ~80 LoC. |
| `src/features/tasks/execution/TaskExecutionSurface.ts` | Add `sendFollowUp(runId, content)` and `subscribeStream(runId)`. Return shape carries `stream` + `terminal`. |
| `src/features/tasks/execution/ChatTabExecutionSurface.ts` | Implement new methods. |
| `src/features/tasks/events.ts` | Add `task:ledger-appended`, `task:heartbeat`, `task:needs-input`, `task:needs-approval`, `task:resumed`, `task:attempt-started`, `task:parser-warning`, `task:needs-handoff`, `task:ledger-flush-degraded`, `task:progress`. |
| `src/features/tasks/model/taskStateMachine.ts` | New `needs_handoff` + transitions. |
| `src/features/tasks/model/taskTypes.ts` | Add `heartbeat`, `pause_reason` to `TaskFrontmatter`; `'needs_handoff'` to `TaskStatus`. |
| `src/features/tasks/storage/TaskNoteStore.ts` | `writeStatus` writes `heartbeat`/`pause_reason`; new `clearPause` helper. |
| `src/features/tasks/prompt/TaskPromptRenderer.ts` | `## Protocol` section. `## Prior Attempts` on rerun. |
| `src/features/tasks/execution/TaskHandoffParser.ts` | Stays as today; partial-handoff branching lives in `RunSession.finish`. |
| `src/features/tasks/ui/AgentBoardRenderer.ts` | Card live strip, paused-state reply box, per-card DOM diff (no full re-render on event). |
| `src/features/tasks/ui/AgentBoardView.ts` | Subscribe to new events; route reply/approve/reject via `RunSession` handle. |
| `src/features/chat/ClaudianView.ts` | `startTaskRunInFreshTab` returns `TaskRunHandle` with `stream` + `terminal`. |
| `src/style/tasks/_agent-board.css` | Live strip, stale dot, reply box, pulse animation. |

## Data flow

End-to-end for a run with a pause and resume.

### Phase A — Start

```
User clicks Run
  → AgentBoardView.runTask(task)
    → re-parses note (fresh frontmatter)
    → constructs RunSession(deps: surface, noteStore, parser, ledgerWriter, events, now)
    → emits task:attempt-started { taskId, attemptNumber }
  → RunSession.start()
    → writeStatus({status: 'running', timestamp, heartbeat: timestamp}) + attempts++
    → ledgerWriter.enqueue({status: 'running', message: `Run started (attempt N)`})
    → surface.startTaskRun(task, { prompt }) → { runId, conversationId, sidepanelTabId, stream, terminal }
    → writeStatus({ runId, conversationId, sidepanelTabId })
    → stream.subscribe({ onText, onToolUse, onToolResult, onError, onEnd })
    → start heartbeat timer (30s tick) + stale watchdog (5min)
```

### Phase B — Live streaming

```
provider text chunk
  → adapter.onText(chunk)
    → RunSession.handleText(chunk)
      → parser.feed(chunk) → { plainText, blocks: [...] }
      → for each block:
          - progress     → ledgerWriter.enqueue({running, `progress: ${step}`}) + emit ledger-appended
          - needs_input  → Phase C (pause)
          - needs_approval → Phase C (pause)
      → lastEvent = now

provider tool_use
  → adapter.onToolUse({ name, primaryArg })
    → ledgerWriter.enqueue({running, `tool: ${name} ${truncate(primaryArg, 60)}`})
    → emit ledger-appended
    → lastEvent = now

ledgerWriter every 5s OR on milestone (pause, finish, queue > 3):
  → batched vault.process write
  → in-memory tail keeps last 20 entries for fast card render
```

### Phase C — Pause

```
RunSession.pause({ kind, question })
  → ledgerWriter.flush()
  → writeStatus({ status: kind, pause_reason: question })
  → emit task:needs-input | task:needs-approval { taskId, question, runId, kind, fields }
  → set awaitingReply = true
  → stop heartbeat watchdog (no "stale" while waiting on user)
  → terminal promise NOT resolved — session stays alive

Card renders inline reply surface from event payload.

User reply:
  - needs_input(reply)             → runSession.resume({ reply })
  - needs_approval(approved=true)  → runSession.resume({ approved: true })
  - needs_approval(approved=false, reason) → runSession.resume({ approved: false, reason })

RunSession.resume(arg)
  → if rejection:
      → ledger {canceled, `rejected: ${reason}`}; writeStatus({canceled, finished, pause_reason: null}); resolve terminal
  → else:
      → clearPause: writeStatus({status: 'running', pause_reason: null, heartbeat: now})
      → emit task:resumed
      → ledgerWriter.enqueue({running, `resumed: ${truncate(content, 80)}`})
      → surface.sendFollowUp(runId, content)
      → restart heartbeat + stale watchdog
      → back to Phase B
```

### Phase D — End

```
adapter.onEnd({ finalAssistantContent, status })
  → RunSession.finish(payload)
    → stop heartbeat, watchdog, parser
    → ledgerWriter.flush()
    → status === 'canceled': ledger {canceled}; writeStatus({canceled, finished}); resolve
    → status === 'failed':   ledger {failed, error}; writeStatus({failed, finished}); resolve
    → status === 'completed':
        parsed = parseHandoff(finalAssistantContent)
        if parsed.ok:
          writeHandoff + writeStatus({review, finished}) + ledger {review, 'Handoff written'}
        elif finalAssistantContent.length > 0:
          writeStatus({needs_handoff, finished}) + ledger {needs_handoff, parsed.error}
          emit task:needs-handoff
        else:
          writeStatus({failed, finished}) + ledger {failed, 'Empty response'}
  → unsubscribe stream
  → emit task:run-finished
```

### Phase E — Crash recovery

```
AgentBoardView.onOpen:
  for each work order with status in {running, needs_input, needs_approval}
      and no live RunSession matching runId:
    ledger {failed, 'orphaned by plugin reload'}
    writeStatus({failed, finished: now, pause_reason: null})
    emit task:status-changed
```

## Agent protocol blocks

Three new inline blocks. Existing `<claudian_handoff>` unchanged.

### Common rules

- One self-contained fence pair per block.
- Body is `key: value` lines. Multi-line values continue until the next `key:` at column 0 or fence end.
- Parser tolerates leading/trailing whitespace, blank lines inside block.
- Strict on required fields; unknown fields silently stripped (forward-compat).
- Cross-chunk: 1 KB tail buffer.
- `needs_input` / `needs_approval` are end-of-turn blocks. Agent must stop generating after the closing fence on that turn.
- Multiple pause blocks in one turn: first wins, others trigger `task:parser-warning`.
- Pause block + handoff block in same turn: pause wins, handoff parsing skipped that turn.
- Unclosed block at EOF: malformed; drop with parser-warning.
- Nested `<claudian_*>` inside another block: outer wins, inner ignored.

### `<claudian_progress>`

```
<claudian_progress>
step: Wiring tests for RunSession lifecycle
done: 2/5
note: pause/resume path covered next
</claudian_progress>
```

| Field | Required | Notes |
|-------|----------|-------|
| `step` | yes | One-line description. |
| `done` | no | `<int>/<int>`. Surfaces as `N/M` pill on card. |
| `note` | no | Optional second line for live strip. |

Coordinator: append `[running] progress: ${step}` (truncate 120). Emit `task:ledger-appended` and `task:progress` (latter carries `done` when present). No frontmatter write beyond the next ledger flush.

### `<claudian_needs_input>`

```
<claudian_needs_input>
question: Which env file should I read for the API base URL — .env or .env.local?
why: Both exist with different values; doc doesn't specify.
default: .env.local
</claudian_needs_input>
```

| Field | Required | Notes |
|-------|----------|-------|
| `question` | yes | Shown verbatim on card. |
| `why` | no | Short context line. |
| `default` | no | Pre-fills card text field. |

### `<claudian_needs_approval>`

```
<claudian_needs_approval>
action: Drop and recreate the work_orders table
risk: Loses all in-flight runs; requires re-import.
reversible: false
</claudian_needs_approval>
```

| Field | Required | Notes |
|-------|----------|-------|
| `action` | yes | One-line description. |
| `risk` | no | Risk summary. |
| `reversible` | no | `true` / `false`; rendered as badge. |

### Prompt section addition

`TaskPromptRenderer` injects a new `## Protocol` section between Docs Sync and Context:

```
## Protocol
While running, you may emit these inline blocks. Use them whenever the situation calls for them; the harness watches the stream and reacts.

- <claudian_progress>step: …; done: N/M; note: …</claudian_progress>
  Optional milestone updates. Emit at natural boundaries; do not flood.

- <claudian_needs_input>question: …; why: …; default: …</claudian_needs_input>
  When you genuinely need information you cannot derive. End your turn after this block. The run pauses; you will be resumed with the user's reply.

- <claudian_needs_approval>action: …; risk: …; reversible: true|false</claudian_needs_approval>
  Before destructive or irreversible operations. End your turn after this block. The run pauses; you will be resumed only if the user approves.

End the entire run with one <claudian_handoff> block as specified below.
```

### Prior Attempts injection (rerun)

When the run is a `needs_fix` rerun and the ledger contains prior `[review]` or `[needs_fix]` entries, `TaskPromptRenderer` injects a `## Prior Attempts` section after `## Rework Notes`:

```
## Prior Attempts
- Attempt 1 (2026-06-04T10:00:00Z) ended in needs_fix:
  - Last progress: "Wiring tests for RunSession lifecycle"
  - Tool calls: Edit, Edit, Bash(npm test)
  - Rework reason: Test coverage missing for pause path
```

Truncate to last 2 attempts, max 20 lines. Built from `task.sections.ledger`.

## Provider stream adapter contract

`src/features/tasks/execution/ProviderStreamAdapter.ts`:

```typescript
export interface StreamToolUse {
  name: string;
  primaryArg: string | null;
}

export interface StreamHandlers {
  onText(chunk: string): void;
  onToolUse(tool: StreamToolUse): void;
  onToolResult(name: string, ok: boolean): void;
  onError(error: string): void;
  onEnd(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): void;
}

export interface ProviderStreamAdapter {
  subscribe(handlers: StreamHandlers): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}
```

`TaskExecutionSurface.startTaskRun` return shape:

```typescript
export interface TaskRunHandle {
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  stream: ProviderStreamAdapter;
  terminal: Promise<TaskRunTerminal>;
}

export interface TaskRunTerminal {
  status: 'completed' | 'failed' | 'canceled';
  finalAssistantContent: string;
  error?: string;
}
```

### Per-provider mapping

| Adapter | Source events | Mapping notes |
|---------|--------------|---------------|
| Claude | `content_block_start` (text/tool_use), `content_block_delta`, `message_stop`, `error` | text deltas → onText; tool_use start with `name` + first arg field → onToolUse; `tool_result` → onToolResult; SDK error → onError; `message_stop` → onEnd |
| Codex | `notify/assistantMessageDelta`, `notify/toolUseStart`, `notify/toolUseEnd`, `notify/runCompleted` | adapter wraps existing `codexNormalization` output |
| Opencode | ACP `session/update`: `agentMessageChunk`, `toolCall`, `toolCallUpdate` | reuses `src/providers/acp` update normalizer; tool name from `kind`, primary arg from `rawInput` first scalar |
| Cursor | `cursor-agent --output-format stream-json` NDJSON: `assistant`, `tool_use`, `tool_result`, `result` | reuses `cursorStreamMapper`; `result.subtype` maps to onEnd status |

`primaryArg` extraction:

- `Edit` / `Write` / `Read` / `apply_patch` → `file_path`
- `Bash` / `shell` / `exec` → first 60 chars of command
- `Grep` / `Glob` → pattern
- Unknown tool → `null`

### Lifecycle constraints

- Single-subscriber per adapter instance. Calling `subscribe` twice replaces the prior handlers and returns a fresh unsubscribe.
- `subscribe` returns an idempotent unsubscribe.
- Events arriving after `onEnd` are dropped.
- `sendFollowUp` rejects if conversation is closed; coordinator treats as terminal `failed`.
- `cancel` is best-effort; adapter should call provider's actual cancel where available.

## UI

### Card live strip

```
┌─────────────────────────────────────────────┐
│ Title                              [status] │
│ claude / claude-sonnet-4-5  ·  2 - normal   │
│ ▓▓▓▓▓░░░░ 3/8                              │  acceptance progress
│ ● running 4m 12s · attempt 2                │  live strip line 1
│ tool: Edit src/foo.ts                       │  live strip line 2 (last ledger)
│ [Stop] [Open run]                           │  actions
└─────────────────────────────────────────────┘
```

| Element | Source | Updates |
|---------|--------|---------|
| Pulsing dot `●` | CSS animation when status in `{running, needs_input, needs_approval}` | per render |
| Status + elapsed | `started` + `now()` interval | every 1s while card visible |
| Attempt pill | `attempts` frontmatter | on `task:attempt-started` |
| Last ledger line | In-memory tail (RunSession); falls back to `task.sections.ledger` last line for stale runs | on `task:ledger-appended` |
| Stale dot color | `heartbeat` age | every 30s tick |

Stale tiers: `< 1m` green, `1m–5m` amber, `> 5m` red + `(stale)` suffix.

### Paused state — inline reply

`needs_input`:

```
│ ⏸ needs input: 2m 03s · attempt 2           │
│ Q: Which env file should I read — .env or … │
│ ┌─────────────────────────────────────────┐ │
│ │ .env.local                              │ │  prefilled with `default`
│ └─────────────────────────────────────────┘ │
│ [Send reply]  [Cancel run]                  │
```

`needs_approval`:

```
│ ⏸ needs approval: 0m 31s · attempt 2        │
│ Action: Drop and recreate work_orders table │
│ Risk: Loses all in-flight runs (not reversible) │
│ [Approve]  [Reject…]                        │  Reject opens reason modal
```

- Card click during pause does not open detail modal.
- Background gets `--paused-input` / `--paused-approval` accent class.

### Open run button

Calls `view.activateTab(sidepanelTabId)`. Only rendered when `runId` + `sidepanelTabId` present and tab exists.

### DOM diffing

`AgentBoardRenderer` keeps a `Map<taskId, CardRefs>` of element refs. Three render paths:

- `renderInitial(state, callbacks)` — first paint or layout-changing event
- `patchCard(taskId, task)` — diff text content, classes, action buttons; no destroy
- `patchLiveStrip(taskId, payload)` — only update elapsed + last ledger line

`AgentBoardView` routes by event:

- `task:board-config-changed` → `renderInitial`
- `task:status-changed`, `task:attempt-started`, `task:needs-input`, `task:needs-approval`, `task:resumed` → `patchCard`
- `task:ledger-appended`, `task:heartbeat`, per-second timer → `patchLiveStrip`

### Detail modal

Minor only:

- Ledger always shown (not only on `failed`).
- "Prior Attempts" preview when status is `needs_fix` (mirrors prompt injection).
- Reply surface available here too, mirroring card.

### CSS additions

- `claudian-agent-board-card--running`, `--paused-input`, `--paused-approval`, `--stale-amber`, `--stale-red`
- `claudian-agent-board-card-live-strip`, `--meta`, `--ledger`
- `claudian-agent-board-card-reply`, `--field`, `--actions`
- `@keyframes claudian-pulse-dot`

## Error handling

| Failure | Detection | Landing | Ledger | Recovery |
|---------|-----------|---------|--------|----------|
| Provider not enabled | Pre-flight | status unchanged; run rejected | none | Notice to user |
| Model not owned | Pre-flight | status unchanged; run rejected | none | Notice to user |
| Tab limit reached | Surface | status unchanged; run rejected | none | Notice; queue is future spec |
| Conversation closed mid-run | `sendFollowUp` rejects / stream ends without `onEnd` | `failed` | `[failed] conversation closed` | Manual |
| Provider transport error | `onError(message)` | `failed` | `[failed] ${error}` | Manual |
| Heartbeat lost > threshold | RunSession watchdog | `failed` | `[failed] heartbeat lost (no events for Nm)` | Manual |
| Empty response | `finalAssistantContent.length === 0`, status `completed` | `failed` | `[failed] empty response` | Manual |
| Handoff parse fail + content non-empty | `parseHandoff` not ok, content present | `needs_handoff` | `[needs_handoff] ${parseError}` | "Regenerate handoff" |
| Handoff parse fail + content empty | both conditions | `failed` | `[failed] no handoff and no content` | Manual |
| User cancels | `stream.cancel()` | `canceled` | `[canceled] stopped by user` | Reopen |
| Approval rejected | `resume({ approved: false, reason })` | `canceled` | `[canceled] rejected: ${reason}` | Reopen |
| Stream events after `onEnd` | adapter race | n/a | n/a | Drop |
| Vault write failure | `applyNoteChange` throws | run continues; flush retry | n/a | Best-effort |
| Plugin reload during run | startup scan | `failed` | `[failed] orphaned by plugin reload` | Manual |

### Heartbeat configuration

- `agentBoardHeartbeatIntervalMs` (default 30000)
- `agentBoardStaleThresholdMs` (default 300000)
- Watchdog suspended during `needs_input` / `needs_approval`.
- Elapsed timer continues during pause.

### LedgerWriter retry

On `vault.process` failure: re-queue + exponential backoff (5s, 30s). After two failures: drop with `task:ledger-flush-degraded` event (subscribers can surface a banner). In-memory tail keeps the card live strip accurate.

### Parser malformed cases

- Missing required field → `task:parser-warning` + ledger `[running] (parser) ignored malformed ${kind} block`. Drop block.
- Unknown field in known block → silently strip.
- Unknown block kind → silently strip (no warning; agents may legitimately use other XML-shaped content).
- Nested → outer wins.
- Unclosed at EOF → drop with parser-warning.

### Pause edge cases

- Both pause kinds in one turn → first wins; second logged with parser-warning.
- Pause block + handoff block → pause wins.
- Text after pause block → kept in transcript, not acted on; user reply seeds next turn.
- Cancel during pause → `canceled` with `[canceled] cancelled while paused`.

### Crash recovery

Runs once on `AgentBoardView.onOpen`. Marks orphaned non-terminal runs `failed`. Paused runs cannot transparently resume in v1 — provider conversation is gone with the killed tab. Future spec may add reload-resume via per-provider session DB lookup.

## Testing

### Unit (new)

| Spec | Coverage |
|------|----------|
| `tests/unit/features/tasks/execution/RunSession.test.ts` | start emits attempt-started + writeStatus(running); heartbeat tick advances `lastEvent`; stale watchdog fires after threshold; pause stops watchdog; resume restarts it; finish flushes pending ledger; cancel mid-pause; unsubscribe idempotent |
| `tests/unit/features/tasks/execution/ClaudianBlockParser.test.ts` | block split across chunks; multiple blocks per stream; malformed missing-field; unknown field stripped; unknown block kind ignored; nested rejected; unclosed at EOF |
| `tests/unit/features/tasks/execution/LedgerWriter.test.ts` | flush every 5s; force-flush on milestone; ordering preserved; vault write retry; tail-buffer cap of 20 |
| `tests/unit/providers/*/runtime/*StreamAdapter.test.ts` (4) | per-adapter: synthetic event log → assert handler-call sequence + `primaryArg` extraction |

### Unit (extended)

| Spec | Add |
|------|-----|
| `tests/unit/features/tasks/model/taskStateMachine.test.ts` | new transitions; `needs_handoff`; illegal-transition assertions |
| `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts` | `## Protocol` section present; `## Prior Attempts` only on rerun with prior ledger |
| `tests/unit/features/tasks/storage/TaskNoteStore.test.ts` | `writeStatus` writes `heartbeat`/`pause_reason`; `clearPause` helper |
| `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` | `renderInitial` + `patchCard` + `patchLiveStrip`; reply box renders for pause states; stale-dot color tiers |

### Integration (new)

| Spec | Flow |
|------|------|
| `tests/integration/features/tasks/taskRun.happyPath.test.ts` | Synthetic adapter streams text + tool + progress + handoff → ledger lines + status `review` + handoff written |
| `tests/integration/features/tasks/taskRun.needsInput.test.ts` | `<claudian_needs_input>` → status `needs_input` → reply resumes → terminates `review` |
| `tests/integration/features/tasks/taskRun.needsApproval.test.ts` | Approve path + Reject path |
| `tests/integration/features/tasks/taskRun.needsHandoff.test.ts` | Stream completes without handoff but with content → status `needs_handoff`; regenerate-handoff one-shot succeeds → `review` |
| `tests/integration/features/tasks/taskRun.heartbeatLost.test.ts` | Stream stalls > threshold → `failed` with heartbeat reason |
| `tests/integration/features/tasks/taskRun.crashRecovery.test.ts` | Startup with on-disk `running` task → scan transitions to `failed` orphaned |
| `tests/integration/features/tasks/taskRun.cancelDuringPause.test.ts` | Pause → user cancel → `canceled` |
| `tests/integration/features/tasks/taskRun.parserMalformed.test.ts` | Malformed `needs_input` block → parser-warning ledger entry, run continues, completes normally |

### Perf (new under `tests/perf/`)

| Spec | Guard |
|------|-------|
| `runSessionLedger.perf.ts` | LedgerWriter flush cost O(batch), in-memory tail bounded to 20 |
| `agentBoardPatch.perf.ts` | `patchLiveStrip` per-event cost O(1); full re-render only on layout-changing events |

### Manual smoke checklist (Definition of Done item)

One run per provider (Claude, Codex, Opencode, Cursor) with:

1. Visible live strip updating during run.
2. At least one `<claudian_progress>` block.
3. One `<claudian_needs_input>` pause + reply + resume.
4. One `<claudian_needs_approval>` pause + approve.
5. Final `<claudian_handoff>` parsed → status `review`.

Recorded by attaching the work-order ledger to the implementation PR.

## Migration / compatibility

- New optional frontmatter fields (`heartbeat`, `pause_reason`) — existing notes parse unchanged.
- `attempts` already declared in `TaskFrontmatter`; existing zeros stay zero until first new run.
- `needs_handoff` is a new `TaskStatus`. Hand-edited notes with this value are accepted.
- No vault data migration.
- Backward compatibility for existing work-order schema: `schema_version: 1` unchanged.

## Definition of Done

- All new + extended unit tests pass.
- All integration tests pass.
- Perf gates green.
- Manual smoke checklist run once per provider.
- `npm run typecheck && npm run lint && npm run test && npm run build` clean.
- One end-to-end demo on each provider with at least one `needs_input` pause and one `needs_approval` pause captured in the work-order ledger.

## Implementation order (suggested for planning)

1. `taskTypes` + `taskStateMachine` + `TaskNoteStore` (schema groundwork). Tests first.
2. `ClaudianBlockParser` + tests (pure, isolated).
3. `LedgerWriter` + tests.
4. `ProviderStreamAdapter` interface + a synthetic in-memory adapter for tests.
5. `RunSession` + tests (using synthetic adapter).
6. `TaskRunCoordinator` refactor to use `RunSession`.
7. `TaskExecutionSurface` + `ChatTabExecutionSurface` updates; `ClaudianView.startTaskRunInFreshTab` return shape.
8. `TaskPromptRenderer` Protocol + Prior Attempts; tests.
9. Per-provider stream adapters (one PR each, Claude first).
10. `AgentBoardRenderer` diffing + live strip + reply box; tests.
11. `AgentBoardView` event wiring + crash-recovery scan.
12. Manual smoke + DoD verification.

Each numbered step lands as its own change with passing tests.
