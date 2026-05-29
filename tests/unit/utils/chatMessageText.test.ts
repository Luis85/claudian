import type { ChatMessage } from '@/core/types';
import { chatMessageText } from '@/utils/chatMessageText';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm', role: 'assistant', content: '', timestamp: 0, ...over,
});

describe('chatMessageText', () => {
  it('returns trimmed content for user messages', () => {
    expect(chatMessageText(msg({ role: 'user', content: '  Do the thing  ' }))).toBe('Do the thing');
  });

  it('joins assistant text blocks when content is empty', () => {
    const m = msg({
      contentBlocks: [
        { type: 'thinking', content: 'pondering' } as any,
        { type: 'text', content: 'First paragraph.' } as any,
        { type: 'tool_use', toolId: 't1' } as any,
        { type: 'text', content: 'Second paragraph.' } as any,
      ],
    });
    expect(chatMessageText(m)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('prefers explicit content over content blocks (legacy assistant messages)', () => {
    const m = msg({
      content: 'Legacy prose',
      contentBlocks: [{ type: 'text', content: 'block prose' } as any],
    });
    expect(chatMessageText(m)).toBe('Legacy prose');
  });

  it('returns empty string for a tool-only assistant turn', () => {
    const m = msg({
      contentBlocks: [{ type: 'tool_use', toolId: 't1' } as any],
    });
    expect(chatMessageText(m)).toBe('');
  });

  it('returns empty string when there is no content or blocks', () => {
    expect(chatMessageText(msg())).toBe('');
  });
});
