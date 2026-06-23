import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { MCP_SECRET_PLACEHOLDER, reconcileEditedMcpSecrets } from '../../core/mcp/mcpSecrets';
import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../core/types';
import { t } from '../../i18n/i18n';
import { parseCommand } from '../../utils/mcp';
import { renderModalButtonRow } from '../components/settingsListUI';

export class McpServerModal extends Modal {
  private existingServer: ManagedMcpServer | null;
  private onSave: (server: ManagedMcpServer) => void;

  private serverName = '';
  private serverType: McpServerType = 'stdio';
  private enabled = DEFAULT_MCP_SERVER.enabled;
  private contextSaving = DEFAULT_MCP_SERVER.contextSaving;
  private command = '';
  private env = '';
  private url = '';
  private headers = '';
  private typeFieldsEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    existingServer: ManagedMcpServer | null,
    onSave: (server: ManagedMcpServer) => void,
    initialType?: McpServerType,
    prefillConfig?: { name: string; config: McpServerConfig }
  ) {
    super(app);
    this.existingServer = existingServer;
    this.onSave = onSave;

    if (existingServer) {
      this.serverName = existingServer.name;
      this.serverType = getMcpServerType(existingServer.config);
      this.enabled = existingServer.enabled;
      this.contextSaving = existingServer.contextSaving;
      this.initFromConfig(existingServer.config);
    } else if (prefillConfig) {
      this.serverName = prefillConfig.name;
      this.serverType = getMcpServerType(prefillConfig.config);
      this.initFromConfig(prefillConfig.config);
    } else if (initialType) {
      this.serverType = initialType;
    }
  }

  private initFromConfig(config: McpServerConfig) {
    const type = getMcpServerType(config);
    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      if (stdioConfig.args && stdioConfig.args.length > 0) {
        this.command = stdioConfig.command + ' ' + stdioConfig.args.join(' ');
      } else {
        this.command = stdioConfig.command;
      }
      this.env = this.buildEditableEnvString(stdioConfig.env, this.existingServer?.secretEnv);
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      this.url = urlConfig.url;
      this.headers = this.buildEditableEnvString(urlConfig.headers, this.existingServer?.secretHeaders);
    }
  }

  /**
   * SEC-A Phase 3: render plaintext entries plus a masked placeholder row per
   * existing secret ref, so the user sees (and can remove) migrated credentials
   * without their values ever being shown.
   */
  private buildEditableEnvString(
    record: Record<string, string> | undefined,
    refs: Record<string, string> | undefined,
  ): string {
    const base = this.envRecordToString(record);
    const sentinels = Object.keys(refs ?? {}).map((name) => `${name}=${MCP_SECRET_PLACEHOLDER}`);
    return [base, ...sentinels].filter((line) => line.length > 0).join('\n');
  }

  onOpen() {
    this.setTitle(this.existingServer ? 'Edit MCP Server' : 'Add MCP Server');
    this.modalEl.addClass('specorator-mcp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName('Server name')
      .setDesc('Unique identifier for this server')
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.serverName);
        text.setPlaceholder('My-mcp-server');
        text.onChange((value) => {
          this.serverName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    new Setting(contentEl)
      .setName('Type')
      .setDesc('Server connection type')
      .addDropdown((dropdown) => {
        dropdown.addOption('stdio', 'Stdio (local command)');
        dropdown.addOption('sse', 'Sse (server-sent events)');
        dropdown.addOption('http', 'HTTP (HTTP endpoint)');
        dropdown.setValue(this.serverType);
        dropdown.onChange((value) => {
          this.serverType = value as McpServerType;
          this.renderTypeFields();
        });
      });

    this.typeFieldsEl = contentEl.createDiv({ cls: 'specorator-mcp-type-fields' });
    this.renderTypeFields();

    new Setting(contentEl)
      .setName('Enabled')
      .setDesc('Whether this server is active')
      .addToggle((toggle) => {
        toggle.setValue(this.enabled);
        toggle.onChange((value) => {
          this.enabled = value;
        });
      });

    new Setting(contentEl)
      .setName('Context-saving mode')
      .setDesc('Hide tools from agent unless @-mentioned (saves context window)')
      .addToggle((toggle) => {
        toggle.setValue(this.contextSaving);
        toggle.onChange((value) => {
          this.contextSaving = value;
        });
      });

    renderModalButtonRow(contentEl, {
      cls: 'specorator-mcp-buttons',
      saveText: this.existingServer ? 'Update' : 'Add',
      saveCls: 'specorator-save-btn mod-cta',
      onCancel: () => this.close(),
      onSave: () => this.save(),
    });
  }

  private renderTypeFields() {
    if (!this.typeFieldsEl) return;
    this.typeFieldsEl.empty();

    if (this.serverType === 'stdio') {
      this.renderStdioFields();
    } else {
      this.renderUrlFields();
    }
  }

  private renderStdioFields() {
    if (!this.typeFieldsEl) return;

    const cmdSetting = new Setting(this.typeFieldsEl)
      .setName('Command')
      .setDesc('Full command with arguments');
    cmdSetting.settingEl.addClass('specorator-mcp-cmd-setting');

    const cmdTextarea = cmdSetting.controlEl.createEl('textarea', {
      cls: 'specorator-mcp-cmd-textarea',
    });
    cmdTextarea.value = this.command;
    cmdTextarea.placeholder = 'Docker exec -i mcp-server python -m src.server';
    cmdTextarea.rows = 2;
    cmdTextarea.addEventListener('input', () => {
      this.command = cmdTextarea.value;
    });

    const envSetting = new Setting(this.typeFieldsEl)
      .setName('Environment variables')
      .setDesc('Key=value per line (optional)');
    envSetting.settingEl.addClass('specorator-mcp-env-setting');

    const envTextarea = envSetting.controlEl.createEl('textarea', {
      cls: 'specorator-mcp-env-textarea',
    });
    envTextarea.value = this.env;
    envTextarea.placeholder = 'API_key=your-key';
    envTextarea.rows = 2;
    envTextarea.addEventListener('input', () => {
      this.env = envTextarea.value;
    });
  }

  private renderUrlFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName('URL')
      .setDesc(this.serverType === 'sse' ? 'SSE endpoint URL' : 'HTTP endpoint URL')
      .addText((text) => {
        text.setValue(this.url);
        text.setPlaceholder('HTTP://localhost:3000/sse');
        text.onChange((value) => {
          this.url = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    const headersSetting = new Setting(this.typeFieldsEl)
      .setName('Headers')
      .setDesc('HTTP headers (key=value per line)');
    headersSetting.settingEl.addClass('specorator-mcp-env-setting');

    const headersTextarea = headersSetting.controlEl.createEl('textarea', {
      cls: 'specorator-mcp-env-textarea',
    });
    headersTextarea.value = this.headers;
    headersTextarea.placeholder = 'Authorization=bearer token\ncontent-type=application/JSON';
    headersTextarea.rows = 3;
    headersTextarea.addEventListener('input', () => {
      this.headers = headersTextarea.value;
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    // !e.isComposing for IME support
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.save();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.close();
    }
  }

  private save() {
    const name = this.validateServerName();
    if (name === null) return;

    // SEC-A Phase 3: reconcile edited textarea entries against existing secret refs
    // for the CURRENT type only. Switching type drops the other type's refs; an
    // unchanged placeholder keeps a ref; deleting/emptying a key removes it.
    const built = this.serverType === 'stdio'
      ? this.buildStdioConfig()
      : this.buildUrlConfig();
    if (!built) return;

    const server: ManagedMcpServer = {
      name,
      config: built.config,
      enabled: this.enabled,
      contextSaving: this.contextSaving,
      disabledTools: this.existingServer?.disabledTools,
      secretHeaders: built.secretHeaders,
      secretEnv: built.secretEnv,
    };

    this.onSave(server);
    this.close();
  }

  /** Trimmed server name, or null after notifying+refocusing when missing/invalid. */
  private validateServerName(): string | null {
    const name = this.serverName.trim();
    if (!name) {
      new Notice(t('settings.mcp.modal.serverNameRequired'));
      this.nameInputEl?.focus();
      return null;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      new Notice(t('settings.mcp.modal.serverNameInvalid'));
      this.nameInputEl?.focus();
      return null;
    }

    return name;
  }

  private buildStdioConfig(): {
    config: McpServerConfig;
    secretEnv?: Record<string, string>;
    secretHeaders?: undefined;
  } | null {
    const fullCommand = this.command.trim();
    if (!fullCommand) {
      new Notice(t('settings.mcp.modal.commandRequired'));
      return null;
    }

    const { cmd, args } = parseCommand(fullCommand);
    const stdioConfig: McpStdioServerConfig = { command: cmd };

    if (args.length > 0) {
      stdioConfig.args = args;
    }

    const { plaintext, refs } = reconcileEditedMcpSecrets(
      this.parseEnvString(this.env),
      this.existingServer?.secretEnv,
    );
    if (Object.keys(plaintext).length > 0) {
      stdioConfig.env = plaintext;
    }

    return {
      config: stdioConfig,
      secretEnv: Object.keys(refs).length > 0 ? refs : undefined,
    };
  }

  private buildUrlConfig(): {
    config: McpServerConfig;
    secretEnv?: undefined;
    secretHeaders?: Record<string, string>;
  } | null {
    const url = this.url.trim();
    if (!url) {
      new Notice(t('settings.mcp.modal.urlRequired'));
      return null;
    }

    const { plaintext, refs } = reconcileEditedMcpSecrets(
      this.parseEnvString(this.headers),
      this.existingServer?.secretHeaders,
    );
    const headers = Object.keys(plaintext).length > 0 ? plaintext : undefined;
    const config: McpSSEServerConfig | McpHttpServerConfig = this.serverType === 'sse'
      ? { type: 'sse', url, ...(headers ? { headers } : {}) }
      : { type: 'http', url, ...(headers ? { headers } : {}) };

    return {
      config,
      secretHeaders: Object.keys(refs).length > 0 ? refs : undefined,
    };
  }

  private parseEnvString(envStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!envStr.trim()) return result;

    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  private envRecordToString(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  onClose() {
    this.contentEl.empty();
  }
}
