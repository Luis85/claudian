import { EventBus } from '../../../../src/core/events/EventBus';

interface TestMap {
  'thing:happened': { value: number };
  'thing:pinged': void;
}

describe('EventBus', () => {
  it('delivers the payload to a subscribed handler', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    bus.on('thing:happened', (p) => seen.push(p.value));
    bus.emit('thing:happened', { value: 7 });
    expect(seen).toEqual([7]);
  });

  it('fires every handler subscribed to an event', () => {
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('thing:happened', () => seen.push('a'));
    bus.on('thing:happened', () => seen.push('b'));
    bus.emit('thing:happened', { value: 1 });
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('stops delivering after the disposer runs', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    const dispose = bus.on('thing:happened', (p) => seen.push(p.value));
    bus.emit('thing:happened', { value: 1 });
    dispose();
    bus.emit('thing:happened', { value: 2 });
    expect(seen).toEqual([1]);
  });

  it('off removes a specific handler', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    const handler = (p: { value: number }): void => { seen.push(p.value); };
    bus.on('thing:happened', handler);
    bus.off('thing:happened', handler);
    bus.emit('thing:happened', { value: 1 });
    expect(seen).toEqual([]);
  });

  it('isolates a throwing handler from the others and the producer', () => {
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('thing:happened', () => { throw new Error('boom'); });
    bus.on('thing:happened', () => seen.push('ran'));
    expect(() => bus.emit('thing:happened', { value: 1 })).not.toThrow();
    expect(seen).toEqual(['ran']);
  });

  it('emitting with no subscribers is a no-op', () => {
    const bus = new EventBus<TestMap>();
    expect(() => bus.emit('thing:happened', { value: 1 })).not.toThrow();
  });

  it('supports void-payload events emitted with no argument', () => {
    const bus = new EventBus<TestMap>();
    let count = 0;
    bus.on('thing:pinged', () => { count += 1; });
    bus.emit('thing:pinged');
    expect(count).toBe(1);
  });

  it('routes a throwing handler to the error sink without breaking others', () => {
    const bus = new EventBus<{ ping: void }>();
    const seen: Array<{ error: unknown; event: string }> = [];
    bus.setErrorSink((error, event) => seen.push({ error, event }));

    const ok = jest.fn();
    bus.on('ping', () => { throw new Error('boom'); });
    bus.on('ping', ok);

    bus.emit('ping');

    expect(ok).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe('ping');
    expect((seen[0].error as Error).message).toBe('boom');
  });
});
