---
type: claudian-design-spec
title: Agent Board — chat↔work-order interop, capture sources, run-next-ready
date: 2026-05-29
status: approved
owner: Claudian
source: "[[docs/issues/agent-board-mvp.md]]"
related:
  - "[[docs/ideas/agent-board-symphony.md]]"
  - "[[docs/ideas/2026-05-28-standalone-product-vision.md]]"
  - "[[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design.md]]"
  - "[[docs/superpowers/specs/2026-05-29-agent-board-configurable-lanes-design.md]]"
scope: mvp-gap-closing-increment-before-specorator-migration
---

# Agent Board — chat↔work-order interop, capture sources, run-next-ready

## Goal

Close the remaining Agent Board MVP capture and interop stories from
[[docs/issues/agent-board-mvp.md]] so the Specorator migration can proceed with
chat coexistence fully demonstrated. The strict migration-gate bullets (create/index,
lanes, run-binding, ledger/handoff writes, one-run-per-order, state-machine tests,
`TaskNoteStore` preservation tests) are already met by prior increments. This increment
finishes the broader-PRD capture/interop surface.

## Why now

The Agent Board MVP core is built: configurable lanes, board view, `TaskNoteStore`,
`TaskStateMachine`, `BoardConfigStore`, `ChatTabExecutionSurface`, `TaskRunCoordinator`,
built-in prompt renderer, acceptance-progress, and the event bus. The product's first
non-negotiable constraint — **direct chat stays first-class and interoperable with
work orders** — is not yet demonstrated: there is no way to promote chat into a work
order, no conversation→order back-link, and capture is limited to blank / current-note /
file. This increment delivers the chat coexistence story and rounds out capture.

## Scope

### In

1. Capture seed generalization (foundation refactor of `taskCommands`).
2. Capture from editor selection and browser selection.
3. `ChatWorkOrderLinker` + a chat message-action extension point (promote message→order,
   promote conversation→order, two-way link, board reopens linked conversation).
4. Run-next-ready board action + command.
5. Explicit chat non-regression test coverage.

### Out

- Custom workflow notes (`WorkflowNoteStore`).
- Git worktrees, evidence bundles, changed-file attribution, independent review gate.
- Headless execution, autonomous scheduler/daemon, retry scheduling.
- Auto-push / auto-PR / auto-merge.
- Chat-side "linked work order" chip (deferred; board-only reopen this increment).

## Product constraints honored

- **No chat regression.** Every existing chat flow (send, stream, cancel, resume, fork,
  history reload, attachments, inline edit, skills/subagents, provider settings) must work
  unchanged, with the new optional conversation field both absent and present.
- **Chat owns itself.** `features/chat` must not import `features/tasks`. Interop flows in
  the chat→tasks direction go through a chat-owned extension point that tasks registers into.
- **Work-order metadata stays out of unbound chat.** The optional `workOrderPath` field is
  absent for ad-hoc conversations and renders nothing; the message-action registry is empty
  by default.

## Design

### A. Capture seed (foundation)

`src/features/tasks/commands/taskCommands.ts` currently accepts only `TFile | TFolder`.
Generalize to a seed so every capture entry point shares one creation path.

```ts
interface WorkOrderSeed {
  title?: string;
  status?: TaskStatus;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  objective?: string;            // seeds the ## Objective body section
  contextMarkdown?: string;      // seeds the ## Context body section
  conversationId?: string | null; // pre-fills frontmatter conversation_id
}
```

- `buildWorkOrderMarkdown` consumes the seed. When `objective` is present it replaces the
  Objective placeholder; when `contextMarkdown` is present it replaces the Context placeholder.
- `createWorkOrder(plugin, seed, options)` becomes the single entry point.
- Existing callers (`createWorkOrder(plugin, file)`, `createWorkOrderFromCurrentNote`) are kept
  as thin adapters that build a seed from the `TFile`/`TFolder`.
- Frontmatter shape is unchanged except that `conversation_id` may be pre-filled.

### B. Capture commands (capture sources)

- **From selection:** read `plugin.app.workspace.activeEditor?.editor?.getSelection()`. Seed
  `objective`/`contextMarkdown` with the selection plus a `[[source-note]]` link and the line
  range. Show a Notice when there is no selection. Register as a palette command and an editor
  context-menu item.
- **From browser selection:** reuse the existing browser-selection helper in `utils/` that
  `BrowserSelectionController` already uses. Seed `contextMarkdown` with the quoted selection
  and a `[title](url)` link. Register as a palette command.
- Capture reads are read-only. They must not depend on `features/chat`.
- **Default lane for captured orders is `inbox`** (raw, needs refinement). Blank and
  from-note creation keep their current `ready` default.

### C. ChatWorkOrderLinker + chat extension point (interop)

#### Data model

Add an optional field to the conversation and its persisted metadata:

```ts
// core/types/chat.ts
interface Conversation { /* ... */ workOrderPath?: string }
interface SessionMetadata { /* ... */ workOrderPath?: string }
```

- Optional and opaque to all chat logic. Absent for ad-hoc conversations.
- Persisted through the existing `SessionStorage`/session-metadata path.
- The order→conversation direction already exists (`conversation_id` written by
  `TaskRunCoordinator`); this adds the conversation→order direction for a complete two-way link.

#### Chat-owned extension point

`features/chat` exposes two small seams so tasks can plug in without chat importing tasks:

1. **Message-action registry.** A registry of optional per-message actions:
   ```ts
   interface ChatMessageAction {
     id: string;
     label: string;
     icon: string;
     predicate(msg: ChatMessage, conv: Conversation): boolean;
     run(msg: ChatMessage, conv: Conversation): void;
   }
   ```
   `MessageRenderer` renders registered actions into the existing
   `.claudian-user-msg-actions` toolbar next to the copy button. The registry is empty by
   default, so an unconfigured chat renders byte-identically to today.
2. **Read-only active-conversation accessor.** `getActiveConversationSnapshot()` for
   conversation-level promotion (the active tab already exposes `conversationId` via the
   task-run path; this returns a read-only snapshot).

#### `ChatWorkOrderLinker` (in `features/tasks`)

- `promoteMessageToWorkOrder(msg, conv)`: builds a seed (title from a short summary of the
  message, `objective` from `msg.content`, `contextMarkdown` with a conversation link and the
  message's `currentNote` link, `conversationId: conv.id`), creates the order, and writes
  `workOrderPath` back onto the conversation.
- `promoteConversationToWorkOrder(conv)`: seed from conversation title plus a condensed last
  user/assistant exchange and a conversation link.
- `linkConversationToOrder(conv, orderPath)` and `unlink`.
- Registered at `main.ts` wiring time, where both chat and tasks are already known. Chat never
  imports tasks.

#### Board side

- The card and detail modal gain an **Open conversation** affordance that reopens the linked
  conversation by id through a stable plugin accessor (the chat view already reopens history
  conversations by id). Board-owned; no chat→tasks dependency.

### D. Run-next-ready (execution)

- Add `runNextReady()` coordination: from the `TaskIndexer` board model, select orders whose
  status maps to a ready lane, exclude any with an active run, sort by priority descending then
  created ascending, and run the first via the existing run path. Show a Notice when none are
  eligible.
- Surface as a board toolbar button and a command-palette entry.
- The one-run-per-order invariant is already enforced by `TaskRunCoordinator`.

## Module / file impact

| File | Change |
|------|--------|
| `src/features/tasks/commands/taskCommands.ts` | Introduce `WorkOrderSeed`; seed-based `createWorkOrder`; selection + browser capture commands |
| `src/features/tasks/execution/ChatWorkOrderLinker.ts` | New: promote/link/unlink |
| `src/features/tasks/execution/TaskRunCoordinator.ts` | Add `runNextReady()` |
| `src/features/tasks/ui/AgentBoardRenderer.ts` / `AgentBoardView.ts` | Run-next-ready button; Open-conversation affordance |
| `src/features/tasks/ui/WorkOrderDetailModal.ts` | Open-conversation affordance |
| `src/features/chat/rendering/MessageRenderer.ts` | Render registered message actions in existing toolbar |
| `src/features/chat/` (registry owner) | Message-action registry + read-only conversation snapshot accessor |
| `src/core/types/chat.ts` | Optional `workOrderPath` on `Conversation` and `SessionMetadata` |
| `src/main.ts` | Wire `ChatWorkOrderLinker`; register message action; register capture commands |

## Safety & non-regression

- `workOrderPath` is optional and never required; no chat code path reads it to function.
- Message-action registry empty ⇒ identical chat render (asserted in tests).
- `features/chat` imports nothing from `features/tasks`; boundary verified by lint/import rules.
- Capture reads are read-only and do not mutate the source note, editor, or browser view.
- Created orders cannot self-grant permissions; effective permissions remain settings + per-run
  approval (unchanged from MVP posture).

## Tests (TDD)

### Unit

- `taskCommands`: seed→markdown round-trips; selection, browser, and chat seeds produce valid
  frontmatter and correct Objective/Context bodies; `conversation_id` pre-filled when seeded.
- `ChatWorkOrderLinker`: `promoteMessageToWorkOrder` builds the expected seed and writes
  `workOrderPath` back onto the conversation; `linkConversationToOrder`/`unlink` round-trip.
- `runNextReady`: eligibility filter and ordering (priority then created); skips orders with an
  active run; no eligible order ⇒ no-op and Notice.

### Contract / non-regression

- Message-action registry empty ⇒ user-message toolbar unchanged.
- Chat send/stream/cancel/resume/fork operate correctly with `workOrderPath` absent and present.

### Integration

- Editor selection → captured order (inbox) → manual run → review.
- Promote chat message → order persists the two-way link (`conversation_id` on the note,
  `workOrderPath` on the conversation).
- Reopen the linked conversation from a board card.

## Open questions (non-blocking)

- Should `promoteConversationToWorkOrder` summarize the exchange with a title-generation pass, or
  keep a deterministic condensed copy for the first version? (Lean: deterministic copy first.)
- Should the editor context-menu item appear only when a selection exists, or always with a
  Notice when empty? (Lean: always present, Notice when empty, matching current command behavior.)
