import {
  CLAUDIAN_SETTINGS_PATH,
} from '../../core/bootstrap/StoragePaths';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type {
  ClaudianSettings,
} from '../../core/types/settings';
import {
  updateClaudeProviderSettings,
} from '../../providers/claude/settings';
import { DEFAULT_CLAUDIAN_SETTINGS } from './defaultSettings';
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

    const merged = {
      ...this.getDefaults(),
      ...stripLegacyFields(stored),
    };

    const migrated = migrateModelOverrides(merged);
    const didMigrateModelOverrides = migrated !== merged;

    if (didMigrateModelOverrides) {
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
    updateClaudeProviderSettings(
      current,
      { lastModel: model },
    );
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updateClaudeProviderSettings(
      current,
      { environmentHash: hash },
    );
    await this.save(current);
  }

  private getDefaults(): StoredClaudianSettings {
    return DEFAULT_CLAUDIAN_SETTINGS;
  }
}
