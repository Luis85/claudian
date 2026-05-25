import { resolveCursorModelForCli } from '@/providers/cursor/runtime/cursorCliModel';

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
