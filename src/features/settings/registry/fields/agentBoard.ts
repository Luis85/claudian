import type { ProviderId } from '../../../../core/providers/types';
import { resolveAgentBoardDefaultProvider } from '../../../tasks/defaultProviderResolver';
import { writePath } from '../path';
import { getSettingsRegistry } from '../registry';
import type { SettingsCtx } from '../SettingsField';

const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'Opencode',
  cursor: 'Cursor',
};

function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id] ?? id;
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
  });

  r.registerSection({
    id: 'defaults',
    tabId: 'agentBoard',
    label: 'Defaults',
    order: 20,
  });

  r.registerSection({
    id: 'lanes',
    tabId: 'agentBoard',
    label: 'Lanes',
    order: 30,
  });

  r.registerSection({
    id: 'templates',
    tabId: 'agentBoard',
    label: 'Templates',
    order: 40,
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
    type: { kind: 'folder' },
    default: 'Agent Board/tasks',
  });

  r.registerField({
    id: 'agentBoardTemplateFolder',
    tabId: 'agentBoard',
    sectionId: 'folders',
    label: 'Template folder',
    type: { kind: 'folder' },
    default: 'Agent Board/templates',
  });

  r.registerField({
    id: 'agentBoardArchiveFolder',
    tabId: 'agentBoard',
    sectionId: 'archive',
    label: 'Archive folder',
    type: { kind: 'folder' },
    default: 'Agent Board/archive',
  });

  r.registerField({
    id: 'agentBoardDefaultProvider',
    tabId: 'agentBoard',
    sectionId: 'defaults',
    label: 'Default provider',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderDefaultProviderWidget(ctx, host),
    },
    default: null,
  });

  r.registerField({
    id: 'agentBoardDefaultModel',
    tabId: 'agentBoard',
    sectionId: 'defaults',
    label: 'Default model',
    type: {
      kind: 'dropdown',
      options: () => [],
    },
    default: null,
    // Hide until the user picks a provider. The model list is provider-scoped
    // and renders an empty dropdown otherwise. Phase F3 will narrow
    // `agentBoardDefaultProvider` to `ProviderId | null`; until then read it
    // through a structural cast.
    visible: (s) =>
      Boolean((s as { agentBoardDefaultProvider?: unknown }).agentBoardDefaultProvider),
  });

  r.registerField({
    id: 'lanesEditor',
    tabId: 'agentBoard',
    sectionId: 'lanes',
    label: 'Lanes',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'installCommonTemplatesButton',
    tabId: 'agentBoard',
    sectionId: 'templates',
    label: 'Common templates',
    type: {
      kind: 'button',
      label: 'Install common templates',
      // TODO Phase F: invoke command 'claudian:install-common-work-order-templates' via plugin handle once SettingsCtx exposes it
      onClick: () => undefined,
    },
    default: null,
  });
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
  const enabledIds = PROVIDER_IDS.filter((id) => Boolean(configs?.[id]?.enabled));
  const resolved = resolveAgentBoardDefaultProvider(ctx.settings);

  if (enabledIds.length === 0) {
    host.createEl('p', {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "General" is the tab name and "Agent Board" is the product feature name.
      text: 'Enable a provider in General to set a default for Agent Board.',
      cls: 'setting-item-description',
    });
  } else if (enabledIds.length === 1) {
    const chip = host.createDiv({ cls: 'claudian-default-provider-chip' });
    chip.createEl('strong', { text: providerLabel(enabledIds[0]) });
    chip.createEl('span', { text: ' — only enabled provider' });
  } else {
    const select = host.createEl('select');
    for (const id of enabledIds) {
      const option = select.createEl('option');
      option.value = id;
      option.text = providerLabel(id);
    }
    select.value = resolved ?? enabledIds[0];
    select.addEventListener('change', () => {
      ctx.settings = writePath(ctx.settings, 'agentBoardDefaultProvider', select.value);
      void ctx.saveSettings().then(() => ctx.refresh());
    });
  }

  return ctx.plugin.events.on('task:board-config-changed', () => ctx.refresh());
}
