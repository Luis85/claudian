import { isTaskStatus } from '../model/taskStateMachine';
import type { TaskStatus } from '../model/taskTypes';
import { type BoardConfig, type BoardLaneConfig,DEFAULT_BOARD_CONFIG } from './boardConfigTypes';

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
    return { config: DEFAULT_BOARD_CONFIG, errors: [] };
  }

  const errors: string[] = [];
  const lanes: BoardLaneConfig[] = [];
  const seen = new Set<TaskStatus>();
  const seenIds = new Set<string>();

  for (const laneRaw of candidate.lanes) {
    const lane = normalizeLane(laneRaw, errors);
    if (!lane) {
      return { config: DEFAULT_BOARD_CONFIG, errors };
    }
    if (seenIds.has(lane.id)) {
      // Lane-id collisions are structural — two lanes claiming the same id make
      // ordering, deletion, and lookup ambiguous, so we fall back to the safe
      // default. This is the only remaining fallback path; status duplicates
      // are surfaced as soft warnings further down.
      errors.push(`Lane id "${lane.id}" is used by more than one lane.`);
      return { config: DEFAULT_BOARD_CONFIG, errors };
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

  return { config: { schemaVersion: 1, lanes }, errors };
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
  };
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}
