import { QueueSlotTracker } from '../../../../../src/features/tasks/execution/QueueSlotTracker';

describe('QueueSlotTracker', () => {
  it('starts empty with the given capacity', () => {
    const t = new QueueSlotTracker(2);
    expect(t.capacity()).toBe(2);
    expect(t.occupied()).toBe(0);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('acquires up to capacity and refuses beyond', () => {
    const t = new QueueSlotTracker(2);
    expect(t.acquire('a')).toBe(true);
    expect(t.acquire('b')).toBe(true);
    expect(t.acquire('c')).toBe(false);
    expect(t.occupied()).toBe(2);
    expect(t.hasFreeSlot()).toBe(false);
  });

  it('refuses double-acquire of the same id', () => {
    const t = new QueueSlotTracker(2);
    expect(t.acquire('a')).toBe(true);
    expect(t.acquire('a')).toBe(false);
    expect(t.occupied()).toBe(1);
  });

  it('release frees a slot', () => {
    const t = new QueueSlotTracker(1);
    t.acquire('a');
    t.release('a');
    expect(t.occupied()).toBe(0);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('release for an unheld id is a no-op', () => {
    const t = new QueueSlotTracker(1);
    expect(() => t.release('ghost')).not.toThrow();
    expect(t.occupied()).toBe(0);
  });

  it('isHeld reflects current state', () => {
    const t = new QueueSlotTracker(2);
    t.acquire('a');
    expect(t.isHeld('a')).toBe(true);
    expect(t.isHeld('b')).toBe(false);
    t.release('a');
    expect(t.isHeld('a')).toBe(false);
  });

  it('setCap raises capacity without dropping in-flight', () => {
    const t = new QueueSlotTracker(1);
    t.acquire('a');
    t.setCap(3);
    expect(t.capacity()).toBe(3);
    expect(t.occupied()).toBe(1);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('coerces a non-finite cap to the minimum (cleared settings field)', () => {
    // Clearing Settings → Concurrent runs writes undefined; Math.max(1, undefined)
    // is NaN, which would freeze the queue (held.size < NaN is always false).
    const t = new QueueSlotTracker(2);
    t.setCap(undefined as unknown as number);
    expect(t.capacity()).toBe(1);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('coerces a non-finite cap at construction', () => {
    const t = new QueueSlotTracker(undefined as unknown as number);
    expect(t.capacity()).toBe(1);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('setCap shrinking below occupied keeps in-flight; refuses new acquires', () => {
    const t = new QueueSlotTracker(3);
    t.acquire('a');
    t.acquire('b');
    t.acquire('c');
    t.setCap(1);
    expect(t.capacity()).toBe(1);
    expect(t.occupied()).toBe(3);
    expect(t.hasFreeSlot()).toBe(false);
    expect(t.acquire('d')).toBe(false);
    t.release('a');
    t.release('b');
    expect(t.hasFreeSlot()).toBe(false);
    t.release('c');
    expect(t.hasFreeSlot()).toBe(true);
  });
});
