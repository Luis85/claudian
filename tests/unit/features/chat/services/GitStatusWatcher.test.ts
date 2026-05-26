import type { GitService, GitStatus } from '@/features/chat/services/GitService';
import { GitStatusWatcher } from '@/features/chat/services/GitStatusWatcher';

function makeService(statuses: GitStatus[]): GitService {
  let i = 0;
  return {
    getStatus: jest.fn(async () => statuses[Math.min(i++, statuses.length - 1)]),
  } as unknown as GitService;
}

describe('GitStatusWatcher', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('notifies a subscriber with the first polled status', async () => {
    const service = makeService([{ isRepo: true, dirtyCount: 2 }]);
    const watcher = new GitStatusWatcher(service, 1000);
    const seen: GitStatus[] = [];
    watcher.subscribe((s) => seen.push(s));
    await watcher.refresh();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ isRepo: true, dirtyCount: 2 });
    watcher.stop();
  });

  it('notifies only when status changes', async () => {
    const service = makeService([
      { isRepo: true, dirtyCount: 1 },
      { isRepo: true, dirtyCount: 1 },
      { isRepo: true, dirtyCount: 3 },
    ]);
    const watcher = new GitStatusWatcher(service, 1000);
    const cb = jest.fn();
    watcher.subscribe(cb);
    await watcher.refresh(); // 1 -> notify
    await watcher.refresh(); // 1 -> no change
    await watcher.refresh(); // 3 -> notify
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ isRepo: true, dirtyCount: 3 });
    watcher.stop();
  });

  it('polls on an interval while subscribed and stops after last unsubscribe', async () => {
    jest.useFakeTimers();
    const service = makeService([{ isRepo: true, dirtyCount: 1 }]);
    const getStatus = service.getStatus as jest.Mock;
    const watcher = new GitStatusWatcher(service, 1000);

    const unsub = watcher.subscribe(() => {});
    expect(getStatus).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    expect(getStatus).toHaveBeenCalledTimes(2);

    unsub();
    jest.advanceTimersByTime(5000);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('exposes the last known status via getLastStatus()', async () => {
    const service = makeService([{ isRepo: true, dirtyCount: 4 }]);
    const watcher = new GitStatusWatcher(service, 1000);
    expect(watcher.getLastStatus()).toBeNull();
    watcher.subscribe(() => {});
    await watcher.refresh();
    expect(watcher.getLastStatus()).toEqual({ isRepo: true, dirtyCount: 4 });
    watcher.stop();
  });
});
