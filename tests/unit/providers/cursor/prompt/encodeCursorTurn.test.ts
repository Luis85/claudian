import type { ChatTurnRequest } from '@/core/runtime/types';
import { encodeCursorTurn } from '@/providers/cursor/prompt/encodeCursorTurn';

function req(overrides: Partial<ChatTurnRequest>): ChatTurnRequest {
  return { text: 'hi', ...overrides } as ChatTurnRequest;
}

describe('encodeCursorTurn', () => {
  it('turns the current note into an actionable read instruction', () => {
    const out = encodeCursorTurn(req({ currentNotePath: 'folder/note.md' }));
    expect(out.prompt).toContain('folder/note.md');
    expect(out.prompt.toLowerCase()).toContain('read it with your file tools');
    // The persisted message stays the raw user text, no injected context.
    expect(out.persistedContent).toBe('hi');
  });

  it('adds no note context when there is no current note', () => {
    const out = encodeCursorTurn(req({}));
    expect(out.prompt).toBe('hi');
  });

  it('passes /compact through untouched', () => {
    const out = encodeCursorTurn(req({ text: '/compact' }));
    expect(out.isCompact).toBe(true);
    expect(out.prompt).toBe('/compact');
  });
});
