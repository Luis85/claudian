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
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  schemaVersion: 1,
  lanes: TASK_STATUSES.map((status) => ({
    id: status,
    title: DEFAULT_LANE_TITLES[status],
    statuses: [status],
    visible: true,
    definitionOfReady: [],
    definitionOfDone: [],
  })),
};
