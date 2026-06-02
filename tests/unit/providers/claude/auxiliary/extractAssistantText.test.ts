import { extractAssistantText } from '@/providers/claude/auxiliary/extractAssistantText';

describe('extractAssistantText', () => {
  it('returns empty string when message type is not assistant (user)', () => {
    const message = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'hello' }] },
    };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when message type is system', () => {
    const message = {
      type: 'system',
      message: { content: [{ type: 'text', text: 'hello' }] },
    };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string for unknown non-assistant type (e.g. permission_denied)', () => {
    const message = {
      type: 'permission_denied',
      message: { content: [{ type: 'text', text: 'denied' }] },
    };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload is undefined', () => {
    const message = { type: 'assistant' };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload is null', () => {
    const message = { type: 'assistant', message: null };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload is a string', () => {
    const message = { type: 'assistant', message: 'Permission denied' };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload is a number', () => {
    const message = { type: 'assistant', message: 42 };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload is an array', () => {
    const message = { type: 'assistant', message: [] as unknown };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload.content is missing', () => {
    const message = { type: 'assistant', message: {} };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload.content is not an array (string)', () => {
    const message = { type: 'assistant', message: { content: 'oops' } };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns empty string when payload.content is an empty array', () => {
    const message = { type: 'assistant', message: { content: [] } };

    expect(extractAssistantText(message)).toBe('');
  });

  it('returns the text from a single text block', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    };

    expect(extractAssistantText(message)).toBe('Hello world');
  });

  it('concatenates text from multiple text blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
          { type: 'text', text: '!' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Hello world!');
  });

  it('returns only text-block contents when content mixes text and non-text blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Before tool. ' },
          { type: 'tool_use', id: 'tool_1', name: 'Read', input: { path: '/x' } },
          { type: 'text', text: 'After tool.' },
          { type: 'thinking', thinking: 'reasoning' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Before tool. After tool.');
  });

  it('skips text blocks that are missing the text field', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Kept. ' },
          { type: 'text' },
          { type: 'text', text: 'Also kept.' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Kept. Also kept.');
  });

  it('skips text blocks where the text field is not a string', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Kept. ' },
          { type: 'text', text: 123 },
          { type: 'text', text: null },
          { type: 'text', text: 'Also kept.' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Kept. Also kept.');
  });

  it('skips null blocks within the content array', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          null,
          { type: 'text', text: 'world' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Hello world');
  });

  it('skips array blocks within the content array', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          ['nested', 'array'],
          { type: 'text', text: 'world' },
        ],
      },
    };

    expect(extractAssistantText(message)).toBe('Hello world');
  });
});
