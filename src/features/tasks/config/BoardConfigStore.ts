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

  for (const laneRaw of candidate.lanes) {
    const lane = normalizeLane(laneRaw, errors);
    if (!lane) {
      return { config: DEFAULT_BOARD_CONFIG, errors };
    }
    for (const status of lane.statuses) {
      if (seen.has(status)) {
        errors.push(`Status "${status}" is mapped to more than one lane.`);
        return { config: DEFAULT_BOARD_CONFIG, errors };
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

  const statuses: TaskStatus[] = [];
  if (Array.isArray(lane.statuses)) {
    for (const status of lane.statuses) {
      if (isTaskStatus(status)) statuses.push(status);
      else errors.push(`Lane "${id}" has unknown status "${String(status)}" (ignored).`);
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
