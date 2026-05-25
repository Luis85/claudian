import { formatCursorModelLabel } from '@/providers/cursor/modelLabels';

describe('formatCursorModelLabel', () => {
  it('formats Cursor-native models', () => {
    expect(formatCursorModelLabel('auto')).toBe('Auto');
    expect(formatCursorModelLabel('composer-2-fast')).toBe('Composer 2 Fast');
    expect(formatCursorModelLabel('composer-2')).toBe('Composer 2');
    expect(formatCursorModelLabel('composer-1.5')).toBe('Composer 1.5');
    expect(formatCursorModelLabel('composer-1')).toBe('Composer 1');
    expect(formatCursorModelLabel('sonic')).toBe('Sonic');
  });

  it('formats Claude models', () => {
    expect(formatCursorModelLabel('claude-sonnet-4.7')).toBe('Claude Sonnet 4.7');
    expect(formatCursorModelLabel('claude-opus-4-7')).toBe('Claude Opus 4.7');
  });

  it('formats third-party models', () => {
    expect(formatCursorModelLabel('gpt-5.5')).toBe('GPT-5.5');
    expect(formatCursorModelLabel('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(formatCursorModelLabel('grok-4')).toBe('Grok 4');
  });

  it('falls back to title-cased generic formatting', () => {
    expect(formatCursorModelLabel('some-new-model')).toBe('Some New Model');
  });
});
