import {
  buildCursorFamilies,
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  getCursorModelVariants,
  resolveCursorFamilyId,
} from '@/providers/cursor/runtime/cursorModelFamily';
import { REAL_CURSOR_MODEL_IDS } from '../../../../fixtures/providers/cursor/realCatalog';

describe('cursorModelFamily against the real cursor-agent catalog', () => {
  const all = REAL_CURSOR_MODEL_IDS;

  it('collapses every multi-suffix Claude Opus 4.7 variant into one family', () => {
    const variants = [
      'claude-opus-4-7-low',
      'claude-opus-4-7-low-fast',
      'claude-opus-4-7-max',
      'claude-opus-4-7-max-fast',
      'claude-opus-4-7-thinking-low',
      'claude-opus-4-7-thinking-low-fast',
      'claude-opus-4-7-thinking-max',
      'claude-opus-4-7-thinking-max-fast',
    ];
    for (const variant of variants) {
      expect(resolveCursorFamilyId(variant, all)).toBe('claude-opus-4-7');
    }
  });

  it('keeps gpt-5.1-codex-max as its own family (no bare gpt-5.1-codex)', () => {
    expect(resolveCursorFamilyId('gpt-5.1-codex-max', all)).toBe('gpt-5.1-codex-max');
    expect(resolveCursorFamilyId('gpt-5.1-codex-max-low', all)).toBe('gpt-5.1-codex-max');
    expect(resolveCursorFamilyId('gpt-5.1-codex-max-medium-fast', all)).toBe('gpt-5.1-codex-max');
  });

  it('handles the multi-token extra-high suffix on gpt-5.5', () => {
    expect(resolveCursorFamilyId('gpt-5.5-extra-high', all)).toBe('gpt-5.5');
    expect(resolveCursorFamilyId('gpt-5.5-extra-high-fast', all)).toBe('gpt-5.5');
  });

  it('preserves gpt-5.4-mini and gpt-5.4-nano as separate families from gpt-5.4', () => {
    expect(resolveCursorFamilyId('gpt-5.4-mini-low', all)).toBe('gpt-5.4-mini');
    expect(resolveCursorFamilyId('gpt-5.4-nano-none', all)).toBe('gpt-5.4-nano');
    expect(resolveCursorFamilyId('gpt-5.4-low', all)).toBe('gpt-5.4');
  });

  it('groups claude-4.6-opus high/max with their thinking + fast variants', () => {
    expect(resolveCursorFamilyId('claude-4.6-opus-high-thinking', all)).toBe('claude-4.6-opus');
    expect(resolveCursorFamilyId('claude-4.6-opus-max-thinking-fast', all)).toBe('claude-4.6-opus');
  });

  it('extracts compound modes verbatim', () => {
    expect(extractCursorModeValue('claude-opus-4-7-thinking-low-fast', all))
      .toBe('thinking-low-fast');
    expect(extractCursorModeValue('gpt-5.5-extra-high-fast', all))
      .toBe('extra-high-fast');
    expect(extractCursorModeValue('claude-4.6-opus-max-thinking', all))
      .toBe('max-thinking');
  });

  it('produces exactly 25 families (auto excluded)', () => {
    const families = buildCursorFamilies(all);
    const ids = families.map((family) => family.familyId).sort();
    expect(ids).toEqual([
      'claude-4-sonnet',
      'claude-4.5-opus',
      'claude-4.5-sonnet',
      'claude-4.6-opus',
      'claude-4.6-sonnet',
      'claude-opus-4-7',
      'composer-2',
      'composer-2.5',
      'gemini-3-flash',
      'gemini-3.1-pro',
      'gemini-3.5-flash',
      'gpt-5-mini',
      'gpt-5.1',
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.5',
      'grok-4.3',
      'grok-build-0.1',
      'kimi-k2.5',
    ]);
  });

  it('omits standard mode for families whose bare id is not discovered', () => {
    const variants = getCursorModelVariants('claude-opus-4-7', all).map((v) => v.value);
    expect(variants).not.toContain(CURSOR_STANDARD_MODE);
    expect(variants).toContain('low');
    expect(variants).toContain('thinking-max-fast');
  });

  it('keeps standard mode for families whose bare id IS discovered', () => {
    expect(getCursorModelVariants('composer-2', all).map((v) => v.value))
      .toContain(CURSOR_STANDARD_MODE);
    expect(getCursorModelVariants('gpt-5.1', all).map((v) => v.value))
      .toContain(CURSOR_STANDARD_MODE);
  });

  it('orders modes by thinking-off first, then effort, then fast', () => {
    const variants = getCursorModelVariants('claude-opus-4-7', all).map((v) => v.value);
    const lowIdx = variants.indexOf('low');
    const lowFastIdx = variants.indexOf('low-fast');
    const mediumIdx = variants.indexOf('medium');
    const thinkingLowIdx = variants.indexOf('thinking-low');
    expect(lowIdx).toBeGreaterThanOrEqual(0);
    expect(lowFastIdx).toBeGreaterThan(lowIdx);
    expect(mediumIdx).toBeGreaterThan(lowFastIdx);
    expect(thinkingLowIdx).toBeGreaterThan(mediumIdx);
  });
});
