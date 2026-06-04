import { computeEnvHash } from '@/core/providers/EnvHashReconciler';
import { setProviderEnvironmentVariables } from '@/core/providers/providerEnvironment';
import { cursorSettingsReconciler } from '@/providers/cursor/env/CursorSettingsReconciler';
import {
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '@/providers/cursor/settings';

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

describe('normalizeModelVariantSettings migration', () => {
  it('collapses a persisted full-variant model to its family and seeds the mode', () => {
    const bag: Record<string, unknown> = { model: 'cursor:sonnet-4-thinking' };
    const changed = cursorSettingsReconciler.normalizeModelVariantSettings(bag);
    expect(changed).toBe(true);
    expect(bag.model).toBe('cursor:sonnet-4');
    expect(bag.effortLevel).toBe('thinking');
    expect(getCursorProviderSettings(bag).preferredModeByFamily['sonnet-4']).toBe('thinking');
  });

  it('leaves a bare family model unchanged', () => {
    const bag: Record<string, unknown> = { model: 'cursor:composer-2' };
    expect(cursorSettingsReconciler.normalizeModelVariantSettings(bag)).toBe(false);
    expect(bag.model).toBe('cursor:composer-2');
  });

  describe('setEnabled', () => {
    it('writes enabled=true into providerConfigs.cursor', () => {
      const settings: Record<string, unknown> = { providerConfigs: { cursor: { enabled: false } } };
      cursorSettingsReconciler.setEnabled?.(settings, true);
      expect(getCursorProviderSettings(settings).enabled).toBe(true);
    });

    it('writes enabled=false into providerConfigs.cursor', () => {
      const settings: Record<string, unknown> = { providerConfigs: { cursor: { enabled: true } } };
      cursorSettingsReconciler.setEnabled?.(settings, false);
      expect(getCursorProviderSettings(settings).enabled).toBe(false);
    });
  });
});

// Regression guard for the bug introduced by commit 3cc5fbd ("stop shadowing
// environmentVariables") and fixed by revert 8bd097c. The bug: dropping
// `environmentVariables` from `updateCursorProviderSettings` -> `setProviderConfig`
// caused the just-entered Cursor env to be wiped by the saveHash that runs
// inside `reconcileModelWithEnvironment` (because `setProviderConfig` REPLACES
// the provider entry, it does not merge). These tests pin the end-to-end
// contract so the regression cannot return silently.
describe('cursor env survives reconcileModelWithEnvironment → saveHash', () => {
  it('preserves environmentVariables when updateCursorProviderSettings writes only environmentHash', () => {
    const bag: Record<string, unknown> = {};
    setProviderEnvironmentVariables(bag, 'cursor', 'CURSOR_API_KEY=foo\nCURSOR_BASE_URL=https://example');

    updateCursorProviderSettings(bag, { environmentHash: 'CURSOR_API_KEY=foo' });

    expect(getCursorProviderSettings(bag).environmentVariables)
      .toBe('CURSOR_API_KEY=foo\nCURSOR_BASE_URL=https://example');
    expect(getCursorProviderSettings(bag).environmentHash).toBe('CURSOR_API_KEY=foo');
  });

  it('round-trips Cursor env through the full reconciler call (env in, env out + hash set)', () => {
    const bag: Record<string, unknown> = {};
    setProviderEnvironmentVariables(bag, 'cursor', 'CURSOR_API_KEY=foo\nCURSOR_BASE_URL=https://example');

    const { changed } = cursorSettingsReconciler.reconcileModelWithEnvironment(bag, []);

    expect(changed).toBe(true);
    const after = getCursorProviderSettings(bag);
    expect(after.environmentVariables)
      .toBe('CURSOR_API_KEY=foo\nCURSOR_BASE_URL=https://example');
    // Hash is a digest of both watched keys (sorted) — never the raw secret values.
    expect(after.environmentHash)
      .toBe(computeEnvHash('CURSOR_API_KEY=foo\nCURSOR_BASE_URL=https://example', ['CURSOR_API_KEY', 'CURSOR_BASE_URL']));
    expect(after.environmentHash).not.toContain('foo');
  });

  it('does not wipe an existing env when the hash is already up to date', () => {
    const bag: Record<string, unknown> = {};
    setProviderEnvironmentVariables(bag, 'cursor', 'CURSOR_API_KEY=foo');
    // Prime the hash (digest) so the reconciler takes the no-op branch.
    updateCursorProviderSettings(bag, { environmentHash: computeEnvHash('CURSOR_API_KEY=foo', ['CURSOR_API_KEY']) });

    const { changed } = cursorSettingsReconciler.reconcileModelWithEnvironment(bag, []);

    expect(changed).toBe(false);
    expect(getCursorProviderSettings(bag).environmentVariables).toBe('CURSOR_API_KEY=foo');
  });
});
