import { renderHotkeysSection } from '@/features/settings/hotkeys/HotkeysSection';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { asSettingsBag } from '../../../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, t } from '../../../../i18n/i18n';
import type { TranslationKey } from '../../../../i18n/types';
import {
  renderExcludedTagsSetting,
  renderMaxChatTabsSetting,
  renderMediaFolderSetting,
  renderNavMappingsSetting,
  renderProviderEnableSetting,
  renderSharedEnvironmentSection,
  renderSystemPromptSetting,
  renderTabBarPositionSetting,
  renderUserNameSetting,
} from '../../ui/GeneralTabSections';
import { renderQuickActionsSettingsTab } from '../../ui/QuickActionsSettingsTab';
import { getSettingsRegistry } from '../registry';

// Field definitions mirror the legacy `ClaudianSettings.renderGeneralTab`
// (the parity source of truth — see tests/integration/settings/generalPort).
// Simple fields are native registry kinds with ids equal to their persisted
// settings paths; fields whose change handlers carry side effects (view
// refreshes, runtime restarts, structured parsing) mount the SAME extracted
// legacy code via `custom` renders.
export function registerGeneralTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'general',
    label: 'General',
    order: 0,
    visible: () => true,
  });

  registerSections(r);
  registerProvidersFields(r);
  registerGeneralSectionFields(r);
  registerDisplayFields(r);
  registerConversationsFields(r);
  registerContentFields(r);
  registerInputFields(r);
  registerHotkeysFields(r);
  registerEnvironmentFields(r);
}

type Registry = ReturnType<typeof getSettingsRegistry>;

function registerSections(r: Registry): void {
  r.registerSection({
    id: 'providers',
    tabId: 'general',
    label: 'Providers',
    order: 10,
  });

  r.registerSection({
    id: 'general',
    tabId: 'general',
    // Same cast the legacy shell uses: the key exists in every locale file
    // but is not yet part of the generated TranslationKey union.
    label: t('settings.tabs.general' as TranslationKey),
    order: 20,
  });

  r.registerSection({
    id: 'display',
    tabId: 'general',
    label: t('settings.display'),
    order: 30,
  });

  r.registerSection({
    id: 'conversations',
    tabId: 'general',
    label: t('settings.conversations'),
    order: 40,
  });

  r.registerSection({
    id: 'content',
    tabId: 'general',
    label: t('settings.content'),
    order: 50,
  });

  r.registerSection({
    id: 'input',
    tabId: 'general',
    label: t('settings.input'),
    order: 60,
  });

  r.registerSection({
    id: 'hotkeys',
    tabId: 'general',
    label: t('settings.hotkeys'),
    order: 70,
  });

  r.registerSection({
    id: 'environment',
    tabId: 'general',
    label: t('settings.environment'),
    order: 80,
  });
}

function registerProvidersFields(r: Registry): void {
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
    keywords: ['setup', 'banner', 'first run', 'welcome'],
  });

  for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
    const displayName = ProviderRegistry.getProviderDisplayName(providerId);
    r.registerField({
      id: `providerConfigs.${providerId}.enabled`,
      tabId: 'general',
      sectionId: 'providers',
      label: `Enable ${displayName}`,
      description: `Show ${displayName} as a chat provider and reveal its settings tab.`,
      type: {
        kind: 'custom',
        render: (ctx, host) => {
          renderProviderEnableSetting(ctx.plugin, host, providerId, ctx.refresh);
        },
      },
      default: false,
      keywords: ['provider', 'enable', providerId],
    });
  }
}

function registerGeneralSectionFields(r: Registry): void {
  r.registerField({
    id: 'locale',
    tabId: 'general',
    sectionId: 'general',
    label: t('settings.language.name'),
    description: t('settings.language.desc'),
    type: {
      kind: 'dropdown',
      options: () =>
        getAvailableLocales().map((locale) => ({
          value: locale,
          label: getLocaleDisplayName(locale),
        })),
    },
    default: 'en',
    keywords: ['language', 'locale', 'translation'],
  });

  r.registerField({
    id: 'quickActionsFolder',
    tabId: 'general',
    sectionId: 'general',
    label: t('settings.quickActions.folder.name'),
    description: t('settings.quickActions.folder.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderQuickActionsSettingsTab(host, ctx.plugin);
      },
    },
    default: 'Quick Actions',
    keywords: ['quick actions', 'folder'],
  });
}

function registerDisplayFields(r: Registry): void {
  r.registerField({
    id: 'tabBarPosition',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.tabBarPosition.name'),
    description: t('settings.tabBarPosition.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderTabBarPositionSetting(ctx.plugin, host);
      },
    },
    default: 'input',
    keywords: ['tab bar', 'position', 'header', 'badges'],
  });

  r.registerField({
    id: 'maxChatTabs',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.maxChatTabs.name'),
    description: t('settings.maxChatTabs.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderMaxChatTabsSetting(ctx.plugin, host);
      },
    },
    default: 3,
    keywords: ['tabs', 'maximum', 'limit', 'chat'],
  });

  r.registerField({
    id: 'chatViewPlacement',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.chatViewPlacement.name'),
    description: t('settings.chatViewPlacement.desc'),
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'right-sidebar', label: t('settings.chatViewPlacement.rightSidebar') },
        { value: 'left-sidebar', label: t('settings.chatViewPlacement.leftSidebar') },
        { value: 'main-tab', label: t('settings.chatViewPlacement.mainTab') },
      ],
    },
    default: 'right-sidebar',
    keywords: ['placement', 'sidebar', 'panel', 'open'],
  });

  r.registerField({
    id: 'enableAutoScroll',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.enableAutoScroll.name'),
    description: t('settings.enableAutoScroll.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['scroll', 'auto-scroll', 'streaming'],
  });

  r.registerField({
    id: 'deferMathRenderingDuringStreaming',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.deferMathRenderingDuringStreaming.name'),
    description: t('settings.deferMathRenderingDuringStreaming.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['math', 'latex', 'streaming', 'render'],
  });

  r.registerField({
    id: 'collapseStreamingResponse',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.collapseStreamingResponse.name'),
    description: t('settings.collapseStreamingResponse.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['streaming', 'render', 'response', 'placeholder', 'collapse'],
  });
}

function registerConversationsFields(r: Registry): void {
  r.registerField({
    id: 'enableAutoTitleGeneration',
    tabId: 'general',
    sectionId: 'conversations',
    label: t('settings.autoTitle.name'),
    description: t('settings.autoTitle.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['title', 'auto', 'conversation'],
  });

  r.registerField({
    id: 'titleGenerationModel',
    tabId: 'general',
    sectionId: 'conversations',
    label: t('settings.titleModel.name'),
    description: t('settings.titleModel.desc'),
    type: {
      kind: 'dropdown',
      options: (settings) => {
        const options = [{ value: '', label: t('settings.titleModel.auto') }];
        const settingsBag = asSettingsBag(settings);
        const seenValues = new Set<string>();
        for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
          const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
          for (const model of uiConfig.getModelOptions(settingsBag)) {
            if (seenValues.has(model.value)) continue;
            seenValues.add(model.value);
            options.push({ value: model.value, label: model.label });
          }
        }
        return options;
      },
    },
    default: '',
    visible: (settings) => settings.enableAutoTitleGeneration === true,
    keywords: ['title', 'model', 'generation'],
  });
}

function registerContentFields(r: Registry): void {
  r.registerField({
    id: 'userName',
    tabId: 'general',
    sectionId: 'content',
    label: t('settings.userName.name'),
    description: t('settings.userName.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderUserNameSetting(ctx.plugin, host);
      },
    },
    default: '',
    keywords: ['name', 'user', 'greeting'],
  });

  r.registerField({
    id: 'systemPrompt',
    tabId: 'general',
    sectionId: 'content',
    label: t('settings.systemPrompt.name'),
    description: t('settings.systemPrompt.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderSystemPromptSetting(ctx.plugin, host);
      },
    },
    default: '',
    keywords: ['system prompt', 'instructions', 'custom'],
  });

  r.registerField({
    id: 'excludedTags',
    tabId: 'general',
    sectionId: 'content',
    label: t('settings.excludedTags.name'),
    description: t('settings.excludedTags.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderExcludedTagsSetting(ctx.plugin, host);
      },
    },
    default: [],
    keywords: ['tags', 'exclude', 'context'],
  });

  r.registerField({
    id: 'mediaFolder',
    tabId: 'general',
    sectionId: 'content',
    label: t('settings.mediaFolder.name'),
    description: t('settings.mediaFolder.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderMediaFolderSetting(ctx.plugin, host);
      },
    },
    default: '',
    keywords: ['media', 'attachments', 'images', 'folder'],
  });
}

function registerInputFields(r: Registry): void {
  r.registerField({
    id: 'requireCommandOrControlEnterToSend',
    tabId: 'general',
    sectionId: 'input',
    label: t('settings.requireCommandOrControlEnterToSend.name'),
    description: t('settings.requireCommandOrControlEnterToSend.desc'),
    type: { kind: 'toggle' },
    default: false,
    keywords: ['enter', 'send', 'shortcut', 'newline'],
  });

  r.registerField({
    id: 'keyboardNavigation',
    tabId: 'general',
    sectionId: 'input',
    label: t('settings.navMappings.name'),
    description: t('settings.navMappings.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        renderNavMappingsSetting(ctx.plugin, host);
      },
    },
    default: {
      scrollUpKey: 'w',
      scrollDownKey: 's',
      focusInputKey: 'i',
    },
    keywords: ['vim', 'navigation', 'keyboard', 'mapping', 'keys'],
  });
}

function registerHotkeysFields(r: Registry): void {
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
    keywords: ['hotkey', 'shortcut', 'keybinding', 'command'],
  });
}

function registerEnvironmentFields(r: Registry): void {
  r.registerField({
    id: 'sharedEnvironmentVariables',
    tabId: 'general',
    sectionId: 'environment',
    label: 'Shared environment',
    description:
      'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
    type: {
      kind: 'custom',
      // Heading intentionally omitted: the section walker renders it.
      render: (ctx, host) => {
        renderSharedEnvironmentSection(ctx.plugin, host);
      },
    },
    default: '',
    keywords: ['environment', 'env', 'variables', 'snippets', 'secrets', 'path', 'proxy'],
  });
}
