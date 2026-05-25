import { getCachedCursorModelIds } from '@/providers/cursor/runtime/cursorModelCatalog';
import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';

jest.mock('@/providers/cursor/runtime/cursorModelCatalog', () => {
  const actual = jest.requireActual('@/providers/cursor/runtime/cursorModelCatalog');
  return {
    ...actual,
    getCachedCursorModelIds: jest.fn(() => ['auto', 'composer-2', 'gpt-5.5']),
  };
});

const mockedGetCachedIds = getCachedCursorModelIds as jest.MockedFunction<
  typeof getCachedCursorModelIds
>;

function settingsWithEnv(envText: string): Record<string, unknown> {
  return {
    providerConfigs: {
      cursor: { environmentVariables: envText },
    },
  };
}

describe('cursorChatUIConfig.getModelOptions', () => {
  beforeEach(() => {
    mockedGetCachedIds.mockReturnValue(['auto', 'composer-2', 'gpt-5.5']);
  });

  it('namespaces every value with cursor: and puts auto first', () => {
    const options = cursorChatUIConfig.getModelOptions({});
    expect(options[0].value).toBe('cursor:auto');
    expect(options.map(o => o.value)).toEqual([
      'cursor:auto',
      'cursor:composer-2',
      'cursor:gpt-5.5',
    ]);
  });

  it('keeps the pretty label derived from the raw id', () => {
    const options = cursorChatUIConfig.getModelOptions({});
    expect(options.find(o => o.value === 'cursor:gpt-5.5')?.label).toBe('GPT-5.5');
  });

  it('prepends auto when discovery omits it', () => {
    mockedGetCachedIds.mockReturnValue(['composer-2']);
    const options = cursorChatUIConfig.getModelOptions({});
    expect(options[0].value).toBe('cursor:auto');
    expect(options.map(o => o.value)).toEqual(['cursor:auto', 'cursor:composer-2']);
  });

  it('appends a namespaced env CURSOR_MODEL override not present in the discovered list', () => {
    const options = cursorChatUIConfig.getModelOptions(settingsWithEnv('CURSOR_MODEL=mystery-x'));
    const env = options.find(o => o.value === 'cursor:mystery-x');
    expect(env).toBeDefined();
    expect(env?.description).toBe('Custom (env)');
    expect(options[0].value).toBe('cursor:auto');
  });

  it('does not duplicate an env CURSOR_MODEL that is already discovered', () => {
    const options = cursorChatUIConfig.getModelOptions(settingsWithEnv('CURSOR_MODEL=composer-2'));
    expect(options.filter(o => o.value === 'cursor:composer-2')).toHaveLength(1);
  });
});

describe('cursorChatUIConfig.ownsModel', () => {
  it('owns cursor:-namespaced values', () => {
    expect(cursorChatUIConfig.ownsModel('cursor:auto', {})).toBe(true);
    expect(cursorChatUIConfig.ownsModel('cursor:gpt-5.5', {})).toBe(true);
    expect(cursorChatUIConfig.ownsModel('cursor:claude-4.5-sonnet', {})).toBe(true);
  });

  it('owns legacy pre-namespace composer/auto values', () => {
    expect(cursorChatUIConfig.ownsModel('composer-2', {})).toBe(true);
    expect(cursorChatUIConfig.ownsModel('composer-1', {})).toBe(true);
    expect(cursorChatUIConfig.ownsModel('auto', {})).toBe(true);
  });

  it('does NOT own raw third-party ids (so Codex/Claude keep them)', () => {
    expect(cursorChatUIConfig.ownsModel('gpt-5.5', {})).toBe(false);
    expect(cursorChatUIConfig.ownsModel('claude-4.5-sonnet', {})).toBe(false);
    expect(cursorChatUIConfig.ownsModel('gemini-2.5-pro', {})).toBe(false);
  });
});

describe('cursorChatUIConfig.isDefaultModel', () => {
  it('recognizes namespaced fallback values', () => {
    expect(cursorChatUIConfig.isDefaultModel('cursor:auto')).toBe(true);
    expect(cursorChatUIConfig.isDefaultModel('cursor:composer-2')).toBe(true);
    expect(cursorChatUIConfig.isDefaultModel('cursor:composer-1')).toBe(true);
  });

  it('does not treat raw ids or non-fallbacks as defaults', () => {
    expect(cursorChatUIConfig.isDefaultModel('auto')).toBe(false);
    expect(cursorChatUIConfig.isDefaultModel('cursor:gpt-5.5')).toBe(false);
  });
});

describe('cursorChatUIConfig.normalizeModelVariant', () => {
  it('passes namespaced values through unchanged', () => {
    expect(cursorChatUIConfig.normalizeModelVariant('cursor:composer-1', {})).toBe('cursor:composer-1');
    expect(cursorChatUIConfig.normalizeModelVariant('cursor:composer-2', {})).toBe('cursor:composer-2');
    expect(cursorChatUIConfig.normalizeModelVariant('cursor:auto', {})).toBe('cursor:auto');
  });
});
