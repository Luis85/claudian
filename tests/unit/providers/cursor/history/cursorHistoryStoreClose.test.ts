const closeSpy = jest.fn();
const allMock = jest.fn(() => [] as unknown[]);

jest.mock('node:sqlite', () => {
  class DatabaseSync {
    constructor(_path: string, _opts?: { readOnly: boolean }) {}
    prepare(_sql: string) {
      return { all: () => allMock() };
    }
    close() { closeSpy(); }
  }
  return { DatabaseSync };
}, { virtual: true });

import { loadCursorChatMessagesFromStore } from '@/providers/cursor/history/cursorHistoryStore';

describe('loadCursorChatMessagesFromStore', () => {
  beforeEach(() => {
    closeSpy.mockReset();
    allMock.mockReset();
    allMock.mockImplementation(() => []);
  });

  it('closes the SQLite handle after a successful read', () => {
    loadCursorChatMessagesFromStore('/fake/store.db');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes the SQLite handle when stmt.all() throws', () => {
    allMock.mockImplementation(() => { throw new Error('SQL boom'); });
    expect(() => loadCursorChatMessagesFromStore('/fake/store.db')).not.toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
