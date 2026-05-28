import { resolveCursorModelForCli, resolveCursorModelSelectionForCli } from '@/providers/cursor/runtime/cursorCliModel';

describe('resolveCursorModelForCli', () => {
  it('strips the cursor: prefix so the raw id reaches --model', () => {
    expect(resolveCursorModelForCli('cursor:gpt-5.5')).toBe('gpt-5.5');
    expect(resolveCursorModelForCli('cursor:auto')).toBe('auto');
    expect(resolveCursorModelForCli('cursor:composer-2-fast')).toBe('composer-2-fast');
  });

  it('passes non-namespaced ids through unchanged (legacy/back-compat)', () => {
    expect(resolveCursorModelForCli('composer-1')).toBe('composer-1');
    expect(resolveCursorModelForCli('composer-2-fast')).toBe('composer-2-fast');
    expect(resolveCursorModelForCli('auto')).toBe('auto');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveCursorModelForCli('  composer-2  ')).toBe('composer-2');
    expect(resolveCursorModelForCli('  cursor:composer-2  ')).toBe('composer-2');
  });

  it('returns undefined for empty input', () => {
    expect(resolveCursorModelForCli(undefined)).toBeUndefined();
    expect(resolveCursorModelForCli('')).toBeUndefined();
    expect(resolveCursorModelForCli('   ')).toBeUndefined();
  });

  it('returns undefined when only the prefix is present', () => {
    expect(resolveCursorModelForCli('cursor:')).toBeUndefined();
    expect(resolveCursorModelForCli('cursor:   ')).toBeUndefined();
  });
});

describe('resolveCursorModelSelectionForCli', () => {
  it('returns undefined for an empty model', () => {
    expect(resolveCursorModelSelectionForCli(undefined, 'thinking')).toBeUndefined();
  });

  it('returns the bare family for the standard mode', () => {
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', 'standard')).toBe('sonnet-4');
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', undefined)).toBe('sonnet-4');
  });

  it('appends a curated-suffix mode even when not in cache', () => {
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', 'thinking')).toBe('sonnet-4-thinking');
  });

  it('passes auto through unchanged', () => {
    expect(resolveCursorModelSelectionForCli('cursor:auto', 'thinking')).toBe('auto');
  });
});
