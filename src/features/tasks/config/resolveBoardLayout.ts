import type { TaskBoardModel, TaskStatus } from '../model/taskTypes';
import type { BoardConfig, ResolvedBoardLayout, ResolvedLane } from './boardConfigTypes';
import { DEFAULT_LANE_TITLES } from './boardConfigTypes';

const CATCH_ALL_ID = 'unsorted';
const CATCH_ALL_TITLE = 'Unsorted';

export function resolveBoardLayout(config: BoardConfig, model: TaskBoardModel): ResolvedBoardLayout {
  const errors: string[] = [];
  const visibleLanes = config.lanes.filter((lane) => lane.visible);

  const buckets = new Map<string, ResolvedLane>();
  const ordered: ResolvedLane[] = visibleLanes.map((lane) => {
    const resolved: ResolvedLane = {
      id: lane.id,
      title: lane.title,
      tasks: [],
      statuses: lane.statuses,
      definitionOfReady: lane.definitionOfReady,
      definitionOfDone: lane.definitionOfDone,
      isCatchAll: false,
      collapsible: lane.collapsible,
      // Re-gate `collapsed` here so a config that slipped past
      // `normalizeLane` (test fixtures, hand-edits) still cannot project a
      // collapsed strip onto a non-collapsible lane.
      collapsed: lane.collapsible && lane.collapsed,
    };
    buckets.set(lane.id, resolved);
    return resolved;
  });

  const findLane = (status: TaskStatus): ResolvedLane | null => {
    const lane = visibleLanes.find((candidate) => candidate.statuses.includes(status));
    return lane ? buckets.get(lane.id) ?? null : null;
  };

  // The catch-all owns every status no visible lane claims, so an affordance
  // routed by status (e.g. the Inbox add-work-order row) lands in the right
  // place when the default lanes are removed/remapped.
  const claimed = new Set<TaskStatus>();
  for (const lane of visibleLanes) for (const status of lane.statuses) claimed.add(status);
  const catchAllStatuses = (Object.keys(DEFAULT_LANE_TITLES) as TaskStatus[]).filter(
    (status) => !claimed.has(status),
  );

  const catchAll: ResolvedLane = {
    id: CATCH_ALL_ID,
    title: CATCH_ALL_TITLE,
    tasks: [],
    statuses: catchAllStatuses,
    definitionOfReady: [],
    definitionOfDone: [],
    isCatchAll: true,
    collapsible: false,
    collapsed: false,
  };

  for (const task of model.tasks) {
    const lane = findLane(task.frontmatter.status);
    if (lane) lane.tasks.push(task);
    else catchAll.tasks.push(task);
  }

  const lanes = [...ordered];
  if (catchAll.tasks.length > 0) {
    lanes.push(catchAll);
    errors.push('Some work orders have a status with no visible lane and appear under "Unsorted".');
  }

  return { lanes, errors };
}
