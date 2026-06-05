import { ActiveRunRegistry } from '../../../../../src/features/tasks/execution/activeRunRegistry';
import type { RunSession } from '../../../../../src/features/tasks/execution/RunSession';

describe('ActiveRunRegistry', () => {
  it('tracks reserved + bound ids and exposes the live session, then clears on release', () => {
    const registry = new ActiveRunRegistry();
    const session = { cancel: jest.fn() } as unknown as RunSession;

    expect(registry.has('a')).toBe(false);

    registry.reserve('a');
    expect(registry.has('a')).toBe(true);
    expect(registry.getSession('a')).toBeUndefined();

    registry.bind('a', session);
    expect(registry.getSession('a')).toBe(session);

    registry.release('a');
    expect(registry.has('a')).toBe(false);
    expect(registry.getSession('a')).toBeUndefined();
  });
});
