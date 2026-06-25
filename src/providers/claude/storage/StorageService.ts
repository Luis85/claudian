import type { App } from 'obsidian';

import { SpecoratorSettingsStorage, type StoredSpecoratorSettings } from '../../../app/settings/SpecoratorSettingsStorage';
import { persistTabManagerState, readTabManagerState } from '../../../app/storage/SharedStorageService';
import { SESSIONS_PATH, SessionStorage } from '../../../core/bootstrap/SessionStorage';
import { SPECORATOR_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import type { AppTabManagerState } from '../../../core/providers/types';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  SlashCommand,
} from '../../../core/types';
import {
  type CCPermissions,
  type CCSettings,
  createPermissionRule,
} from '../types/settings';
import { AGENTS_PATH, AgentVaultStorage } from './AgentVaultStorage';
import { CCSettingsStorage } from './CCSettingsStorage';
import { McpStorage } from './McpStorage';
import { SKILLS_PATH, SkillStorage } from './SkillStorage';
import { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';

export const CLAUDE_PATH = '.claude';

export interface CombinedSettings {
  cc: CCSettings;
  specorator: StoredSpecoratorSettings;
}

/** Minimal plugin surface this storage layer reads: vault access plus raw data persistence. */
interface StoragePluginHost {
  app: App;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export class StorageService {
  readonly ccSettings: CCSettingsStorage;
  readonly specoratorSettings: SpecoratorSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly sessions: SessionStorage;
  readonly mcp: McpStorage;
  readonly agents: AgentVaultStorage;

  private adapter: VaultFileAdapter;
  private plugin: StoragePluginHost;
  private app: App;

  constructor(plugin: StoragePluginHost, adapter?: VaultFileAdapter) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.adapter = adapter ?? new VaultFileAdapter(this.app);
    this.ccSettings = new CCSettingsStorage(this.adapter);
    this.specoratorSettings = new SpecoratorSettingsStorage(this.adapter);
    this.commands = new SlashCommandStorage(this.adapter);
    this.skills = new SkillStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
    this.mcp = new McpStorage(this.adapter);
    this.agents = new AgentVaultStorage(this.adapter);
  }

  async initialize(): Promise<CombinedSettings> {
    await this.ensureDirectories();

    const cc = await this.ccSettings.load();
    const specorator = await this.specoratorSettings.load();

    return { cc, specorator };
  }

  async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CLAUDE_PATH);
    await this.adapter.ensureFolder(SPECORATOR_STORAGE_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SKILLS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
    await this.adapter.ensureFolder(AGENTS_PATH);
  }

  async loadAllSlashCommands(): Promise<SlashCommand[]> {
    const commands = await this.commands.loadAll();
    const skills = await this.skills.loadAll();
    return [...commands, ...skills.map((entry) => entry.skill)];
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  async getPermissions(): Promise<CCPermissions> {
    return this.ccSettings.getPermissions();
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    return this.ccSettings.updatePermissions(permissions);
  }

  async addAllowRule(rule: string): Promise<void> {
    return this.ccSettings.addAllowRule(createPermissionRule(rule));
  }

  async addDenyRule(rule: string): Promise<void> {
    return this.ccSettings.addDenyRule(createPermissionRule(rule));
  }

  async removePermissionRule(rule: string): Promise<void> {
    return this.ccSettings.removeRule(createPermissionRule(rule));
  }

  async updateSpecoratorSettings(updates: Partial<StoredSpecoratorSettings>): Promise<void> {
    return this.specoratorSettings.update(updates);
  }

  async saveSpecoratorSettings(settings: StoredSpecoratorSettings): Promise<void> {
    return this.specoratorSettings.save(settings);
  }

  async loadSpecoratorSettings(): Promise<StoredSpecoratorSettings> {
    return this.specoratorSettings.load();
  }

  async getTabManagerState(): Promise<TabManagerPersistedState | null> {
    return readTabManagerState(this.plugin);
  }

  async setTabManagerState(state: TabManagerPersistedState): Promise<void> {
    await persistTabManagerState(this.plugin, state);
  }
}

export type TabManagerPersistedState = AppTabManagerState;
