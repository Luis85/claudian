import {
  buildCursorFamilies,
  combineCursorModelSelection,
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  getCursorModelVariants,
  resolveCursorFamilyId,
  resolveCursorFamilyIdInCatalog,
  resolveCursorVendor,
} from '../../../../../src/providers/cursor/runtime/cursorModelFamily';

describe('resolveCursorFamilyId', () => {
  it('derives the family when the bare base id is also discovered', () => {
    const all = ['sonnet-4', 'sonnet-4-thinking'];
    expect(resolveCursorFamilyId('sonnet-4-thinking', all)).toBe('sonnet-4');
    expect(resolveCursorFamilyId('sonnet-4', all)).toBe('sonnet-4');
  });

  it('falls back to the curated suffix set when the base is absent', () => {
    expect(resolveCursorFamilyId('gpt-5-high', ['gpt-5-high'])).toBe('gpt-5');
  });

  it('keeps version-style ids whole (no false suffix split)', () => {
    expect(resolveCursorFamilyId('claude-opus-4-7', ['claude-opus-4-7'])).toBe('claude-opus-4-7');
    expect(resolveCursorFamilyId('gpt-5.5', ['gpt-5.5'])).toBe('gpt-5.5');
    expect(resolveCursorFamilyId('composer-1.5', ['composer-1.5'])).toBe('composer-1.5');
  });
});

describe('resolveCursorFamilyIdInCatalog', () => {
  it('remaps legacy claude-opus family ids to the dotted catalog taxonomy', () => {
    const known = ['claude-4.8-opus-max', 'claude-4.8-opus-high'];
    expect(resolveCursorFamilyIdInCatalog('claude-opus-4-8', known)).toBe('claude-4.8-opus');
  });

  it('keeps the requested id when it already exists in the catalog', () => {
    const known = ['claude-opus-4-8-max', 'claude-opus-4-8-high'];
    expect(resolveCursorFamilyIdInCatalog('claude-opus-4-8', known)).toBe('claude-opus-4-8');
  });
});

describe('extractCursorModeValue', () => {
  it('returns the mode token for a variant id', () => {
    expect(extractCursorModeValue('sonnet-4-thinking', ['sonnet-4', 'sonnet-4-thinking'])).toBe('thinking');
  });

  it('returns null for a bare family id', () => {
    expect(extractCursorModeValue('sonnet-4', ['sonnet-4'])).toBeNull();
  });
});

describe('combineCursorModelSelection', () => {
  it('returns the bare family for the standard mode', () => {
    expect(combineCursorModelSelection('sonnet-4', CURSOR_STANDARD_MODE)).toBe('sonnet-4');
    expect(combineCursorModelSelection('sonnet-4', '')).toBe('sonnet-4');
  });

  it('appends the mode suffix otherwise', () => {
    expect(combineCursorModelSelection('sonnet-4', 'thinking')).toBe('sonnet-4-thinking');
  });
});

describe('buildCursorFamilies', () => {
  it('groups variants under one family with ordered modes', () => {
    const families = buildCursorFamilies([
      'gpt-5', 'gpt-5-high', 'gpt-5-low',
      'sonnet-4', 'sonnet-4-thinking',
      'composer-2',
    ]);
    const gpt = families.find((f) => f.familyId === 'gpt-5');
    expect(gpt?.variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE, 'low', 'high']);
    const composer = families.find((f) => f.familyId === 'composer-2');
    expect(composer?.variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE]);
  });

  it('excludes auto', () => {
    expect(buildCursorFamilies(['auto', 'composer-2']).some((f) => f.familyId === 'auto')).toBe(false);
  });
});

describe('getCursorModelVariants', () => {
  it('returns the variants for a family', () => {
    const variants = getCursorModelVariants('sonnet-4', ['sonnet-4', 'sonnet-4-thinking']);
    expect(variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE, 'thinking']);
  });
});

describe('resolveCursorVendor', () => {
  it('maps known families to vendors', () => {
    expect(resolveCursorVendor('composer-2')).toBe('Cursor');
    expect(resolveCursorVendor('sonnet-4')).toBe('Anthropic');
    expect(resolveCursorVendor('gpt-5')).toBe('OpenAI');
    expect(resolveCursorVendor('gemini-2.5-pro')).toBe('Google');
    expect(resolveCursorVendor('grok-4')).toBe('xAI');
    expect(resolveCursorVendor('mystery-model')).toBe('Other');
  });
});
