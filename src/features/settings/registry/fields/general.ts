import { renderHotkeysSection } from '@/features/settings/hotkeys/HotkeysSection';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { getSettingsRegistry } from '../registry';

export function registerGeneralTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'general',
    label: 'General',
    order: 0,
    visible: () => true,
  });

  r.registerSection({
    id: 'providers',
    tabId: 'general',
    label: 'Providers',
    order: 10,
    description: 'Enable and configure chat providers.',
  });

  r.registerSection({
    id: 'appearance',
    tabId: 'general',
    label: 'Appearance',
    order: 20,
    description: 'UI theme and font settings.',
  });

  r.registerSection({
    id: 'chat',
    tabId: 'general',
    label: 'Chat',
    order: 30,
    description: 'Chat behavior and streaming.',
  });

  r.registerSection({
    id: 'inlineEdit',
    tabId: 'general',
    label: 'Inline Edit',
    order: 40,
    description: 'Inline edit workflow settings.',
  });

  r.registerSection({
    id: 'agentMentions',
    tabId: 'general',
    label: 'Agent Mentions',
    order: 50,
    description: 'Agent mention behavior.',
  });

  r.registerSection({
    id: 'performance',
    tabId: 'general',
    label: 'Performance',
    order: 60,
    description: 'Performance tuning.',
  });

  r.registerSection({
    id: 'diagnostics',
    tabId: 'general',
    label: 'Diagnostics',
    order: 70,
    description: 'Logging and debugging.',
  });

  r.registerSection({
    id: 'hotkeys',
    tabId: 'general',
    label: 'Hotkeys',
    order: 80,
    description: 'Command hotkey bindings.',
  });

  r.registerField({
    id: 'general.providers.showSetupAgain',
    tabId: 'general',
    sectionId: 'providers',
    label: 'Show setup banner again',
    type: {
      kind: 'button',
      label: 'Show setup',
      onClick: async (ctx) => {
        (ctx.settings as { firstRunDismissed?: boolean }).firstRunDismissed = false;
        await ctx.saveSettings();
        ctx.refresh();
      },
    },
    default: null,
  });

  for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
    const displayName = ProviderRegistry.getProviderDisplayName(providerId);
    r.registerField({
      id: `providerConfigs.${providerId}.enabled`,
      tabId: 'general',
      sectionId: 'providers',
      label: `Enable ${displayName}`,
      type: { kind: 'toggle' },
      default: false,
    });
  }

  // Hotkeys section custom field
  r.registerField({
    id: 'general.hotkeys.list',
    tabId: 'general',
    sectionId: 'hotkeys',
    label: 'Command hotkeys',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderHotkeysSection(ctx, host),
    },
    default: null,
  });
}
