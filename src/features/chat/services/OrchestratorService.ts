import type { TabId } from '../tabs/types';

// Truncate worker results to prevent unbounded message growth in Orchestrator mode.
// Large results accumulate in chat history and cause Windows spawn ENAMETOOLONG (issue #8).
// Budget: 5 concurrent workers x 4,000 chars = 20,000 chars accumulated, safely under
// Windows' 32,768 cmd.exe limit even with flag args and workspace paths.
const MAX_WORKER_RESULT_CHARS = 4_000;

// Preserve head and tail when truncating: worker conclusions (summary, decision) are
// typically at the end, so dropping only the middle preserves the synthesis-relevant content.
const TRUNCATION_HEAD_CHARS = 2_500;
const TRUNCATION_TAIL_CHARS = 1_500;

export interface OrchestratorServiceDeps {
  sendToTab: (tabId: TabId, message: string) => void;
}

interface WorkerMeta {
  orchestratorTabId: TabId;
  description: string;
  done: boolean;
}

export class OrchestratorService {
  private deps: OrchestratorServiceDeps;
  private workerSets = new Map<TabId, Set<TabId>>();
  private workerMeta = new Map<TabId, WorkerMeta>();

  constructor(deps: OrchestratorServiceDeps) {
    this.deps = deps;
  }

  registerWorker(orchestratorTabId: TabId, workerTabId: TabId, description: string): void {
    if (!this.workerSets.has(orchestratorTabId)) {
      this.workerSets.set(orchestratorTabId, new Set());
    }
    this.workerSets.get(orchestratorTabId)!.add(workerTabId);
    this.workerMeta.set(workerTabId, { orchestratorTabId, description, done: false });
  }

  reportResult(workerTabId: TabId, result: string, isError = false): void {
    const meta = this.workerMeta.get(workerTabId);
    if (!meta || meta.done) {
      return;
    }
    meta.done = true;

    if (!this.workerSets.has(meta.orchestratorTabId)) {
      return;
    }

    const truncatedResult = truncateWorkerResult(result);
    const label = isError
      ? `Worker '${meta.description}' failed: ${truncatedResult}`
      : `Worker '${meta.description}' finished: ${truncatedResult}`;
    this.deps.sendToTab(meta.orchestratorTabId, label);
    this.checkAllDone(meta.orchestratorTabId);
  }

  handleTabClosed(tabId: TabId): void {
    const meta = this.workerMeta.get(tabId);
    if (meta && !meta.done) {
      meta.done = true;
      if (this.workerSets.has(meta.orchestratorTabId)) {
        this.deps.sendToTab(
          meta.orchestratorTabId,
          `Worker '${meta.description}' was closed before completing.`,
        );
        this.checkAllDone(meta.orchestratorTabId);
      }
    }
    this.workerMeta.delete(tabId);

    const fleet = this.workerSets.get(tabId);
    if (fleet) {
      for (const workerId of fleet) {
        this.workerMeta.delete(workerId);
      }
      this.workerSets.delete(tabId);
    }
  }

  getOrchestratorTabId(workerTabId: TabId): TabId | null {
    return this.workerMeta.get(workerTabId)?.orchestratorTabId ?? null;
  }

  private checkAllDone(orchestratorTabId: TabId): void {
    const workers = this.workerSets.get(orchestratorTabId);
    if (!workers) {
      return;
    }
    // Treat missing meta as done: `handleTabClosed` deletes meta after notifying the
    // orchestrator, so a deleted entry means the worker already reported (or closed).
    const allDone = [...workers].every((id) => {
      const m = this.workerMeta.get(id);
      return !m || m.done === true;
    });
    if (!allDone) {
      return;
    }
    this.deps.sendToTab(orchestratorTabId, 'All workers have reported. Please synthesize.');
    for (const workerId of workers) {
      this.workerMeta.delete(workerId);
    }
    this.workerSets.delete(orchestratorTabId);
  }
}

function truncateWorkerResult(result: string): string {
  if (result.length <= MAX_WORKER_RESULT_CHARS) {
    return result;
  }
  const head = result.slice(0, TRUNCATION_HEAD_CHARS);
  const tail = result.slice(-TRUNCATION_TAIL_CHARS);
  const elidedChars = result.length - TRUNCATION_HEAD_CHARS - TRUNCATION_TAIL_CHARS;
  return `${head}\n\n... [${elidedChars} chars elided, ${result.length} total] ...\n\n${tail}`;
}
