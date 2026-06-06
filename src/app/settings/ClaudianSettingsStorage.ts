import {
  CLAUDIAN_SETTINGS_PATH,
} from '../../core/bootstrap/StoragePaths';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type {
  ClaudianSettings,
} from '../../core/types/settings';
import { DEFAULT_CLAUDIAN_SETTINGS } from './defaultSettings';
import { migrateTabBudget } from './migrateTabBudget';
import { migrateModelOverrides } from './migrations/migrateModelOverrides';

export {
  CLAUDIAN_SETTINGS_PATH,
};

export type StoredClaudianSettings = ClaudianSettings;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
  'claudeSafeMode',
  'codexSafeMode',
  'claudeCliPath',
  'claudeCliPathsByHost',
  'codexCliPath',
  'codexCliPathsByHost',
  'codexReasoningSummary',
  'loadUserClaudeSettings',
  'codexEnabled',
  'lastClaudeModel',
  'enableChrome',
  'enableBangBash',
  'enableOpus1M',
  'enableSonnet1M',
  'environmentVariables',
  'lastEnvHash',
  'lastCodexEnvHash',
  'openInMainTab',
] as const;

function stripLegacyFields(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const key of LEGACY_STRIPPED_SETTING_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

export class ClaudianSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredClaudianSettings> {
    if (!await this.adapter.exists(CLAUDIAN_SETTINGS_PATH)) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(CLAUDIAN_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;

    // Migrate raw stored shape BEFORE the defaults merge so legacy values copy
    // forward to the new keys instead of being shadowed by the defaults.
    migrateTabBudget(stored);

    const merged = {
      ...this.getDefaults(),
      ...stripLegacyFields(stored),
    };

    const migrated = migrateModelOverrides(merged);
    const didMigrateModelOverrides = migrated !== merged;

    // Providers repair their own persisted state on load behind the generic
    // coordinator hook, so the app shell stays provider-neutral.
    const didNormalizeProviders = ProviderSettingsCoordinator.normalizeOnLoad(
      migrated as Record<string, unknown>,
    );

    if (didMigrateModelOverrides || didNormalizeProviders) {
      await this.save(migrated);
    }

    return migrated;
  }

  async save(settings: StoredClaudianSettings): Promise<void> {
    const content = JSON.stringify(
      stripLegacyFields(settings),
      null,
      2,
    );
    await this.adapter.write(CLAUDIAN_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(CLAUDIAN_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredClaudianSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  async setLastModel(model: string, isCustom: boolean): Promise<void> {
    if (isCustom) {
      await this.update({ lastCustomModel: model });
      return;
    }

    const current = await this.load();
    ProviderSettingsCoordinator.persistProviderLastModel(
      current as Record<string, unknown>,
      ProviderRegistry.resolveSettingsProviderId(current as Record<string, unknown>),
      model,
    );
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    ProviderSettingsCoordinator.persistProviderEnvironmentHash(
      current as Record<string, unknown>,
      ProviderRegistry.resolveSettingsProviderId(current as Record<string, unknown>),
      hash,
    );
    await this.save(current);
  }

  private getDefaults(): StoredClaudianSettings {
    // Spread (not the shared reference) so `providerConfigs` is materialized as a
    // writable data property here — DEFAULT_CLAUDIAN_SETTINGS exposes it as a
    // getter (ARCH-2 cycle avoidance), and returning that object directly would
    // make `settings.providerConfigs = ...` throw (getter-only) on a fresh install
    // and would let mutations clobber the shared module-level default.
    return { ...DEFAULT_CLAUDIAN_SETTINGS };
  }
}
