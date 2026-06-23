import { Notice, setIcon } from 'obsidian';

import type {
  AppAgentManager,
  AppPluginManager,
} from '../../../core/providers/types';
import type { PluginInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';

export interface PluginSettingsManagerDeps {
  pluginManager: AppPluginManager;
  agentManager: Pick<AppAgentManager, 'loadAgents'>;
  restartTabs: () => Promise<void>;
}

export class PluginSettingsManager {
  private containerEl: HTMLElement;
  private pluginManager: AppPluginManager;
  private agentManager: Pick<AppAgentManager, 'loadAgents'>;
  private restartTabs: () => Promise<void>;

  constructor(containerEl: HTMLElement, deps: PluginSettingsManagerDeps) {
    this.containerEl = containerEl;
    this.pluginManager = deps.pluginManager;
    this.agentManager = deps.agentManager;
    this.restartTabs = deps.restartTabs;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'specorator-plugin-header' });
    headerEl.createSpan({ text: 'Claude Code Plugins', cls: 'specorator-plugin-label' });

    const refreshBtn = headerEl.createEl('button', {
      cls: 'specorator-settings-action-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      void this.refreshPlugins();
    });

    const plugins = this.pluginManager.getPlugins();

    if (plugins.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'specorator-plugin-empty' });
      emptyEl.setText('No Claude code plugins found. Enable plugins via the Claude CLI.');
      return;
    }

    const projectPlugins = plugins.filter(p => p.scope === 'project');
    const userPlugins = plugins.filter(p => p.scope === 'user');

    const listEl = this.containerEl.createDiv({ cls: 'specorator-plugin-list' });

    if (projectPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'specorator-plugin-section-header' });
      sectionHeader.setText('Project plugins');

      for (const plugin of projectPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }

    if (userPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'specorator-plugin-section-header' });
      sectionHeader.setText('User plugins');

      for (const plugin of userPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }
  }

  private renderPluginItem(listEl: HTMLElement, plugin: PluginInfo) {
    const itemEl = listEl.createDiv({ cls: 'specorator-plugin-item' });
    if (!plugin.enabled) {
      itemEl.addClass('specorator-plugin-item-disabled');
    }

    const statusEl = itemEl.createDiv({ cls: 'specorator-plugin-status' });
    if (plugin.enabled) {
      statusEl.addClass('specorator-plugin-status-enabled');
    } else {
      statusEl.addClass('specorator-plugin-status-disabled');
    }

    const infoEl = itemEl.createDiv({ cls: 'specorator-plugin-info' });

    const nameRow = infoEl.createDiv({ cls: 'specorator-plugin-name-row' });

    const nameEl = nameRow.createSpan({ cls: 'specorator-plugin-name' });
    nameEl.setText(plugin.name);

    const actionsEl = itemEl.createDiv({ cls: 'specorator-plugin-actions' });

    const toggleBtn = actionsEl.createEl('button', {
      cls: 'specorator-plugin-action-btn',
      attr: { 'aria-label': plugin.enabled ? 'Disable' : 'Enable' },
    });
    setIcon(toggleBtn, plugin.enabled ? 'toggle-right' : 'toggle-left');
    toggleBtn.addEventListener('click', () => {
      void this.togglePlugin(plugin.id);
    });
  }

  private async togglePlugin(pluginId: string) {
    const plugin = this.pluginManager.getPlugins().find(p => p.id === pluginId);
    const wasEnabled = plugin?.enabled ?? false;

    try {
      await this.pluginManager.togglePlugin(pluginId);
      await this.agentManager.loadAgents();

      try {
        await this.restartTabs();
      } catch {
        new Notice(t('provider.claude.plugin.toggleTabRestartFailed'));
      }

      new Notice(t(
        wasEnabled ? 'provider.claude.plugin.disabled' : 'provider.claude.plugin.enabled',
        { id: pluginId },
      ));
    } catch (err) {
      await this.pluginManager.togglePlugin(pluginId);
      const message = err instanceof Error ? err.message : 'Unknown error';
      new Notice(t('provider.claude.plugin.toggleFailed', { error: message }));
    } finally {
      this.render();
    }
  }

  private async refreshPlugins() {
    try {
      await this.pluginManager.loadPlugins();
      await this.agentManager.loadAgents();

      new Notice(t('provider.claude.plugin.listRefreshed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      new Notice(t('provider.claude.plugin.refreshFailed', { error: message }));
    } finally {
      this.render();
    }
  }

  public refresh() {
    this.render();
  }
}
