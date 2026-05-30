import type { ProviderId } from '../../../../core/providers/types';
import { getSettingsRegistry } from '../registry';

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
      kind: 'dropdown',
      options: (settings) => {
        const configs = (settings as { providerConfigs?: Record<string, { enabled?: boolean }> })
          .providerConfigs;
        return PROVIDER_IDS.filter((id) => configs?.[id]?.enabled).map((id) => ({
          value: id,
          label: providerLabel(id),
        }));
      },
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
