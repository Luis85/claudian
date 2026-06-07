import type { TaskBoardModel, TaskStatus } from '../model/taskTypes';
import type { BoardConfig, ResolvedBoardLayout, ResolvedLane } from './boardConfigTypes';

const CATCH_ALL_ID = 'unsorted';
const CATCH_ALL_TITLE = 'Unsorted';
// New work orders are created with the `inbox` status; the lane that receives
// that status hosts the add-work-order affordance.
const NEW_WORK_ORDER_STATUS: TaskStatus = 'inbox';

export function resolveBoardLayout(config: BoardConfig, model: TaskBoardModel): ResolvedBoardLayout {
  const errors: string[] = [];
  const visibleLanes = config.lanes.filter((lane) => lane.visible);

  const buckets = new Map<string, ResolvedLane>();
  const ordered: ResolvedLane[] = visibleLanes.map((lane) => {
    const resolved: ResolvedLane = {
      id: lane.id,
      title: lane.title,
      tasks: [],
      hostsNewWorkOrders: false,
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

  const catchAll: ResolvedLane = {
    id: CATCH_ALL_ID,
    title: CATCH_ALL_TITLE,
    tasks: [],
    hostsNewWorkOrders: false,
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

  // Exactly one lane hosts the add-work-order row: the lane new (inbox) work
  // orders route to. `findLane` honours duplicate mappings by returning the
  // first visible owner; when no visible lane claims inbox the catch-all owns it.
  const inboxHost = findLane(NEW_WORK_ORDER_STATUS) ?? catchAll;
  inboxHost.hostsNewWorkOrders = true;

  const lanes = [...ordered];
  // Render the catch-all when it holds unsorted tasks, or when it is the inbox
  // host (so the add-work-order row stays reachable on boards without a visible
  // Inbox lane). Only the unsorted-tasks case is worth surfacing as an error.
  if (catchAll.tasks.length > 0 || catchAll.hostsNewWorkOrders) {
    lanes.push(catchAll);
  }
  if (catchAll.tasks.length > 0) {
    errors.push('Some work orders have a status with no visible lane and appear under "Unsorted".');
  }

  return { lanes, errors };
}
