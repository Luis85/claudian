import { EventBus } from '@/core/events/EventBus';
import type { Logger } from '@/core/logging/Logger';
import type { UsageEventMap } from '@/core/usage/events';
import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex } from '@/core/usage/types';
import { UsageTracker } from '@/core/usage/UsageTracker';

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

function makeStorage(initial?: UsageIndex) {
  const writes: UsageIndex[] = [];
  return {
    writes,
    load: jest.fn(async () => initial ?? { version: USAGE_INDEX_SCHEMA_VERSION, records: {} }),
    save: jest.fn(async (idx: UsageIndex) => {
      writes.push(JSON.parse(JSON.stringify(idx)) as UsageIndex);
    }),
  };
}

describe('UsageTracker', () => {
  let bus: EventBus<UsageEventMap>;
  let nowValue = 1_000;
  const now = () => nowValue;

  beforeEach(() => {
    jest.useFakeTimers();
    bus = new EventBus<UsageEventMap>();
    nowValue = 1_000;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('increments count + updates lastUsedAt on usage.recorded', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    nowValue = 2_000;
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });
    nowValue = 3_000;
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });

    expect(tracker.get({ kind: 'quickAction', name: 'summarize' })).toEqual({
      count: 2,
      lastUsedAt: 3_000,
    });
  });

  it('separates counters per provider for same skill name', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    bus.emit('usage.recorded', { kind: 'skill', name: 'x', providerId: 'claude' });
    bus.emit('usage.recorded', { kind: 'skill', name: 'x', providerId: 'codex' });

    expect(tracker.get({ kind: 'skill', name: 'x', providerId: 'claude' })?.count).toBe(1);
    expect(tracker.get({ kind: 'skill', name: 'x', providerId: 'codex' })?.count).toBe(1);
  });

  it('debounces writes — burst of records produces one save', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    storage.save.mockClear();

    for (let i = 0; i < 5; i++) {
      bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    }
    expect(storage.save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.writes[0].records['quickAction:_:x'].count).toBe(5);
  });

  it('flush forces immediate write + cancels pending timer', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    storage.save.mockClear();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    await tracker.flush();
    expect(storage.save).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it('clears all records on usage.cleared', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    bus.emit('usage.cleared');

    expect(tracker.getAll().size).toBe(0);
  });

  it('dispose unsubscribes so further events do not mutate state', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    tracker.dispose();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    expect(tracker.getAll().size).toBe(0);
  });

  it('hydrates initial records from storage', async () => {
    const storage = makeStorage({
      version: USAGE_INDEX_SCHEMA_VERSION,
      records: { 'quickAction:_:seed': { count: 7, lastUsedAt: 500 } },
    });
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    expect(tracker.get({ kind: 'quickAction', name: 'seed' })).toEqual({
      count: 7,
      lastUsedAt: 500,
    });
  });
});
