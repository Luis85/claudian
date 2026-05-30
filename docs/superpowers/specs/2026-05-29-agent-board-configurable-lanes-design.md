---
status: approved
---
# Agent Board Configurable Lanes + Board QoL Design

Date: 2026-05-29
Status: proposed for user review
Source PRD: [[docs/issues/agent-board-mvp.md]]
Builds on: [[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design.md]]

## Summary

Make the Agent Board configurable and add board quality-of-life. Replace the hardcoded one-lane-per-status board with user-defined lanes: custom titles, order, visibility, and status-to-lane mapping, plus per-lane definition of ready (DoR) and definition of done (DoD). The current run lane's DoR/DoD are injected into the run prompt as guidance.

Quality-of-life: add work orders directly from the board into the Inbox, edit a work order's frontmatter (title, provider, model, priority) inline in the detail modal, and promote an Inbox item to Ready with an explicit action.

The internal status set stays fixed (10 statuses) and the state machine is unchanged. Configuration only affects display grouping and prompt context. Status changes stay action-driven through the state machine. Roles are out of scope for this increment.

## Goals

- Store board configuration in plugin settings (`.claudian/claudian-settings.json`).
- Edit configuration through a settings-tab UI (lane editor).
- Render user-defined lanes with custom titles, order, and visibility.
- Map many internal statuses onto one lane (e.g. `review` + `needs_fix` share a lane).
- Author per-lane DoR/DoD text, shown on the board.
- Inject the current lane's DoR/DoD into the run prompt as guidance.
- Fall back to a default configuration on invalid config and surface a board-visible error.
- Preserve current board behavior when configuration is left at default.
- Add a work order from the board straight into the Inbox.
- Edit a work order's frontmatter (title, provider, model, priority) inline in the detail modal.
- Promote an Inbox work order to Ready with an explicit, validated action.

## Non-goals

- No roles, assignees, or default-role-per-lane.
- No WIP-limit enforcement.
- No drag/drop lane movement.
- No automated enforcement of DoR/DoD checklist items.
- No custom internal statuses or custom transition graph.
- No vault-file or Markdown-note config storage.
- No editing of body sections (Objective/Acceptance Criteria/Context/Constraints) in the modal — use "Open note".
- No free-form status dropdown; status changes stay action-driven.
- No editing while a work order is running.
- No changes to capture surfaces or live-run reliability (separate increments).

## Decisions

| Question | Decision |
|----------|----------|
| Config storage | Plugin settings + settings-tab UI |
| Scope | Lanes (title/order/visibility/status-map) + per-lane DoR/DoD + prompt injection |
| Roles | Deferred |
| Unmapped status | Implicit catch-all "Unsorted" lane (non-fatal warning) |
| Duplicate status across lanes | Invalid config → fall back to default + board error |
| Prompt injection target | Current lane only (DoR + DoD), guidance only |
| Board-add status | New from board → `inbox`; opens editable modal (not the note tab) |
| Modal edit scope | Frontmatter only: title, provider, model, priority |
| Inbox → ready | Explicit "Mark ready" action, validated via state machine |
| Edit while running | Disabled (read-only) |

## Data Model

New file `src/features/tasks/config/boardConfigTypes.ts`:

```ts
import type { TaskStatus, TaskSpec } from '../model/taskTypes';

export interface BoardLaneConfig {
  id: string;
  title: string;
  statuses: TaskStatus[];
  visible: boolean;
  definitionOfReady: string[];
  definitionOfDone: string[];
}

export interface BoardConfig {
  schemaVersion: 1;
  lanes: BoardLaneConfig[];
}

export interface ResolvedLane {
  id: string;
  title: string;
  tasks: TaskSpec[];
  definitionOfReady: string[];
  definitionOfDone: string[];
  isCatchAll: boolean;
}

export interface ResolvedBoardLayout {
  lanes: ResolvedLane[];
  errors: string[];
}
```

`DEFAULT_BOARD_CONFIG` reproduces the current board exactly: ten visible lanes, one per status, in `TASK_STATUSES` order, current sentence-case titles (`Inbox`, `Ready`, `Running`, `Needs input`, `Needs approval`, `Review`, `Needs fix`, `Done`, `Failed`, `Canceled`), empty DoR/DoD. With default config the board is byte-for-byte the same as today.

Settings: add optional `agentBoardConfig?: BoardConfig` to `ClaudianSettings` (`src/core/types/settings.ts`) and `DEFAULT_BOARD_CONFIG` as the default in `src/app/settings/defaultSettings.ts`.

## Architecture

Add `src/features/tasks/config/`.

### `BoardConfigStore` (deep module)

File `src/features/tasks/config/BoardConfigStore.ts`. Pure functions, no I/O — reads a plain settings object.

```ts
loadConfig(settings: Record<string, unknown>): { config: BoardConfig; errors: string[] }
getLaneForStatus(config: BoardConfig, status: TaskStatus): BoardLaneConfig | null
```

`loadConfig` normalizes and validates:

- Missing/empty `agentBoardConfig` → `DEFAULT_BOARD_CONFIG`, no errors.
- Trim titles; coerce `visible` to boolean (default `true`); coerce DoR/DoD to string arrays (drop blanks).
- Drop unknown status strings from a lane and record a warning (non-fatal).
- Blank lane `id` or `title` → **invalid** → return `DEFAULT_BOARD_CONFIG` + error.
- Same status assigned to two lanes → **invalid** → return `DEFAULT_BOARD_CONFIG` + error.
- Unmapped statuses → **not** invalid (handled by the resolver's catch-all).

Fallback target is `DEFAULT_BOARD_CONFIG` (MVP keeps no last-known-good cache).

`getLaneForStatus` returns the first lane whose `statuses` include the given status, else `null`.

### `resolveBoardLayout` (pure)

File `src/features/tasks/config/resolveBoardLayout.ts`.

```ts
resolveBoardLayout(config: BoardConfig, model: TaskBoardModel): ResolvedBoardLayout
```

- Bucket each task into the lane matching its status.
- Skip non-visible lanes (their tasks still need a home — see catch-all).
- Statuses with tasks but no visible lane → appended implicit `Unsorted` catch-all lane (`isCatchAll: true`) + a warning in `errors`. Catch-all only appears when it has tasks.
- Return lanes in configured order, catch-all last.

`model.invalidNotes` continue to render in the error area as today; they are not part of the layout.

### Renderer

`AgentBoardRenderer` drops the hardcoded `TASK_STATUSES` loop and `LANE_TITLES`. New render state:

```ts
interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
}
```

- Iterate `layout.lanes`; render title, count, cards (card markup and actions unchanged).
- Render per-lane DoR/DoD beneath the lane header when present (collapsed/compact).
- Error area shows `layout.errors` (config warnings + fallback message) and `invalidNotes` (skipped notes), keeping them visually distinct.

### View

`AgentBoardView`:

- On `refresh()`: index notes (as today), call `BoardConfigStore.loadConfig(settings)`, `resolveBoardLayout(config, model)`, pass `layout` + `invalidNotes` to the renderer. Hold the loaded `config` for the run path.
- On run: resolve the task's current lane via `getLaneForStatus(config, task.frontmatter.status)` and inject its DoR/DoD into the prompt (see below).
- Refresh on settings change: `main.ts` exposes `refreshAgentBoards()` that iterates open `VIEW_TYPE_CLAUDIAN_AGENT_BOARD` leaves and calls `view.refresh()`. The settings section calls it after `saveSettings()`.

### Prompt injection

`TaskPromptRenderer.renderTaskPrompt` gains an optional lane-criteria argument:

```ts
renderTaskPrompt(task: TaskSpec, lane?: { definitionOfReady: string[]; definitionOfDone: string[] }): string
```

- When the lane has DoR entries, insert a `## Definition of Ready` section after `## Constraints`.
- When the lane has DoD entries, insert a `## Definition of Done` section after DoR.
- Both empty (or no lane) → no new sections; output identical to today.
- Sections are framed as guidance; they grant no permissions and do not override safety policy.

`TaskRunCoordinator` is decoupled from config: replace its internal `renderTaskPrompt(task)` call with an injected `renderPrompt: (task: TaskSpec) => string` dependency (default = `renderTaskPrompt`). `AgentBoardView` injects a closure that resolves the current lane and calls `renderTaskPrompt(task, lane)`. The coordinator never imports `BoardConfigStore`.

### Settings UI

Extend `renderAgentBoardSettingsSection` (`src/features/settings/ui/AgentBoardSettingsSection.ts`) with a lane editor below the existing folder/provider/model controls:

- One block per lane: title text input, visible toggle, ten status checkboxes (the fixed `TASK_STATUSES`), DoR textarea (one entry per line), DoD textarea (one per line).
- Lane controls: move up / move down (array reorder), remove lane, "Add lane".
- "Reset to default" restores `DEFAULT_BOARD_CONFIG`.
- Every change writes `plugin.settings.agentBoardConfig`, calls `plugin.saveSettings()`, then `plugin.refreshAgentBoards()`.
- A status already checked in another lane shows an inline duplicate warning; the store still rejects dupes at load and falls back to default.

CSS: add styles for the lane editor blocks and the lane DoR/DoD display using existing Obsidian variables.

## Board Quality-of-Life

### Add work order from the board

`AgentBoardView` renders a header button ("Add work order"). It creates a work order with `status: inbox`, the settings default provider/model, title `New work order`, in the configured folder, then opens the editable detail modal for that task — it does **not** open the note in a tab. If no default provider/model is set, it shows the existing Notice guard and aborts.

`taskCommands` is parameterized so the command path and the board path share one builder:

- `buildWorkOrderMarkdown` takes a `status` argument (default `ready`).
- `createWorkOrder(plugin, source?, options?)` gains `options.status` (default `ready`) and `options.reveal` (`'note'` default, or `'none'`). Command palette entries keep `status: ready` and `reveal: 'note'`. The board path uses `status: 'inbox'` and `reveal: 'none'`, then the view opens the modal.

If the Inbox lane is hidden by config, inbox items appear in the `Unsorted` catch-all — acceptable and consistent with the coverage rule.

### Editable detail modal (frontmatter only)

`WorkOrderDetailModal` keeps its read-only sections (Objective, Acceptance criteria, Run ledger, Handoff) and gains inline frontmatter editors at the top: title (text), provider (enabled-provider dropdown), model (provider-dependent dropdown), priority (dropdown: `low`/`normal`/`high`/`urgent`).

- Edits save on change through a new `onSaveFields(task, fields)` callback → `TaskNoteStore.writeFields` → `vault.modify` → board refresh; `updated` is bumped.
- Changing provider resets the model selection and repopulates model options.
- All editors are disabled (read-only display) while `status === 'running'`.
- The modal stays decoupled from the registry: the view passes `getProviderOptions()`, `getModelOptions(providerId)`, and `onSaveFields`. Option providers wrap `ProviderRegistry` (same pattern as `AgentBoardSettingsSection`).

### Mark ready action

`inbox` cards (renderer) and the modal gain a "Mark ready" button. It routes through the existing `AgentBoardView.transitionTask(task, 'ready', 'Marked ready.')`, which validates with `canTransitionTaskStatus`. No new transition logic; the state machine keeps authority.

### `TaskNoteStore.writeFields`

New method mirroring `writeStatus` mechanics:

```ts
writeFields(content: string, fields: Partial<{ title: string; provider: string; model: string; priority: TaskPriority }>): string
```

- Parse frontmatter, set only the provided known keys, bump `updated`.
- Preserve unknown frontmatter keys, body prose, and generated regions verbatim.
- Reuse the existing frontmatter parse/`stringifyYaml` path used by `writeStatus`.

## File Structure

New:
- `src/features/tasks/config/boardConfigTypes.ts`
- `src/features/tasks/config/BoardConfigStore.ts`
- `src/features/tasks/config/resolveBoardLayout.ts`

Modify:
- `src/core/types/settings.ts` — add `agentBoardConfig?: BoardConfig`.
- `src/app/settings/defaultSettings.ts` — default `agentBoardConfig`.
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — lane editor UI.
- `src/features/tasks/ui/AgentBoardRenderer.ts` — consume `ResolvedBoardLayout`; add "Mark ready" action on inbox cards.
- `src/features/tasks/ui/AgentBoardView.ts` — load config, resolve layout, inject `renderPrompt`; "Add work order" header button; wire modal edit callbacks.
- `src/features/tasks/ui/WorkOrderDetailModal.ts` — inline frontmatter editors, "Mark ready" button, running read-only.
- `src/features/tasks/commands/taskCommands.ts` — parameterize `buildWorkOrderMarkdown`/`createWorkOrder` with `status` + `reveal`.
- `src/features/tasks/storage/TaskNoteStore.ts` — add `writeFields`.
- `src/features/tasks/prompt/TaskPromptRenderer.ts` — optional lane param.
- `src/features/tasks/execution/TaskRunCoordinator.ts` — inject `renderPrompt` dependency.
- `src/main.ts` — `refreshAgentBoards()` helper.
- CSS source — lane editor + lane criteria + modal editor styles.

## Testing Plan

TDD, mirrored under `tests/unit/features/tasks/config/` and existing paths.

### `BoardConfigStore` (unit)

- Missing config → `DEFAULT_BOARD_CONFIG`, no errors.
- Default config round-trips through normalization unchanged.
- Duplicate status across lanes → returns default + error.
- Blank lane title/id → returns default + error.
- Unknown status string dropped with warning; rest of config preserved.
- Unmapped status → valid config, no error (resolver handles it).
- `getLaneForStatus` returns the owning lane and `null` for unmapped.
- Custom titles never alter internal statuses.

### `resolveBoardLayout` (unit)

- Tasks bucket into the correct lanes by status.
- Many statuses on one lane group together.
- Non-visible lane excluded; its tasks land in catch-all.
- Catch-all appears only when unmapped statuses have tasks; placed last.
- Configured lane order preserved.

### `TaskPromptRenderer` (unit)

- DoR present → `## Definition of Ready` section present.
- DoD present → `## Definition of Done` section present.
- Both empty / no lane → output identical to current prompt.

### `TaskRunCoordinator` (unit)

- Uses injected `renderPrompt`; default behavior unchanged when no injector is given.
- Existing transition tests still pass.

### Renderer (DOM smoke)

- Renders configured lanes with custom titles and counts.
- Renders catch-all lane when present.
- Shows config errors and invalid notes in the error area.

### `TaskNoteStore.writeFields` (unit)

- Updates title/provider/model/priority and bumps `updated`.
- Preserves unknown frontmatter keys, body prose, and generated regions verbatim.
- Omitted fields are left unchanged.

### `taskCommands` (unit)

- Board path builds markdown with `status: inbox`; command path still `status: ready`.
- `reveal: 'none'` does not open the note; `reveal: 'note'` does (assert via injected/mocked workspace).
- Existing creation assertions (markers, provider/model, wiki-link) still hold.

### Non-regression

- Default config reproduces the current ten-lane board.
- Direct chat path unaffected (no new dependency on tasks/config).

## Manual Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Smoke test:

1. Open Agent Board — default ten lanes render as before.
2. Settings → Agent Board → edit lanes: rename a lane, hide one, map `review` + `needs_fix` into one lane, add DoR/DoD lines.
3. Board refreshes immediately to the new layout.
4. Create a status with no lane (e.g. hide `inbox`) and confirm those tasks appear in `Unsorted`.
5. Assign one status to two lanes; confirm the board falls back to default with a visible error.
6. Run a work order from a lane with DoR/DoD; confirm the prompt in the fresh tab includes Definition of Ready/Done sections.
7. Reset to default; confirm the board returns to the original layout.
8. Send a direct chat message without a work order; confirm chat still works.
9. Click "Add work order" on the board; confirm a new Inbox card appears and the editable modal opens (no note tab).
10. In the modal, change title/provider/model/priority; confirm the card and note frontmatter update.
11. Click "Mark ready" on the Inbox item; confirm it moves to Ready and gains a Run action.
12. Open a running work order's modal; confirm editors are read-only.

## Acceptance Criteria

- Board lanes, titles, order, visibility, and status mapping are configurable from settings.
- Many statuses can share one lane.
- Per-lane DoR/DoD can be authored and are shown on the board.
- The current lane's DoR/DoD are injected into the run prompt as guidance.
- Unmapped statuses with tasks surface in an `Unsorted` catch-all lane.
- Duplicate status mapping falls back to the default config with a board-visible error.
- Default config renders identically to the current board.
- Direct chat and existing run behavior are unchanged.
- A work order can be added from the board into the Inbox and opens in the editable modal.
- Title, provider, model, and priority are editable inline in the modal and persist to frontmatter.
- An Inbox item can be promoted to Ready with "Mark ready" and then run.
- Editors are read-only while a work order is running; body sections are never edited in the modal.

## Risks

- Settings-driven lane editor is the heaviest piece; array reorder + status checkboxes need careful state handling.
- Prompt injection changes run output; strict handoff parsing is unaffected but prompt size grows.
- Settings-save → board-refresh wiring must not couple settings to task internals beyond the `refreshAgentBoards()` helper.
- Catch-all must guarantee no task ever disappears, even under partial/invalid config.
- Modal save-on-change must not clobber concurrent note edits — `writeFields` re-reads and preserves unknown keys/body; avoid editing while running.
- Parameterizing `createWorkOrder` must keep command-palette behavior (status `ready`, opens note) unchanged.
