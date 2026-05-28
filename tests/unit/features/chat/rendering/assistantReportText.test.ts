import type { ChatMessage } from '@/core/types';
import { collectAssistantReportText } from '@/features/chat/rendering/assistantReportText';

function assistantMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    ...overrides,
  };
}

describe('collectAssistantReportText', () => {
  it('prefers msg.content when set', () => {
    const result = collectAssistantReportText(
      assistantMsg({ content: 'Hello from stream' }),
    );
    expect(result.text).toBe('Hello from stream');
    expect(result.hadStreamError).toBe(false);
  });

  it('falls back to text contentBlocks when msg.content is empty', () => {
    const result = collectAssistantReportText(
      assistantMsg({
        contentBlocks: [
          { type: 'text', content: '\n\n❌ **Error:** EPERM rename failed' },
        ],
      }),
    );
    expect(result.text).toContain('EPERM');
    expect(result.hadStreamError).toBe(true);
  });
});
