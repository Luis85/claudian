import { getCachedCursorModelIds } from '@/providers/cursor/runtime/cursorModelCatalog';
import { cursorSettingsReconciler } from '@/providers/cursor/env/CursorSettingsReconciler';

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

function settings(envText: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      cursor: { environmentVariables: envText },
    },
    ...extra,
  };
}

describe('cursorSettingsReconciler.reconcileModelWithEnvironment', () => {
  beforeEach(() => {
    mockedGetCachedIds.mockReturnValue(['auto', 'composer-2', 'gpt-5.5']);
  });

  it('stores the namespaced value when CURSOR_MODEL is set', () => {
    const s = settings('CURSOR_API_KEY=k\nCURSOR_MODEL=gpt-5.5');
    cursorSettingsReconciler.reconcileModelWithEnvironment(s, []);
    expect(s.model).toBe('cursor:gpt-5.5');
  });

  it('preserves a still-valid (namespaced) selection when CURSOR_MODEL is absent', () => {
    const s = settings('CURSOR_API_KEY=k', { model: 'cursor:composer-2' });
    cursorSettingsReconciler.reconcileModelWithEnvironment(s, []);
    expect(s.model).toBe('cursor:composer-2');
  });

  it('resets to the first option when the current selection is not a valid option', () => {
    const s = settings('CURSOR_API_KEY=k', { model: 'cursor:no-longer-here' });
    cursorSettingsReconciler.reconcileModelWithEnvironment(s, []);
    expect(s.model).toBe('cursor:auto');
  });

  it('resets a legacy raw value to the first namespaced option', () => {
    const s = settings('CURSOR_API_KEY=k', { model: 'composer-2' });
    cursorSettingsReconciler.reconcileModelWithEnvironment(s, []);
    expect(s.model).toBe('cursor:auto');
  });
});
