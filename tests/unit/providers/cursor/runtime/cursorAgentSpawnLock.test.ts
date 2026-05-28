import {
  acquireCursorAgentSpawnLock,
} from '@/providers/cursor/runtime/cursorAgentSpawnLock';

describe('cursorAgentSpawnLock', () => {
  it('runs holders one at a time', async () => {
    const order: string[] = [];

    const first = (async () => {
      const release = await acquireCursorAgentSpawnLock();
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('first-end');
      release();
    })();

    const second = (async () => {
      const release = await acquireCursorAgentSpawnLock();
      order.push('second-start');
      release();
    })();

    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
