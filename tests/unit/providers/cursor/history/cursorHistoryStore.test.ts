import { cursorWorkspaceHash } from '@/providers/cursor/history/cursorHistoryStore';

describe('cursorHistoryStore', () => {
  it('hashes workspace path with md5 hex like Cursor CLI', () => {
    expect(cursorWorkspaceHash('/Users/darmawan01/Labs/claudian')).toBe(
      '482a9f0bc2c8bac86641b6841c2dbec1',
    );
  });
});
