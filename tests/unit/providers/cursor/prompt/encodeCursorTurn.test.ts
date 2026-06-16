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

describe('agent mention hints', () => {
  it('adds a delegation hint when the composer agent-mention token is present', () => {
    const turn = encodeCursorTurn({ text: 'Please have @reviewer (agent) check the diff.' } as ChatTurnRequest);

    expect(turn.prompt).toContain('"reviewer"');
    expect(turn.prompt).toContain('Delegate');
    // No path claim — the hint must not assert a location, since a mention can
    // be a vault, global, or built-in agent.
    expect(turn.prompt).not.toContain('.cursor/agents/');
  });

  it('deduplicates repeated mentions of the same agent', () => {
    const turn = encodeCursorTurn({
      text: '@reviewer (agent) then @reviewer (agent) again',
    } as ChatTurnRequest);

    expect(turn.prompt.match(/"reviewer"/g)).toHaveLength(1);
  });

  it('does not add a hint for plain @ text without the agent marker', () => {
    const turn = encodeCursorTurn({ text: 'email @bob and read @notes/file.md' } as ChatTurnRequest);

    expect(turn.prompt).not.toContain('Delegate');
  });
});
