import { LedgerWriter } from '../../../../../src/features/tasks/execution/LedgerWriter';
import type { TaskLedgerEntry } from '../../../../../src/features/tasks/model/taskTypes';

function entry(message: string, ts = '2026-06-04T10:00:00Z'): TaskLedgerEntry {
  return { timestamp: ts, status: 'running', message };
}

describe('LedgerWriter', () => {
  it('batches entries and flushes on the interval', async () => {
    jest.useFakeTimers();
    const flushed: TaskLedgerEntry[][] = [];
    const writer = new LedgerWriter({
      flush: async (entries) => { flushed.push(entries); },
      intervalMs: 5000,
      milestoneThreshold: 3,
    });
    writer.enqueue(entry('a'));
    writer.enqueue(entry('b'));
    expect(flushed).toEqual([]);
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(flushed.flat().map((e) => e.message)).toEqual(['a', 'b']);
    writer.dispose();
    jest.useRealTimers();
  });

  it('force-flushes when queue reaches the milestone threshold', async () => {
    const flushed: TaskLedgerEntry[][] = [];
    const writer = new LedgerWriter({
      flush: async (entries) => { flushed.push(entries); },
      intervalMs: 60000,
      milestoneThreshold: 2,
    });
    writer.enqueue(entry('a'));
    writer.enqueue(entry('b'));
    await new Promise((r) => setTimeout(r, 0));
    expect(flushed.flat().map((e) => e.message)).toEqual(['a', 'b']);
    writer.dispose();
  });

  it('exposes the recent tail bounded to 20 entries', () => {
    const writer = new LedgerWriter({ flush: async () => {}, intervalMs: 60000, milestoneThreshold: 999 });
    for (let i = 0; i < 25; i++) writer.enqueue(entry(`m${i}`));
    expect(writer.tail().length).toBe(20);
    expect(writer.tail()[0].message).toBe('m5');
    expect(writer.tail()[19].message).toBe('m24');
    writer.dispose();
  });

  it('flushes entries queued during an in-flight flush instead of dropping them', async () => {
    let release!: () => void;
    const flushed: string[] = [];
    let calls = 0;
    const writer = new LedgerWriter({
      flush: async (entries) => {
        calls += 1;
        if (calls === 1) await new Promise<void>((r) => { release = r; });
        for (const e of entries) flushed.push(e.message);
      },
      intervalMs: 60000,
      milestoneThreshold: 999,
    });
    writer.enqueue(entry('a'));
    const firstFlush = writer.flushNow(); // starts flushing [a], then blocks
    writer.enqueue(entry('b')); // queued while [a] is in-flight
    const secondFlush = writer.flushNow(); // must wait for [a], then flush [b]
    release();
    await Promise.all([firstFlush, secondFlush]);
    expect(flushed).toEqual(['a', 'b']);
    writer.dispose();
  });

  it('retries a failed flush with backoff and drops after two attempts', async () => {
    jest.useFakeTimers();
    let attempts = 0;
    const degraded = jest.fn();
    const writer = new LedgerWriter({
      flush: async () => { attempts += 1; throw new Error('boom'); },
      intervalMs: 5000,
      milestoneThreshold: 999,
      onDegraded: degraded,
    });
    writer.enqueue(entry('x'));
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); await Promise.resolve();
    expect(attempts).toBe(1);
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); await Promise.resolve();
    expect(attempts).toBe(2);
    jest.advanceTimersByTime(30000);
    await Promise.resolve(); await Promise.resolve();
    expect(degraded).toHaveBeenCalledTimes(1);
    writer.dispose();
    jest.useRealTimers();
  });
});
