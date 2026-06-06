import { isTaskStatus } from '../model/taskStateMachine';
import type { TaskStatus } from '../model/taskTypes';
import { type BoardConfig, type BoardLaneConfig,type BoardQueueConfig,DEFAULT_BOARD_CONFIG } from './boardConfigTypes';

export interface LoadBoardConfigResult {
  config: BoardConfig;
  errors: string[];
}

export function loadBoardConfig(settings: Record<string, unknown>): LoadBoardConfigResult {
  const raw = settings.agentBoardConfig;
  if (!raw || typeof raw !== 'object') {
    return { config: DEFAULT_BOARD_CONFIG, errors: [] };
  }

  const candidate = raw as { lanes?: unknown };
  if (!Array.isArray(candidate.lanes)) {
    // A persisted config with no lanes array — e.g. a fresh vault where only
    // queue.paused was saved — must keep the default lanes rather than collapse
    // the board to zero lanes, while still honoring the queue flag.
    return { config: defaultConfigPreservingQueue(raw), errors: [] };
  }

  const errors: string[] = [];
  const lanes: BoardLaneConfig[] = [];
  const seen = new Set<TaskStatus>();
  const seenIds = new Set<string>();

  for (const laneRaw of candidate.lanes) {
    const lane = normalizeLane(laneRaw, errors);
    if (!lane) {
      return { config: defaultConfigPreservingQueue(raw), errors };
    }
    if (seenIds.has(lane.id)) {
      // Lane-id collisions are structural — two lanes claiming the same id make
      // ordering, deletion, and lookup ambiguous, so we fall back to the safe
      // default. This is the only remaining fallback path; status duplicates
      // are surfaced as soft warnings further down.
      errors.push(`Lane id "${lane.id}" is used by more than one lane.`);
      return { config: defaultConfigPreservingQueue(raw), errors };
    }
    seenIds.add(lane.id);
    // Cross-lane status duplicates are tolerated: the user's lanes survive
    // verbatim and each duplicate occurrence emits a warning so the lane
    // editor can show an inline hint and the board can surface a notice.
    // `seen` is updated unconditionally so a later legitimate occurrence is
    // still recognised as a duplicate even when the duplicate detection short-
    // circuits earlier. (`normalizeLane` already strips intra-lane duplicates
    // before this loop runs, so `lane.statuses` is unique within itself.)
    for (const status of lane.statuses) {
      if (seen.has(status)) {
        errors.push(`Status "${status}" is mapped to more than one lane.`);
      }
      seen.add(status);
    }
    lanes.push(lane);
  }

  return { config: { schemaVersion: 1, lanes, queue: normalizeQueue(raw) }, errors };
}

export function getLaneForStatus(config: BoardConfig, status: TaskStatus): BoardLaneConfig | null {
  return config.lanes.find((lane) => lane.statuses.includes(status)) ?? null;
}

function normalizeLane(raw: unknown, errors: string[]): BoardLaneConfig | null {
  if (!raw || typeof raw !== 'object') {
    errors.push('Lane entry is not an object.');
    return null;
  }

  const lane = raw as Record<string, unknown>;
  const id = typeof lane.id === 'string' ? lane.id.trim() : '';
  const title = typeof lane.title === 'string' ? lane.title.trim() : '';
  if (!id) {
    errors.push('A lane is missing an id.');
    return null;
  }
  if (!title) {
    errors.push(`Lane "${id}" is missing a title.`);
    return null;
  }

  // Intra-lane duplicates collapse silently — a lane that lists the same
  // status twice is malformed only at storage level, never user-meaningful.
  // The cross-lane duplicate detection below only sees a clean per-lane set,
  // so a hand-edited `['ready','ready']` cannot poison `seen` for legitimate
  // owners further down the array.
  const statuses: TaskStatus[] = [];
  if (Array.isArray(lane.statuses)) {
    const dedupe = new Set<TaskStatus>();
    for (const status of lane.statuses) {
      if (!isTaskStatus(status)) {
        errors.push(`Lane "${id}" has unknown status "${String(status)}" (ignored).`);
        continue;
      }
      if (dedupe.has(status)) continue;
      dedupe.add(status);
      statuses.push(status);
    }
  }

  return {
    id,
    title,
    statuses,
    visible: lane.visible === undefined ? true : Boolean(lane.visible),
    definitionOfReady: toStringList(lane.definitionOfReady),
    definitionOfDone: toStringList(lane.definitionOfDone),
    collapsible: Boolean(lane.collapsible),
    // Gate `collapsed` on `collapsible` so a stale on-disk
    // `{ collapsible: false, collapsed: true }` (e.g. user un-checked
    // Collapsible without a re-save reaching `writeLaneCollapsed`) can never
    // resurrect a collapsed strip after load.
    collapsed: Boolean(lane.collapsible) && Boolean(lane.collapsed),
  };
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function normalizeQueue(raw: unknown): BoardQueueConfig {
  if (!raw || typeof raw !== 'object') return { paused: false };
  const queue = (raw as { queue?: unknown }).queue;
  if (!queue || typeof queue !== 'object') return { paused: false };
  return { paused: Boolean((queue as { paused?: unknown }).paused) };
}

// A structurally invalid board config still must preserve the user's queue
// pause — dropping it would silently resume auto-starting work orders. Restore
// the default lanes but carry queue.paused through from the saved config.
function defaultConfigPreservingQueue(raw: unknown): BoardConfig {
  return { ...DEFAULT_BOARD_CONFIG, queue: normalizeQueue(raw) };
}

// Mutates the settings bag in place so the caller can persist via the existing
// `plugin.saveSettings()` path. Preserves an existing config verbatim and only
// sets the queue flag. It deliberately does NOT fabricate a `lanes: []` for a
// fresh vault — an explicit empty lanes array suppresses loadBoardConfig's
// default-lane fallback and would collapse the board. When no config exists the
// result is `{ queue }` only, and loadBoardConfig restores the default lanes.
// Persists a per-lane collapsed flag through the same mutation path used by
// `writeBoardQueuePaused`. Defensive guards: an unknown lane id is a no-op
// (defends against stale UI state after a reorder/delete from another pane);
// a non-collapsible lane refuses to collapse so toggling Collapsible OFF in the
// editor cannot leave an orphan collapsed strip on the board.
export function writeLaneCollapsed(
  settings: Record<string, unknown>,
  laneId: string,
  collapsed: boolean,
): void {
  const existing = settings.agentBoardConfig;
  if (!existing || typeof existing !== 'object') return;
  const base = { ...(existing as Record<string, unknown>) };
  const lanesRaw = base.lanes;
  if (!Array.isArray(lanesRaw)) return;
  const next = lanesRaw.map((laneRaw) => {
    if (!laneRaw || typeof laneRaw !== 'object') return laneRaw;
    const lane = laneRaw as Record<string, unknown>;
    if (lane.id !== laneId) return lane;
    if (!lane.collapsible) return lane;
    return { ...lane, collapsed };
  });
  base.lanes = next;
  settings.agentBoardConfig = base;
}

export function writeBoardQueuePaused(settings: Record<string, unknown>, paused: boolean): void {
  const existing = settings.agentBoardConfig;
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
  base.queue = { paused };
  settings.agentBoardConfig = base;
}
