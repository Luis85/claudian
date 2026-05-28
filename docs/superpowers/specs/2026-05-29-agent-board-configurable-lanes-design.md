# Agent Board Configurable Lanes Design

Date: 2026-05-29
Status: proposed for user review
Source PRD: [[docs/issues/agent-board-mvp.md]]
Builds on: [[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design.md]]

## Summary

Make the Agent Board configurable. Replace the hardcoded one-lane-per-status board with user-defined lanes: custom titles, order, visibility, and status-to-lane mapping, plus per-lane definition of ready (DoR) and definition of done (DoD). The current run lane's DoR/DoD are injected into the run prompt as guidance.

The internal status set stays fixed (10 statuses) and the state machine is unchanged. Configuration only affects display grouping and prompt context. Roles are out of scope for this increment.

## Goals

- Store board configuration in plugin settings (`.claudian/claudian-settings.json`).
- Edit configuration through a settings-tab UI (lane editor).
- Render user-defined lanes with custom titles, order, and visibility.
- Map many internal statuses onto one lane (e.g. `review` + `needs_fix` share a lane).
- Author per-lane DoR/DoD text, shown on the board.
- Inject the current lane's DoR/DoD into the run prompt as guidance.
- Fall back to a default configuration on invalid config and surface a board-visible error.
- Preserve current board behavior when configuration is left at default.

## Non-goals

- No roles, assignees, or default-role-per-lane.
- No WIP-limit enforcement.
- No drag/drop lane movement.
- No automated enforcement of DoR/DoD checklist items.
- No custom internal statuses or custom transition graph.
- No vault-file or Markdown-note config storage.
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

## File Structure

New:
- `src/features/tasks/config/boardConfigTypes.ts`
- `src/features/tasks/config/BoardConfigStore.ts`
- `src/features/tasks/config/resolveBoardLayout.ts`

Modify:
- `src/core/types/settings.ts` — add `agentBoardConfig?: BoardConfig`.
- `src/app/settings/defaultSettings.ts` — default `agentBoardConfig`.
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — lane editor UI.
- `src/features/tasks/ui/AgentBoardRenderer.ts` — consume `ResolvedBoardLayout`.
- `src/features/tasks/ui/AgentBoardView.ts` — load config, resolve layout, inject `renderPrompt`.
- `src/features/tasks/prompt/TaskPromptRenderer.ts` — optional lane param.
- `src/features/tasks/execution/TaskRunCoordinator.ts` — inject `renderPrompt` dependency.
- `src/main.ts` — `refreshAgentBoards()` helper.
- CSS source — lane editor + lane criteria styles.

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

## Acceptance Criteria

- Board lanes, titles, order, visibility, and status mapping are configurable from settings.
- Many statuses can share one lane.
- Per-lane DoR/DoD can be authored and are shown on the board.
- The current lane's DoR/DoD are injected into the run prompt as guidance.
- Unmapped statuses with tasks surface in an `Unsorted` catch-all lane.
- Duplicate status mapping falls back to the default config with a board-visible error.
- Default config renders identically to the current board.
- Direct chat and existing run behavior are unchanged.

## Risks

- Settings-driven lane editor is the heaviest piece; array reorder + status checkboxes need careful state handling.
- Prompt injection changes run output; strict handoff parsing is unaffected but prompt size grows.
- Settings-save → board-refresh wiring must not couple settings to task internals beyond the `refreshAgentBoards()` helper.
- Catch-all must guarantee no task ever disappears, even under partial/invalid config.
