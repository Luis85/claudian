import { Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import { resolveAgentBoardDefaultModel } from '../../../tasks/defaultModelResolver';
import { resolveAgentBoardDefaultProvider } from '../../../tasks/defaultProviderResolver';
import { installPresetTemplates } from '../../../tasks/templates/installPresetTemplates';
import { renderAgentBoardLaneEditor } from '../../../tasks/ui/AgentBoardLaneEditor';
import { writePathInPlace } from '../path';
import { getSettingsRegistry } from '../registry';
import type { SettingsCtx } from '../SettingsField';

function providerLabel(id: ProviderId): string {
  return ProviderRegistry.getProviderDisplayName(id);
}

function normalizeFolder(value: string): string {
  return (value || '').replace(/^\/+|\/+$/g, '');
}

export function registerAgentBoardTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'agentBoard',
    label: 'Agent Board',
    order: 60,
    visible: () => true,
  });

  r.registerSection({
    id: 'folders',
    tabId: 'agentBoard',
    label: 'Folders',
    order: 10,
    description: 'Vault locations for Agent Board work orders, templates, and archive.',
  });

  r.registerSection({
    id: 'defaults',
    tabId: 'agentBoard',
    label: 'Defaults',
    order: 20,
    description: 'Provider and model used to run new work orders.',
  });

  r.registerSection({
    id: 'lanes',
    tabId: 'agentBoard',
    label: 'Lanes',
    order: 30,
    description: 'Configure board columns shown in the Agent Board view.',
  });

  r.registerSection({
    id: 'templates',
    tabId: 'agentBoard',
    label: 'Templates',
    order: 40,
    description: 'Pre-built work-order templates you can install in one click.',
  });

  r.registerSection({
    id: 'archive',
    tabId: 'agentBoard',
    label: 'Archive',
    order: 50,
  });

  r.registerSection({
    id: 'commitOnAccept',
    tabId: 'agentBoard',
    label: 'Git',
    order: 55,
    description: 'Prompt to commit and push when a work order is Accepted.',
  });

  r.registerSection({
    id: 'queue',
    tabId: 'agentBoard',
    label: 'Queue',
    order: 35,
    description: 'Background runner that auto-picks Ready and Needs-fix cards.',
  });

  r.registerField({
    id: 'agentBoardWorkOrderFolder',
    tabId: 'agentBoard',
    sectionId: 'folders',
    label: 'Work order folder',
    description: 'Folder where new Agent Board work orders are created.',
    type: { kind: 'folder', placeholder: 'Agent Board/tasks' },
    default: 'Agent Board/tasks',
    keywords: ['agent board', 'work order', 'folder'],
  });

  r.registerField({
    id: 'agentBoardTemplateFolder',
    tabId: 'agentBoard',
    sectionId: 'folders',
    label: 'Template folder',
    description: 'Folder where work-order templates live.',
    type: { kind: 'folder', placeholder: 'Agent Board/templates' },
    default: 'Agent Board/templates',
    keywords: ['template', 'folder'],
  });

  // Folder-collision warning — re-renders whenever folder settings change so it
  // tracks the latest values. Sits under the folders section so it shows
  // directly below the two folder inputs that drive it.
  r.registerField({
    id: 'agentBoardFolderWarning',
    tabId: 'agentBoard',
    sectionId: 'folders',
    label: 'Folder warning',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderFolderWarning(ctx, host),
    },
    default: null,
  });

  r.registerField({
    id: 'agentBoardArchiveFolder',
    tabId: 'agentBoard',
    sectionId: 'archive',
    label: 'Archive folder',
    description: 'Folder where archived Agent Board work orders are moved. Keep it outside the work order folder.',
    type: { kind: 'folder', placeholder: 'Agent Board/archive' },
    default: 'Agent Board/archive',
    keywords: ['archive', 'folder'],
  });

  r.registerField({
    id: 'agentBoardDefaultProvider',
    tabId: 'agentBoard',
    sectionId: 'defaults',
    label: 'Default provider',
    description: 'Provider used to run new work orders.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderDefaultProviderWidget(ctx, host),
    },
    default: null,
    keywords: ['default', 'provider'],
  });

  r.registerField({
    id: 'agentBoardDefaultModel',
    tabId: 'agentBoard',
    sectionId: 'defaults',
    label: 'Default model',
    description: 'Model used to run new work orders.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderDefaultModelWidget(ctx, host),
    },
    default: null,
    keywords: ['default', 'model'],
  });

  r.registerField({
    id: 'lanesEditor',
    tabId: 'agentBoard',
    sectionId: 'lanes',
    label: 'Board lanes',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderAgentBoardLaneEditor(host, ctx.plugin);
        return undefined;
      },
    },
    default: null,
    keywords: ['lanes', 'columns', 'board'],
  });

  r.registerField({
    id: 'promptCommitOnAccept',
    tabId: 'agentBoard',
    sectionId: 'commitOnAccept',
    label: 'Prompt to commit and push on Accept',
    description: 'When the vault is a dirty git repo, ask before committing the changes that ship with the accepted work order.',
    type: { kind: 'toggle' },
    default: true,
    keywords: ['git', 'commit', 'push', 'accept'],
  });

  r.registerField({
    id: 'agentBoardQueueCap',
    tabId: 'agentBoard',
    sectionId: 'queue',
    label: 'Concurrent work-order runs',
    description:
      'Maximum number of work orders that may run at once. Also caps how many work-order tabs the Agent Board may open in the chat panel. Shared across all boards.',
    type: { kind: 'number', min: 1, max: 8, step: 1 },
    default: 1,
    keywords: ['queue', 'concurrent', 'cap', 'parallel', 'work-order', 'tabs'],
  });

  r.registerField({
    id: 'agentBoardQueueHaltAfter',
    tabId: 'agentBoard',
    sectionId: 'queue',
    label: 'Auto-halt after consecutive failures',
    description: 'Pause the queue after this many auto-run failures in a row. Manual runs do not count.',
    type: { kind: 'number', min: 1, max: 20, step: 1 },
    default: 3,
    keywords: ['queue', 'halt', 'failure', 'safety'],
  });

  r.registerField({
    id: 'installCommonTemplatesButton',
    tabId: 'agentBoard',
    sectionId: 'templates',
    label: 'Common templates',
     
    description: 'Install the starter set (Bug fix, Feature, Refactor, Research spike, Documentation, Test backfill). Re-running skips any whose filename already exists.',
    type: {
      kind: 'button',
      label: 'Install common templates',
      onClick: async (ctx) => {
        try {
          const result = await installPresetTemplates(ctx.plugin);
          const parts: string[] = [];
          if (result.installed > 0) parts.push(`installed ${result.installed}`);
          if (result.skipped > 0) parts.push(`skipped ${result.skipped} already present`);
          const summary = parts.join(', ');
          new Notice(summary
            ? t('settings.agentBoard.commonTemplates', { templates: summary })
            : t('settings.agentBoard.commonTemplatesEmpty'));
        } catch (error) {
          new Notice(t('settings.agentBoard.installFailed', { error: error instanceof Error ? error.message : String(error) }));
        }
      },
    },
    default: null,
    keywords: ['template', 'install', 'preset'],
  });
}

function renderFolderWarning(ctx: SettingsCtx, host: HTMLElement): () => void {
  let lastSame: boolean | null = null;
  const refresh = (): void => {
    const same =
      normalizeFolder(String((ctx.settings as Record<string, unknown>).agentBoardTemplateFolder ?? '')) ===
      normalizeFolder(String((ctx.settings as Record<string, unknown>).agentBoardWorkOrderFolder ?? ''));
    if (same === lastSame) return;
    lastSame = same;
    host.empty();
    if (!same) return;
    const warning = host.createDiv({ cls: 'claudian-agent-board-folder-warning' });
    warning.setText(
      'Warning: the template folder matches the work order folder, so templates will appear as invalid notes on the board.',
    );
  };
  refresh();

  // Folder fields use the `folder` renderer which does not emit a board-config
  // event on every keystroke (would steal focus on refresh). Poll the two
  // values once per second while the panel is open; cheap, and self-cancels
  // when the host is detached from the DOM.
  const intervalId = window.setInterval(() => {
    if (!host.isConnected) {
      window.clearInterval(intervalId);
      return;
    }
    refresh();
  }, 1000);

  const unsubscribe = ctx.plugin.events.on('task:board-config-changed', refresh);
  return () => {
    window.clearInterval(intervalId);
    unsubscribe();
  };
}

// Resolver-aware widget for `agentBoardDefaultProvider`. Three modes mirror
// real provider state so the picker never offers an invalid choice:
//   0 enabled → disabled hint pointing to the General tab
//   1 enabled → read-only chip locking the only valid provider
//   ≥2 enabled → editable dropdown writing through to ctx.settings
// Re-renders only its own host on `task:board-config-changed` so a lane edit
// upstream cannot wipe the entire settings tab (which used to destroy the
// lane editor's checkbox mid-event and caused the freeze).
function renderDefaultProviderWidget(ctx: SettingsCtx, host: HTMLElement): () => void {
  const renderInto = (target: HTMLElement): void => {
    target.empty();
    const configs = (ctx.settings as { providerConfigs?: Record<string, { enabled?: boolean }> })
      .providerConfigs;
    const enabledIds = ProviderRegistry.getRegisteredProviderIds().filter(
      (id) => Boolean(configs?.[id]?.enabled),
    );
    const resolved = resolveAgentBoardDefaultProvider(ctx.settings);

    const setting = new Setting(target)
      .setName('Default provider')
      .setDesc('Provider used to run new work orders.');

    if (enabledIds.length === 0) {
      setting.descEl.createEl('br');
      setting.descEl.createSpan({

        text: 'Enable a provider in General to set a default for Agent Board.',
        cls: 'claudian-agent-board-hint',
      });
    } else if (enabledIds.length === 1) {
      setting.addText((text) => {
        text.setValue(providerLabel(enabledIds[0])).setDisabled(true);
      });
      setting.descEl.createEl('br');
      setting.descEl.createSpan({
        text: 'Only one provider is enabled — locked to it.',
        cls: 'claudian-agent-board-hint',
      });
    } else {
      setting.addDropdown((dropdown) => {
        for (const id of enabledIds) {
          dropdown.addOption(id, providerLabel(id));
        }
        dropdown.setValue(resolved ?? enabledIds[0]);
        dropdown.onChange(async (value) => {
          writePathInPlace(ctx.settings as object, 'agentBoardDefaultProvider', value);
          writePathInPlace(ctx.settings as object, 'agentBoardDefaultModel', null);
          await ctx.saveSettings();
          // User-initiated change in the defaults section. Full refresh is
          // acceptable here because the user is not interacting with the lane
          // editor and the model widget needs to repopulate its option list.
          ctx.refresh();
        });
      });
    }
  };

  renderInto(host);
  return ctx.plugin.events.on('task:board-config-changed', () => {
    // Defensive: between event dispatch and this listener executing,
    // ClaudianSettings.display() may have replaced `containerEl` and detached
    // the host. Re-rendering into a detached node is wasted DOM work and risks
    // mutating a host that the EventBus snapshot still holds a stale closure
    // for. The unsubscribe in renderTab's disposer runs at the top of the
    // next display(), so this guard only matters when the listener fires from
    // the same emit() that triggered the display.
    if (!host.isConnected) return;
    renderInto(host);
  });
}

// Resolver-aware widget for `agentBoardDefaultModel`. Mirrors the model list
// of the resolved provider so the picker never offers an invalid model:
//   no provider resolvable → hint pointing back at the provider choice
//   provider with 0 models → hint (custom envs may still pick later)
//   provider with 1 model  → read-only chip locking the only valid model
//   provider with ≥2 models → editable dropdown writing through to ctx.settings
// Re-renders only its own host on `task:board-config-changed` so a lane edit
// upstream cannot trigger a full settings re-render that wipes the lane editor.
function renderDefaultModelWidget(ctx: SettingsCtx, host: HTMLElement): () => void {
  const renderInto = (target: HTMLElement): void => {
    target.empty();
    const provider = resolveAgentBoardDefaultProvider(ctx.settings);

    const setting = new Setting(target)
      .setName('Default model')
      .setDesc('Model used to run new work orders.');

    if (!provider) {
      setting.descEl.createEl('br');
      setting.descEl.createSpan({

        text: 'Pick an Agent Board default provider first to choose a model.',
        cls: 'claudian-agent-board-hint',
      });
    } else {
      const settingsBag = asSettingsBag(ctx.settings);
      const config = ProviderRegistry.getChatUIConfig(provider);
      const options = config.getModelOptions(settingsBag);

      if (options.length === 0) {
        setting.descEl.createEl('br');
        setting.descEl.createSpan({
          text: `No models available for ${providerLabel(provider)}.`,
          cls: 'claudian-agent-board-hint',
        });
      } else if (options.length === 1) {
        setting.addText((text) => {
          text.setValue(options[0].label).setDisabled(true);
        });
      } else {
        setting.addDropdown((dropdown) => {
          dropdown.addOption('', 'Provider default');
          for (const option of options) {
            dropdown.addOption(option.value, option.label);
          }
          const resolvedModel = resolveAgentBoardDefaultModel(ctx.settings);
          dropdown.setValue(resolvedModel ?? '');
          dropdown.onChange(async (value) => {
            writePathInPlace(ctx.settings as object, 'agentBoardDefaultModel', value || null);
            await ctx.saveSettings();
          });
        });
      }
    }
  };

  renderInto(host);
  return ctx.plugin.events.on('task:board-config-changed', () => {
    if (!host.isConnected) return;
    renderInto(host);
  });
}
