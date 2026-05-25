import {
  getCachedCursorModelIds,
  parseModelListOutput,
  resetCursorModelCatalog,
  STATIC_FALLBACK_MODEL_IDS,
} from '@/providers/cursor/runtime/cursorModelCatalog';

describe('parseModelListOutput', () => {
  it('parses a JSON array of strings', () => {
    const out = JSON.stringify(['auto', 'composer-2', 'gpt-5.5']);
    expect(parseModelListOutput(out)).toEqual(['auto', 'composer-2', 'gpt-5.5']);
  });

  it('parses a JSON array of objects via id/name/model fields', () => {
    const out = JSON.stringify([
      { id: 'auto' },
      { name: 'composer-2' },
      { model: 'gemini-2.5-pro', label: 'ignored' },
    ]);
    expect(parseModelListOutput(out)).toEqual(['auto', 'composer-2', 'gemini-2.5-pro']);
  });

  it('parses a JSON object wrapping a models array', () => {
    const out = JSON.stringify({ models: ['auto', { id: 'grok-4' }] });
    expect(parseModelListOutput(out)).toEqual(['auto', 'grok-4']);
  });

  it('parses bulleted text output stripping markers and headers', () => {
    const out = [
      'Available models:',
      '* auto (current)',
      '- composer-2',
      '• composer-1.5',
      '  gpt-5.5   the fast one',
      '',
    ].join('\n');
    expect(parseModelListOutput(out)).toEqual([
      'auto',
      'composer-2',
      'composer-1.5',
      'gpt-5.5',
    ]);
  });

  it('dedupes repeated ids', () => {
    const out = 'auto\nauto\ncomposer-2';
    expect(parseModelListOutput(out)).toEqual(['auto', 'composer-2']);
  });

  it('returns an empty array for blank output', () => {
    expect(parseModelListOutput('   ')).toEqual([]);
  });
});

describe('getCachedCursorModelIds', () => {
  beforeEach(() => {
    resetCursorModelCatalog();
  });

  it('returns the static fallback when no cache is present', () => {
    expect(getCachedCursorModelIds()).toEqual([...STATIC_FALLBACK_MODEL_IDS]);
  });

  it('includes composer-1 in the fallback (not aliased away)', () => {
    expect(getCachedCursorModelIds()).toContain('composer-1');
  });
});
