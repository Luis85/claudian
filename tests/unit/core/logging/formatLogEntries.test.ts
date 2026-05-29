import { formatLogEntries } from '../../../../src/core/logging/formatLogEntries';
import type { LogEntry } from '../../../../src/core/logging/types';

describe('formatLogEntries', () => {
  it('formats entries as ISO ts, level, scope, msg, and JSON args', () => {
    const entries: LogEntry[] = [
      { ts: 0, level: 'warn', scope: 'claude.runtime', msg: 'boom', args: [{ code: 400 }] },
    ];
    const out = formatLogEntries(entries);
    expect(out).toBe('1970-01-01T00:00:00.000Z  WARN  [claude.runtime]  boom  [{"code":400}]');
  });

  it('omits the args column when there are no args', () => {
    const entries: LogEntry[] = [{ ts: 0, level: 'info', scope: 'x', msg: 'hello', args: [] }];
    expect(formatLogEntries(entries)).toBe('1970-01-01T00:00:00.000Z  INFO  [x]  hello');
  });

  it('joins multiple entries with newlines', () => {
    const entries: LogEntry[] = [
      { ts: 0, level: 'info', scope: 'a', msg: 'one', args: [] },
      { ts: 0, level: 'info', scope: 'b', msg: 'two', args: [] },
    ];
    expect(formatLogEntries(entries).split('\n')).toHaveLength(2);
  });
});
