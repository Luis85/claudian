import {
  acquireCursorAgentSpawnLock,
  runWithCursorAgentSpawnLock,
} from '@/providers/cursor/runtime/cursorAgentSpawnLock';

describe('runWithCursorAgentSpawnLock', () => {
  it('releases the lock when the body throws', async () => {
    await expect(runWithCursorAgentSpawnLock(async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    const ok = await Promise.race([
      (async () => { const r = await acquireCursorAgentSpawnLock(); r(); return 'ok'; })(),
      new Promise<string>((resolve) => setTimeout(() => resolve('hang'), 200)),
    ]);
    expect(ok).toBe('ok');
  });

  it('serializes overlapping callers', async () => {
    const order: number[] = [];
    const a = runWithCursorAgentSpawnLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    const b = runWithCursorAgentSpawnLock(async () => {
      order.push(3);
      await new Promise((r) => setTimeout(r, 10));
      order.push(4);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
