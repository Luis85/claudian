import type { App } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

import { tryParseClipboardConfig } from '../../../core/mcp/McpConfigParser';
import { collectMissingMcpSecrets, extractMcpServerSecrets, type MissingMcpSecret } from '../../../core/mcp/mcpSecrets';
import { testMcpServer } from '../../../core/mcp/McpTester';
import type { AppMcpStorage } from '../../../core/providers/types';
import { isClaudianGeneratedSecretId } from '../../../core/security/secretIds';
import type { SecretStore } from '../../../core/security/secretStore';
import type { ManagedMcpServer, McpServerConfig, McpServerType } from '../../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { confirmDelete } from '../../../shared/modals/ConfirmModal';
import { McpServerModal } from './McpServerModal';
import { McpTestModal } from './McpTestModal';

export interface McpSettingsManagerDeps {
  app: App;
  mcpStorage: AppMcpStorage;
  /** SEC-A Phase 3: keychain store for migrating/resolving MCP secret headers/env. */
  secretStore: SecretStore;
  broadcastMcpReload: () => Promise<void>;
  /** SEC-A Phase 3: surface a re-entry warning for secret refs absent on this device. */
  warnMissingMcpSecrets?: (missing: MissingMcpSecret[]) => void;
}

export class McpSettingsManager {
  private app: App;
  private containerEl: HTMLElement;
  private mcpStorage: AppMcpStorage;
  private secretStore: SecretStore;
  private broadcastMcpReload: () => Promise<void>;
  private warnMissingMcpSecrets?: (missing: MissingMcpSecret[]) => void;
  private servers: ManagedMcpServer[] = [];

  constructor(containerEl: HTMLElement, deps: McpSettingsManagerDeps) {
    this.app = deps.app;
    this.containerEl = containerEl;
    this.mcpStorage = deps.mcpStorage;
    this.secretStore = deps.secretStore;
    this.broadcastMcpReload = deps.broadcastMcpReload;
    this.warnMissingMcpSecrets = deps.warnMissingMcpSecrets;
    void this.loadAndRender();
  }

  /**
   * SEC-A Phase 3: persist servers, first migrating any secret-shaped header/env
   * value typed into the editor into SecretStorage so it never lands in plaintext.
   */
  private async persistServers(): Promise<void> {
    extractMcpServerSecrets(this.servers, this.secretStore);
    await this.mcpStorage.save(this.servers);
  }

  /** All SecretStorage ids still referenced by the loaded servers. */
  private referencedSecretIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.servers) {
      for (const id of Object.values(s.secretHeaders ?? {})) ids.add(id);
      for (const id of Object.values(s.secretEnv ?? {})) ids.add(id);
    }
    return ids;
  }

  /**
   * SEC-A Phase 3: clear keychain values for a removed/edited server's secret refs
   * that no remaining server references, so a deleted credential doesn't linger.
   */
  private clearOrphanedSecrets(removed: ManagedMcpServer | null): void {
    if (!removed) return;
    const removedIds = [
      ...Object.values(removed.secretHeaders ?? {}),
      ...Object.values(removed.secretEnv ?? {}),
    ];
    if (removedIds.length === 0) return;
    const stillReferenced = this.referencedSecretIds();
    for (const id of removedIds) {
      // SecretStorage ids are global across plugins. The metadata may point at an
      // external/user-selected id (e.g. a hand-edited mcp.json), so only auto-clear
      // Claudian-owned ids — never a secret another plugin or workflow owns.
      if (!isClaudianGeneratedSecretId(id)) continue;
      if (!stillReferenced.has(id)) this.secretStore.clear(id);
    }
  }

  private async loadAndRender() {
    this.servers = await this.mcpStorage.load();
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-mcp-header' });
    headerEl.createSpan({ text: 'MCP Servers', cls: 'claudian-mcp-label' });

    const addContainer = headerEl.createDiv({ cls: 'claudian-mcp-add-container' });
    const addBtn = addContainer.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': 'Add' },
    });
    setIcon(addBtn, 'plus');

    const dropdown = addContainer.createDiv({ cls: 'claudian-mcp-add-dropdown' });

    const stdioOption = dropdown.createDiv({ cls: 'claudian-mcp-add-option' });
    setIcon(stdioOption.createSpan({ cls: 'claudian-mcp-add-option-icon' }), 'terminal');
    stdioOption.createSpan({ text: 'stdio (local command)' });
    stdioOption.addEventListener('click', () => {
      dropdown.removeClass('is-visible');
      this.openModal(null, 'stdio');
    });

    const httpOption = dropdown.createDiv({ cls: 'claudian-mcp-add-option' });
    setIcon(httpOption.createSpan({ cls: 'claudian-mcp-add-option-icon' }), 'globe');
    httpOption.createSpan({ text: 'http / sse (remote)' });
    httpOption.addEventListener('click', () => {
      dropdown.removeClass('is-visible');
      this.openModal(null, 'http');
    });

    const importOption = dropdown.createDiv({ cls: 'claudian-mcp-add-option' });
    setIcon(importOption.createSpan({ cls: 'claudian-mcp-add-option-icon' }), 'clipboard-paste');
    importOption.createSpan({ text: 'Import from clipboard' });
    importOption.addEventListener('click', () => {
      dropdown.removeClass('is-visible');
      void this.importFromClipboard();
    });

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.toggleClass('is-visible', !dropdown.hasClass('is-visible'));
    });

    (this.containerEl.ownerDocument ?? window.document).addEventListener('click', () => {
      dropdown.removeClass('is-visible');
    });

    if (this.servers.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-mcp-empty' });
      emptyEl.setText('No mcp servers configured. Click "add" to add one.');
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-mcp-list' });
    for (const server of this.servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'claudian-mcp-item' });
    if (!server.enabled) {
      itemEl.addClass('claudian-mcp-item-disabled');
    }

    const statusEl = itemEl.createDiv({ cls: 'claudian-mcp-status' });
    statusEl.addClass(
      server.enabled ? 'claudian-mcp-status-enabled' : 'claudian-mcp-status-disabled'
    );

    const infoEl = itemEl.createDiv({ cls: 'claudian-mcp-info' });

    const nameRow = infoEl.createDiv({ cls: 'claudian-mcp-name-row' });

    const nameEl = nameRow.createSpan({ cls: 'claudian-mcp-name' });
    nameEl.setText(server.name);

    const serverType = getMcpServerType(server.config);
    const typeEl = nameRow.createSpan({ cls: 'claudian-mcp-type-badge' });
    typeEl.setText(serverType);

    if (server.contextSaving) {
      const csEl = nameRow.createSpan({ cls: 'claudian-mcp-context-saving-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', 'Context-saving: mention with @' + server.name + ' to enable');
    }

    const previewEl = infoEl.createDiv({ cls: 'claudian-mcp-preview' });
    if (server.description) {
      previewEl.setText(server.description);
    } else {
      previewEl.setText(this.getServerPreview(server, serverType));
    }

    const actionsEl = itemEl.createDiv({ cls: 'claudian-mcp-actions' });

    const testBtn = actionsEl.createEl('button', {
      cls: 'claudian-mcp-action-btn',
      attr: { 'aria-label': 'Verify (show tools)' },
    });
    setIcon(testBtn, 'zap');
    testBtn.addEventListener('click', () => {
      void this.testServer(server);
    });

    const toggleBtn = actionsEl.createEl('button', {
      cls: 'claudian-mcp-action-btn',
      attr: { 'aria-label': server.enabled ? 'Disable' : 'Enable' },
    });
    setIcon(toggleBtn, server.enabled ? 'toggle-right' : 'toggle-left');
    toggleBtn.addEventListener('click', () => {
      void this.toggleServer(server);
    });

    const editBtn = actionsEl.createEl('button', {
      cls: 'claudian-mcp-action-btn',
      attr: { 'aria-label': 'Edit' },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.openModal(server));

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'claudian-mcp-action-btn claudian-mcp-delete-btn',
      attr: { 'aria-label': 'Delete' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => {
      void this.deleteServer(server);
    });
  }

  private async testServer(server: ManagedMcpServer) {
    const modal = new McpTestModal(
      this.app,
      server.name,
      server.disabledTools,
      async (toolName, enabled) => {
        await this.updateDisabledTool(server, toolName, enabled);
      },
      async (disabledTools) => {
        await this.updateAllDisabledTools(server, disabledTools);
      }
    );
    modal.open();

    try {
      const result = await testMcpServer(server, (id) => this.secretStore.get(id));
      modal.setResult(result);
    } catch (error) {
      modal.setError(error instanceof Error ? error.message : 'Verification failed');
    }
  }

  /** Rolls back on save failure; warns on reload failure (since save succeeded). */
  private async updateServerDisabledTools(
    server: ManagedMcpServer,
    newDisabledTools: string[] | undefined
  ): Promise<void> {
    const previous = server.disabledTools ? [...server.disabledTools] : undefined;
    server.disabledTools = newDisabledTools;

    try {
      await this.persistServers();
    } catch (error) {
      server.disabledTools = previous;
      throw error;
    }

    try {
      await this.broadcastMcpReload();
    } catch {
      // Save succeeded but reload failed - don't rollback since disk has correct state
      new Notice(t('settings.mcp.reloadFailed'));
    }
  }

  private async updateDisabledTool(
    server: ManagedMcpServer,
    toolName: string,
    enabled: boolean
  ) {
    const disabledTools = new Set(server.disabledTools ?? []);
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await this.updateServerDisabledTools(
      server,
      disabledTools.size > 0 ? Array.from(disabledTools) : undefined
    );
  }

  private async updateAllDisabledTools(server: ManagedMcpServer, disabledTools: string[]) {
    await this.updateServerDisabledTools(
      server,
      disabledTools.length > 0 ? disabledTools : undefined
    );
  }

  private getServerPreview(server: ManagedMcpServer, type: McpServerType): string {
    if (type === 'stdio') {
      const config = server.config as { command: string; args?: string[] };
      const args = config.args?.join(' ') || '';
      return args ? `${config.command} ${args}` : config.command;
    } else {
      const config = server.config as { url: string };
      return config.url;
    }
  }

  private openModal(existing: ManagedMcpServer | null, initialType?: McpServerType) {
    const modal = new McpServerModal(
      this.app,
      existing,
      (server) => {
        void this.saveServer(server, existing).catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : t('settings.mcp.saveFailed'));
        });
      },
      initialType
    );
    modal.open();
  }

  private async importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        new Notice(t('settings.mcp.clipboardEmpty'));
        return;
      }

      const parsed = tryParseClipboardConfig(text);
      if (!parsed || parsed.servers.length === 0) {
        new Notice(t('settings.mcp.invalidClipboard'));
        return;
      }

      if (parsed.needsName || parsed.servers.length === 1) {
        const server = parsed.servers[0];
        const type = getMcpServerType(server.config);
        const modal = new McpServerModal(
          this.app,
          null,
          (savedServer) => {
            void this.saveServer(savedServer, null).catch((error: unknown) => {
              new Notice(error instanceof Error ? error.message : t('settings.mcp.saveFailed'));
            });
          },
          type,
          server  // Pre-fill with parsed config
        );
        modal.open();
        if (parsed.needsName) {
          new Notice(t('settings.mcp.nameRequired'));
        }
        return;
      }

      await this.importServers(parsed.servers);
    } catch {
      new Notice(t('settings.mcp.clipboardReadFailed'));
    }
  }

  private async saveServer(server: ManagedMcpServer, existing: ManagedMcpServer | null) {
    if (existing) {
      const index = this.servers.findIndex((s) => s.name === existing.name);
      if (index !== -1) {
        if (server.name !== existing.name) {
          const conflict = this.servers.find((s) => s.name === server.name);
          if (conflict) {
            new Notice(t('settings.mcp.duplicate', { name: server.name }));
            return;
          }
        }
        this.servers[index] = server;
      }
    } else {
      const conflict = this.servers.find((s) => s.name === server.name);
      if (conflict) {
        new Notice(t('settings.mcp.duplicate', { name: server.name }));
        return;
      }
      this.servers.push(server);
    }

    await this.persistServers();
    this.clearOrphanedSecrets(existing);
    await this.broadcastMcpReload();
    this.render();
    new Notice(existing
      ? t('settings.mcp.updated', { name: server.name })
      : t('settings.mcp.added', { name: server.name }));
  }

  private async importServers(servers: Array<{ name: string; config: McpServerConfig }>) {
    const added: string[] = [];
    const skipped: string[] = [];

    for (const server of servers) {
      const name = server.name.trim();
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
        skipped.push(server.name || '<unnamed>');
        continue;
      }

      const conflict = this.servers.find((s) => s.name === name);
      if (conflict) {
        skipped.push(name);
        continue;
      }

      this.servers.push({
        name,
        config: server.config,
        enabled: DEFAULT_MCP_SERVER.enabled,
        contextSaving: DEFAULT_MCP_SERVER.contextSaving,
      });
      added.push(name);
    }

    if (added.length === 0) {
      new Notice(t('settings.mcp.importNothing'));
      return;
    }

    await this.persistServers();
    await this.broadcastMcpReload();
    this.render();

    const message = skipped.length > 0
      ? t('settings.mcp.importedWithSkipped', { count: added.length, skipped: skipped.length })
      : t('settings.mcp.imported', { count: added.length });
    new Notice(message);
  }

  private async toggleServer(server: ManagedMcpServer) {
    server.enabled = !server.enabled;
    await this.persistServers();
    await this.broadcastMcpReload();
    this.render();
    new Notice(server.enabled
      ? t('settings.mcp.toggleEnabled', { name: server.name })
      : t('settings.mcp.toggleDisabled', { name: server.name }));

    // SEC-A Phase 3: workspace init only checks ENABLED servers for missing secrets,
    // so a disabled synced server (ref present, keychain value absent on this device)
    // would otherwise launch credential-less when enabled here with no re-entry prompt.
    if (server.enabled) {
      const missing = collectMissingMcpSecrets([server], (id) => this.secretStore.get(id));
      if (missing.length > 0) this.warnMissingMcpSecrets?.(missing);
    }
  }

  private async deleteServer(server: ManagedMcpServer) {
    if (!(await confirmDelete(this.app, `Delete MCP server "${server.name}"?`))) {
      return;
    }

    this.servers = this.servers.filter((s) => s.name !== server.name);
    await this.persistServers();
    this.clearOrphanedSecrets(server);
    await this.broadcastMcpReload();
    this.render();
    new Notice(t('settings.mcp.deleted', { name: server.name }));
  }

  /** Refresh the server list (call after external changes). */
  public refresh() {
    void this.loadAndRender();
  }
}
