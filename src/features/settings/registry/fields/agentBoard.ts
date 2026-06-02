import { Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
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
          new Notice(`Common work-order templates: ${parts.join(', ') || 'nothing to do'}.`);
        } catch (error) {
          new Notice(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
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
// Re-renders on `task:board-config-changed` so lane edits or General-tab
// toggles immediately reshape the widget.
function renderDefaultProviderWidget(ctx: SettingsCtx, host: HTMLElement): () => void {
  host.empty();
  const configs = (ctx.settings as { providerConfigs?: Record<string, { enabled?: boolean }> })
    .providerConfigs;
  const enabledIds = ProviderRegistry.getRegisteredProviderIds().filter(
    (id) => Boolean(configs?.[id]?.enabled),
  );
  const resolved = resolveAgentBoardDefaultProvider(ctx.settings);

  const setting = new Setting(host)
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
        ctx.refresh();
      });
    });
  }

  return ctx.plugin.events.on('task:board-config-changed', () => ctx.refresh());
}

// Resolver-aware widget for `agentBoardDefaultModel`. Mirrors the model list
// of the resolved provider so the picker never offers an invalid model:
//   no provider resolvable → hint pointing back at the provider choice
//   provider with 0 models → hint (custom envs may still pick later)
//   provider with 1 model  → read-only chip locking the only valid model
//   provider with ≥2 models → editable dropdown writing through to ctx.settings
// Re-renders on `task:board-config-changed` so provider toggles immediately
// reshape the widget.
function renderDefaultModelWidget(ctx: SettingsCtx, host: HTMLElement): () => void {
  host.empty();
  const provider = resolveAgentBoardDefaultProvider(ctx.settings);

  const setting = new Setting(host)
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

  return ctx.plugin.events.on('task:board-config-changed', () => ctx.refresh());
}
