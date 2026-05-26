import { cursorSettingsReconciler } from '@/providers/cursor/env/CursorSettingsReconciler';

const TEST_HOST = 'host-a';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => TEST_HOST,
}));

function settings(envText: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      cursor: {
        environmentVariables: envText,
        // Curated subset for the current host; getModelOptions validates against it.
        enabledModelsByHost: { [TEST_HOST]: ['composer-2', 'gpt-5.5'] },
      },
    },
    ...extra,
  };
}

describe('cursorSettingsReconciler.reconcileModelWithEnvironment', () => {
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
