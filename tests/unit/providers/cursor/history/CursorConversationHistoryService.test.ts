import { CursorConversationHistoryService } from '@/providers/cursor/history/CursorConversationHistoryService';

describe('CursorConversationHistoryService getLastHistoryLoadError', () => {
  it('returns no error before hydration runs', () => {
    const service = new CursorConversationHistoryService();
    expect(service.getLastHistoryLoadError('conv-1')).toBeUndefined();
  });

  // Engineer note: end-to-end coverage of the redaction contract lives in
  // tests/unit/providers/cursor/history/cursorHistoryStore.test.ts, which
  // already asserts that loadCursorChatMessagesFromStoreResult never leaks
  // the raw home directory. Arranging a real Conversation + on-disk DB layout
  // inside the service test would require duplicating that surface area, so
  // we gate the getter contract here and rely on the store-level test for
  // the redaction guarantee.
});
