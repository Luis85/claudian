import { TASK_STATUSES } from '../model/taskStateMachine';
import type { TaskSpec, TaskStatus } from '../model/taskTypes';

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

export const DEFAULT_LANE_TITLES: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  ready: 'Ready',
  running: 'Running',
  needs_input: 'Needs input',
  needs_approval: 'Needs approval',
  review: 'Review',
  needs_fix: 'Needs fix',
  needs_handoff: 'Needs handoff',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

function freezeLane(lane: BoardLaneConfig): BoardLaneConfig {
  Object.freeze(lane.statuses);
  Object.freeze(lane.definitionOfReady);
  Object.freeze(lane.definitionOfDone);
  return Object.freeze(lane);
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = Object.freeze({
  schemaVersion: 1,
  lanes: Object.freeze(
    TASK_STATUSES.map((status) =>
      freezeLane({
        id: status,
        title: DEFAULT_LANE_TITLES[status],
        statuses: [status],
        visible: true,
        definitionOfReady: [],
        definitionOfDone: [],
      }),
    ),
  ) as BoardLaneConfig[],
}) as BoardConfig;
