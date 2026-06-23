import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SESSIONS_PATH, SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { SPECORATOR_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import { validateTabManagerState } from '../../core/bootstrap/tabManagerState';
import type { AppTabManagerState } from '../../core/providers/types';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { t } from '../../i18n/i18n';
import { SpecoratorSettingsStorage, type StoredSpecoratorSettings } from '../settings/SpecoratorSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Minimal persistence surface needed to round-trip the tab layout through plugin data.json. */
interface TabManagerStateHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export async function persistTabManagerState(
  host: TabManagerStateHost,
  state: AppTabManagerState,
): Promise<void> {
  try {
    const loaded: unknown = await host.loadData();
    const data = isRecord(loaded) ? loaded : {};
    data.tabManagerState = state;
    await host.saveData(data);
  } catch {
    new Notice(t('chat.storage.tabLayoutSaveFailed'));
  }
}

export async function readTabManagerState(
  host: TabManagerStateHost,
): Promise<AppTabManagerState | null> {
  try {
    const data: unknown = await host.loadData();
    if (!isRecord(data) || !data.tabManagerState) {
      return null;
    }

    return validateTabManagerState(data.tabManagerState);
  } catch {
    return null;
  }
}

export class SharedStorageService implements SharedAppStorage {
  readonly specoratorSettings: SpecoratorSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.specoratorSettings = new SpecoratorSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  async initialize(): Promise<{ specorator: Record<string, unknown> }> {
    await this.ensureDirectories();
    const specorator = await this.specoratorSettings.load();
    return { specorator };
  }

  async saveSpecoratorSettings(settings: Record<string, unknown>): Promise<void> {
    await this.specoratorSettings.save(settings as StoredSpecoratorSettings);
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    await persistTabManagerState(this.plugin, state);
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    return readTabManagerState(this.plugin);
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(SPECORATOR_STORAGE_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }
}
