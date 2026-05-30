import { CURSOR_PROVIDER_CAPABILITIES } from '@/providers/cursor/capabilities';
import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';

const TEST_HOST = 'host-a';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => TEST_HOST,
}));

function settings(options: {
  enabled?: string[];
  env?: string;
} = {}): Record<string, unknown> {
  const cursor: Record<string, unknown> = {};
  if (options.enabled) {
    cursor.enabledModelsByHost = { [TEST_HOST]: options.enabled };
  }
  if (options.env !== undefined) {
    cursor.environmentVariables = options.env;
  }
  return { providerConfigs: { cursor } };
}

describe('cursorChatUIConfig.getModelOptions (curated)', () => {
  it('returns only auto when nothing is curated for the current host', () => {
    const options = cursorChatUIConfig.getModelOptions(settings());
    expect(options.map(o => o.value)).toEqual(['cursor:auto']);
  });

  it('does NOT dump the discovered catalog when no curation exists', () => {
    const options = cursorChatUIConfig.getModelOptions(settings());
    expect(options.map(o => o.value)).not.toContain('cursor:composer-2');
    expect(options.map(o => o.value)).not.toContain('cursor:gpt-5.5');
  });

  it('shows auto first then each curated raw id (namespaced)', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ enabled: ['gpt-5.5', 'composer-2'] }),
    );
    expect(options[0].value).toBe('cursor:auto');
    expect(options.map(o => o.value)).toEqual([
      'cursor:auto',
      'cursor:composer-2',
      'cursor:gpt-5.5',
    ]);
  });

  it('keeps the pretty label derived from the raw id', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ enabled: ['gpt-5.5'] }),
    );
    expect(options.find(o => o.value === 'cursor:gpt-5.5')?.label).toBe('GPT-5.5');
  });

  it('keeps a stale curated id that is not in the discovered catalog', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ enabled: ['no-longer-discovered'] }),
    );
    expect(options.map(o => o.value)).toEqual([
      'cursor:auto',
      'cursor:no-longer-discovered',
    ]);
  });

  it('appends a namespaced env CURSOR_MODEL not present in the curated list', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ enabled: ['composer-2'], env: 'CURSOR_MODEL=mystery-x' }),
    );
    const env = options.find(o => o.value === 'cursor:mystery-x');
    expect(env).toBeDefined();
    expect(env?.description).toBe('Custom (env)');
    expect(options[0].value).toBe('cursor:auto');
  });

  it('does not duplicate an env CURSOR_MODEL that is already curated', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ enabled: ['composer-2'], env: 'CURSOR_MODEL=composer-2' }),
    );
    expect(options.filter(o => o.value === 'cursor:composer-2')).toHaveLength(1);
  });

  it('still offers auto + env when curation is empty but env sets a model', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settings({ env: 'CURSOR_MODEL=mystery-x' }),
    );
    expect(options.map(o => o.value)).toEqual(['cursor:auto', 'cursor:mystery-x']);
  });

  it('merges customModels rows into the selector with contextWindow on the catalog entry', () => {
    const options = cursorChatUIConfig.getModelOptions({
      providerConfigs: {
        cursor: {
          customModels: [
            { id: 'cursor-fast', label: 'Cursor Fast', contextWindow: 500000, source: 'user' },
          ],
        },
      },
    });

    const customOption = options.find((option) => option.value === 'cursor:cursor-fast');
    expect(customOption).toBeDefined();
    expect(customOption?.label).toBe('Cursor Fast');
    expect(customOption?.contextWindow).toBe(500000);
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

describe('cursor capabilities', () => {
  it('exposes the shared effort reasoning control', () => {
    expect(CURSOR_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
  });
});

describe('cursorChatUIConfig families', () => {
  it('collapses variants into one family option', () => {
    const options = cursorChatUIConfig.getModelOptions(settings({ enabled: ['sonnet-4', 'sonnet-4-thinking'] }));
    expect(options.filter(o => o.value === 'cursor:sonnet-4')).toHaveLength(1);
    expect(options.some(o => o.value === 'cursor:sonnet-4-thinking')).toBe(false);
    expect(options[0].value).toBe('cursor:auto');
  });

  it('serves the family mode variants as reasoning options', () => {
    const s = settings({ enabled: ['sonnet-4', 'sonnet-4-thinking'] });
    expect(cursorChatUIConfig.getReasoningOptions('cursor:sonnet-4', s).map(o => o.value)).toEqual(['standard', 'thinking']);
    expect(cursorChatUIConfig.isAdaptiveReasoningModel('cursor:sonnet-4', s)).toBe(true);
  });

  it('marks a single-mode family as non-adaptive', () => {
    expect(cursorChatUIConfig.isAdaptiveReasoningModel('cursor:composer-2', settings({ enabled: ['composer-2'] }))).toBe(false);
  });

  it('persists the selected mode per family', () => {
    const s = settings({ enabled: ['sonnet-4', 'sonnet-4-thinking'] });
    cursorChatUIConfig.applyReasoningSelection?.('cursor:sonnet-4', 'thinking', s);
    expect(cursorChatUIConfig.getDefaultReasoningValue('cursor:sonnet-4', s)).toBe('thinking');
  });

  it('normalizes a full-variant model value to its family', () => {
    const s = settings({ enabled: ['sonnet-4', 'sonnet-4-thinking'] });
    expect(cursorChatUIConfig.normalizeModelVariant('cursor:sonnet-4-thinking', s)).toBe('cursor:sonnet-4');
  });
});

describe('cursorChatUIConfig defaults for families without a bare variant', () => {
  it('defaults effortLevel to the first valid mode when bare family is not real', () => {
    // claude-opus-4-7 has only -low/-medium/-high/... variants, no bare id.
    const s = settings({
      enabled: ['claude-opus-4-7-low', 'claude-opus-4-7-medium', 'claude-opus-4-7-high'],
    });
    const value = cursorChatUIConfig.getDefaultReasoningValue('cursor:claude-opus-4-7', s);
    expect(value).not.toBe('standard');
    expect(['low', 'medium', 'high']).toContain(value);
  });

  it('applyModelDefaults seeds effortLevel with a runnable mode', () => {
    const s = settings({
      enabled: ['claude-opus-4-7-low', 'claude-opus-4-7-medium', 'claude-opus-4-7-high'],
    });
    cursorChatUIConfig.applyModelDefaults('cursor:claude-opus-4-7', s);
    expect(s.effortLevel).not.toBe('standard');
    expect(['low', 'medium', 'high']).toContain(s.effortLevel as string);
  });

  it('keeps standard as the default when the bare family IS discovered', () => {
    const s = settings({ enabled: ['composer-2', 'composer-2-fast'] });
    expect(cursorChatUIConfig.getDefaultReasoningValue('cursor:composer-2', s)).toBe('standard');
  });
});
