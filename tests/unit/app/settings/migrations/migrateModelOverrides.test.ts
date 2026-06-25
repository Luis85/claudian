import '@/providers';

import { DEFAULT_SPECORATOR_SETTINGS } from '@/app/settings/defaultSettings';
import { migrateModelOverrides } from '@/app/settings/migrations/migrateModelOverrides';
import type { SpecoratorSettings } from '@/core/types/settings';

function makeSettings(overrides: Partial<SpecoratorSettings>): SpecoratorSettings {
  return {
    ...DEFAULT_SPECORATOR_SETTINGS,
    providerConfigs: {},
    customContextLimits: {},
    customModelAliases: {},
    ...overrides,
  };
}

describe('migrateModelOverrides', () => {
  it('translates customContextLimits to per-provider customModels with source env', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000 },
    });

    const next = migrateModelOverrides(settings);

    expect(next.providerConfigs.claude?.customModels).toContainEqual({
      id: 'haiku',
      contextWindow: 200000,
      source: 'env',
    });
  });

  it('translates customModelAliases to per-provider customModels with source env', () => {
    const settings = makeSettings({
      customModelAliases: { haiku: 'My Haiku' },
    });

    const next = migrateModelOverrides(settings);

    expect(next.providerConfigs.claude?.customModels).toContainEqual({
      id: 'haiku',
      label: 'My Haiku',
      source: 'env',
    });
  });

  it('merges context window and alias for the same model id', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000 },
      customModelAliases: { haiku: 'Haiku Display' },
    });

    const next = migrateModelOverrides(settings);

    expect(next.providerConfigs.claude?.customModels).toContainEqual({
      id: 'haiku',
      label: 'Haiku Display',
      contextWindow: 200000,
      source: 'env',
    });
  });

  it('drops legacy fields after migration', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000 },
      customModelAliases: { haiku: 'Haiku Alias' },
    });

    const next = migrateModelOverrides(settings);

    expect(next.customContextLimits).toEqual({});
    expect(next.customModelAliases).toEqual({});
  });

  it('is idempotent', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000 },
      customModelAliases: { haiku: 'Haiku Alias' },
    });

    const once = migrateModelOverrides(settings);
    const twice = migrateModelOverrides(once);

    expect(twice).toEqual(once);
  });

  it('preserves existing user customModels rows', () => {
    const settings = makeSettings({
      customContextLimits: {},
      customModelAliases: {},
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'haiku', source: 'user', label: 'My Existing' },
          ],
        },
      },
    });

    const next = migrateModelOverrides(settings);

    expect(next.providerConfigs.claude?.customModels).toEqual([
      { id: 'haiku', source: 'user', label: 'My Existing' },
    ]);
  });

  it('does not add env entry if id already present in customModels (case-insensitive)', () => {
    const settings = makeSettings({
      customContextLimits: { HAIKU: 200000 },
      customModelAliases: { HAIKU: 'My Haiku' },
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'haiku', source: 'user' },
          ],
        },
      },
    });

    const next = migrateModelOverrides(settings);
    const claudeModels = next.providerConfigs.claude?.customModels as Array<{ id: string }>;

    expect(claudeModels).toHaveLength(1);
    expect(claudeModels[0]).toEqual({ id: 'haiku', source: 'user' });
  });

  it('places models under the provider that owns them', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000, 'gpt-5': 128000 },
    });

    const next = migrateModelOverrides(settings);

    expect(next.providerConfigs.claude?.customModels).toContainEqual({
      id: 'haiku',
      contextWindow: 200000,
      source: 'env',
    });
    expect(next.providerConfigs.codex?.customModels).toContainEqual({
      id: 'gpt-5',
      contextWindow: 128000,
      source: 'env',
    });
  });

  it('drops models that no provider owns', () => {
    // 'unknown-model-xyz' doesn't match any default Claude model or Codex heuristic
    const settings = makeSettings({
      customContextLimits: { 'unknown-model-xyz': 50000 },
    });

    const next = migrateModelOverrides(settings);

    // claude routes unknown by default (resolveProviderForModel falls back to claude).
    // ownsModel('unknown-model-xyz') returns false for all providers when no env vars
    // define a custom model with that id. Verify this by checking the customModels arrays.
    const allCustomModels: Array<{ id: string }> = [];
    for (const config of Object.values(next.providerConfigs)) {
      if (config?.customModels && Array.isArray(config.customModels)) {
        allCustomModels.push(...config.customModels as Array<{ id: string }>);
      }
    }

    expect(allCustomModels.find(m => m.id === 'unknown-model-xyz')).toBeUndefined();
  });

  it('handles undefined legacy maps gracefully', () => {
    const settings = makeSettings({});
    delete (settings as Record<string, unknown>).customContextLimits;
    delete (settings as Record<string, unknown>).customModelAliases;

    expect(() => migrateModelOverrides(settings)).not.toThrow();
    const next = migrateModelOverrides(settings);
    expect(next.customContextLimits).toEqual({});
    expect(next.customModelAliases).toEqual({});
  });

  it('does not mutate input settings', () => {
    const settings = makeSettings({
      customContextLimits: { haiku: 200000 },
      customModelAliases: { haiku: 'Haiku Alias' },
    });
    const inputCopy = JSON.parse(JSON.stringify(settings));

    migrateModelOverrides(settings);

    expect(settings).toEqual(inputCopy);
  });
});
