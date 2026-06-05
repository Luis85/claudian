import type { ChatMessage } from '@/core/types';
import { deriveSeedName, isCaptureEligible } from '@/features/quickActions/captureFromMessage';

function userMsg(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: partial.id ?? 'u1',
    role: 'user',
    content: partial.content ?? '',
    displayContent: partial.displayContent,
    timestamp: 0,
    contentBlocks: partial.contentBlocks,
    images: partial.images,
  } as ChatMessage;
}

describe('isCaptureEligible', () => {
  it('is true for plain user prose', () => {
    expect(isCaptureEligible(userMsg({ content: 'Summarize this note.' }))).toBe(true);
  });

  it('is false for assistant role', () => {
    expect(isCaptureEligible({ ...userMsg({ content: 'hi' }), role: 'assistant' } as ChatMessage)).toBe(false);
  });

  it('is false when both content and displayContent are empty', () => {
    expect(isCaptureEligible(userMsg({ content: '', displayContent: '' }))).toBe(false);
  });

  it('is false for image-only messages (no text)', () => {
    expect(isCaptureEligible(userMsg({ content: '', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' } as never] }))).toBe(false);
  });

  it.each(['/compact', '$skill', '#instruction', '!ls -la'])(
    'is false for command prefix %s',
    (text) => {
      expect(isCaptureEligible(userMsg({ content: text }))).toBe(false);
    },
  );

  it('is true when text contains a slash mid-line', () => {
    expect(isCaptureEligible(userMsg({ content: 'Refactor /utils into smaller files' }))).toBe(true);
  });

  it('falls back to chatMessageText when displayContent is undefined', () => {
    expect(isCaptureEligible(userMsg({ content: 'fallback prose' }))).toBe(true);
  });

  it('prefers displayContent over content when present', () => {
    expect(isCaptureEligible(userMsg({ content: '/compact', displayContent: 'human-readable prose' }))).toBe(true);
  });
});

describe('deriveSeedName', () => {
  it('returns short text unchanged', () => {
    expect(deriveSeedName('Short title')).toBe('Short title');
  });

  it('truncates and appends an ellipsis when longer than maxLen', () => {
    const long = 'a'.repeat(80);
    const out = deriveSeedName(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
  });

  it('uses only the first line for multi-line input', () => {
    expect(deriveSeedName('first line\nsecond line')).toBe('first line');
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveSeedName('   hello world   ')).toBe('hello world');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(deriveSeedName('   \n   ')).toBe('');
  });
});
