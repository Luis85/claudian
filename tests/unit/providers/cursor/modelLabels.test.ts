import { formatCursorModeLabel,formatCursorModelLabel } from '@/providers/cursor/modelLabels';

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

  it('preserves dotted version numbers in generic labels', () => {
    expect(formatCursorModelLabel('composer-2.5')).toBe('Composer 2.5');
    expect(formatCursorModelLabel('kimi-k2.5')).toBe('Kimi K2.5');
    expect(formatCursorModelLabel('grok-build-0.1')).toBe('Grok Build 0.1');
  });

  it('keeps the size variant for GPT family ids so labels stay distinct', () => {
    expect(formatCursorModelLabel('gpt-5.4-mini')).toBe('GPT-5.4 Mini');
    expect(formatCursorModelLabel('gpt-5.4-nano')).toBe('GPT-5.4 Nano');
    expect(formatCursorModelLabel('gpt-5.1-codex-mini')).toBe('GPT-5.1 Codex Mini');
    expect(formatCursorModelLabel('gpt-5.1-codex-max')).toBe('GPT-5.1 Codex Max');
    expect(formatCursorModelLabel('gpt-5.3-codex')).toBe('GPT-5.3 Codex');
  });

  it('keeps the bare GPT version when there is no extra qualifier', () => {
    expect(formatCursorModelLabel('gpt-5.1')).toBe('GPT-5.1');
    expect(formatCursorModelLabel('gpt-5-mini')).toBe('GPT-5 Mini');
  });

  it('keeps the Gemini tier when present', () => {
    expect(formatCursorModelLabel('gemini-3-flash')).toBe('Gemini 3 Flash');
    expect(formatCursorModelLabel('gemini-3.5-flash')).toBe('Gemini 3.5 Flash');
    expect(formatCursorModelLabel('gemini-3.1-pro')).toBe('Gemini 3.1 Pro');
  });
});

describe('formatCursorModeLabel', () => {
  it('formats known modes', () => {
    expect(formatCursorModeLabel('thinking')).toBe('Thinking');
    expect(formatCursorModeLabel('fast')).toBe('Fast');
    expect(formatCursorModeLabel('max')).toBe('Max');
    expect(formatCursorModeLabel('high')).toBe('High');
    expect(formatCursorModeLabel('standard')).toBe('Standard');
  });
});
