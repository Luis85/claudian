import { EventBus } from '@/core/events/EventBus';
import type { Logger } from '@/core/logging/Logger';
import type { UsageEventMap } from '@/core/usage/events';
import { serializeKey } from '@/core/usage/keys';
import { UsageStorage } from '@/core/usage/UsageStorage';
import { UsageTracker } from '@/core/usage/UsageTracker';

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

function makeFakeAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
    ensureFolder: async () => undefined,
  };
}

describe('usage tracker end-to-end', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('records → debounces → persists → reload sees the count', async () => {
    const adapter = makeFakeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const bus = new EventBus<UsageEventMap>();
    let now = 100_000;
    const tracker = new UsageTracker(bus, storage, () => now, silentLogger());
    await tracker.hydrate();
    tracker.start();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });
    now = 200_000;
    bus.emit('usage.recorded', { kind: 'skill', name: 'deep-research', providerId: 'claude' });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.files.get('.claudian/usage.json')).toBeDefined();

    // Simulate plugin reload: dispose, rebuild from disk.
    tracker.dispose();
    const bus2 = new EventBus<UsageEventMap>();
    const tracker2 = new UsageTracker(bus2, storage, () => now, silentLogger());
    await tracker2.hydrate();
    tracker2.start();

    expect(tracker2.get({ kind: 'quickAction', name: 'summarize' }))
      .toEqual({ count: 1, lastUsedAt: 100_000 });
    expect(tracker2.get({ kind: 'skill', name: 'deep-research', providerId: 'claude' }))
      .toEqual({ count: 1, lastUsedAt: 200_000 });
    tracker2.dispose();
  });

  it('usage.cleared wipes the persisted index', async () => {
    const adapter = makeFakeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const bus = new EventBus<UsageEventMap>();
    const tracker = new UsageTracker(bus, storage, () => 0, silentLogger());
    await tracker.hydrate();
    tracker.start();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    await tracker.flush();
    expect(JSON.parse(adapter.files.get('.claudian/usage.json')!).records[
      serializeKey({ kind: 'quickAction', name: 'x' })
    ]).toBeDefined();

    bus.emit('usage.cleared');
    await tracker.flush();
    expect(JSON.parse(adapter.files.get('.claudian/usage.json')!).records).toEqual({});
    tracker.dispose();
  });
});
