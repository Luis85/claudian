import { getHiddenProviderCommandSet } from '../../../core/providers/commands/hiddenCommands';
import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderId,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { asSettingsBag } from '../../../core/types/settings';
import type ClaudianPlugin from '../../../main';
import { getTabProviderId } from './providerResolution';
import type { TabData, TabProviderContext } from './types';

export type TabProviderSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

export type ProviderCatalogInfo = {
  config: ProviderCommandDropdownConfig;
  getEntries: () => Promise<ProviderCommandEntry[]>;
} | null;

/**
 * Resolves the draft model for a new blank tab by projecting provider-specific
 * saved settings. Without this, `plugin.settings.model` reflects only the
 * settings-provider's model, which may belong to a different provider.
 */
export function resolveBlankTabModel(
  plugin: ClaudianPlugin,
  providerId?: ProviderId,
): string {
  const settings = asSettingsBag(plugin.settings);
  if (!providerId) {
    return settings.model as string;
  }

  const targetProviderId = ProviderRegistry.isEnabled(providerId, settings)
    ? providerId
    : ProviderRegistry.resolveSettingsProviderId(settings);
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, targetProviderId);
  return snapshot.model as string;
}

export function getTabCapabilities(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): ProviderCapabilities {
  const providerId = getTabProviderId(tab, plugin, conversation);
  if (tab.service?.providerId === providerId) {
    return tab.service.getCapabilities();
  }

  return ProviderRegistry.getCapabilities(providerId);
}

export function getTabChatUIConfig(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): ProviderChatUIConfig {
  return ProviderRegistry.getChatUIConfig(getTabProviderId(tab, plugin, conversation));
}

export function getTabSettingsSnapshot(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
): TabProviderSettings {
  return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
    plugin.settings,
    getTabProviderId(tab, plugin),
  );
}

export function getTabPermissionMode(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === 'string' && permissionMode
    ? permissionMode
    : 'normal';
}

export function getTabHiddenCommands(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): Set<string> {
  return getHiddenProviderCommandSet(
    plugin.settings,
    getTabProviderId(tab, plugin, conversation),
  );
}

export function getRegistryProviderCatalogInfo(providerId: ProviderId): ProviderCatalogInfo {
  const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
  if (!catalog) {
    return null;
  }

  return {
    config: catalog.getDropdownConfig(),
    getEntries: () => catalog.listDropdownEntries({ includeBuiltIns: false }),
  };
}

export function getProviderMcpManager(providerId: ProviderId) {
  return ProviderWorkspaceRegistry.getMcpServerManager(providerId);
}

export function syncSlashCommandDropdownForProvider(
  tab: TabData,
  plugin: ClaudianPlugin,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
  conversation?: Conversation | null,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) {
    return;
  }

  const catalogInfo = getProviderCatalogConfig?.()
    ?? getRegistryProviderCatalogInfo(getTabProviderId(tab, plugin, conversation));

  if (catalogInfo) {
    dropdown.setProviderCatalog?.(catalogInfo.config, catalogInfo.getEntries);
  } else {
    dropdown.resetSdkSkillsCache();
  }

  dropdown.setHiddenCommands(getTabHiddenCommands(tab, plugin, conversation));
}

export async function updateTabProviderSettings(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  update: (settings: TabProviderSettings) => void,
): Promise<TabProviderSettings> {
  const providerId = getTabProviderId(tab, plugin);
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
    plugin.settings,
    providerId,
    snapshot,
  );
  await plugin.saveSettings();
  return snapshot;
}

export function refreshTabProviderUI(tab: TabData, plugin: ClaudianPlugin): void {
  const capabilities = getTabCapabilities(tab, plugin);
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.modeSelector?.updateDisplay();
  tab.ui.modeSelector?.renderOptions();
  tab.ui.thinkingBudgetSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.ui.planModeToggle?.updateDisplay();
  tab.ui.serviceTierToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'claudian-input-plan-mode',
    permissionMode === 'plan' && capabilities.supportsPlanMode,
  );
}

/**
 * Hides or disables UI elements that the active provider does not support.
 * Called after toolbar initialization and on provider switches.
 */
export function applyProviderUIGating(tab: TabData, plugin: ClaudianPlugin): void {
  const capabilities = getTabCapabilities(tab, plugin);
  const uiConfig = getTabChatUIConfig(tab, plugin);
  const mcpManager = capabilities.supportsMcpTools
    ? getProviderMcpManager(capabilities.providerId)
    : null;
  const hasPermissionToggle = Boolean(uiConfig.getPermissionModeToggle?.());

  if (!capabilities.supportsMcpTools) {
    tab.ui.mcpServerSelector?.clearEnabled();
  }
  tab.ui.mcpServerSelector?.setVisible(capabilities.supportsMcpTools);
  tab.ui.permissionToggle?.setVisible(hasPermissionToggle);
  const planValue = uiConfig.getPermissionModeToggle?.()?.planValue;
  tab.ui.planModeToggle?.setVisible(
    capabilities.supportsPlanMode && Boolean(planValue),
  );
  tab.ui.fileContextManager?.setMcpManager(mcpManager);

  tab.ui.fileContextManager?.setAgentService(
    ProviderWorkspaceRegistry.getAgentMentionProvider(capabilities.providerId),
  );

  tab.ui.imageContextManager?.setEnabled(capabilities.supportsImageAttachments);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

export function syncTabProviderServices(
  tab: TabData,
  plugin: ClaudianPlugin,
): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = ProviderRegistry.createInstructionRefineService(plugin, tab.providerId);
  tab.services.subagentManager.setTaskResultInterpreter?.(
    ProviderRegistry.getTaskResultInterpreter(tab.providerId)
  );
}

export function ensureTitleGenerationService(tab: TabData, plugin: ClaudianPlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = ProviderRegistry.createTitleGenerationService(plugin);
  }
}

export async function cleanupTabRuntime(tab: TabData): Promise<void> {
  const outgoing = tab.service;
  // Detach the runtime before awaiting so concurrent callers can't observe a
  // half-torn-down service, then await its cleanup so the outgoing CLI process
  // has actually exited before any replacement runtime is constructed.
  tab.service = null;
  tab.serviceInitialized = false;
  if (!outgoing || typeof outgoing.cleanup !== 'function') {
    return;
  }
  // Track the in-flight teardown so initializeTabService can await it even when
  // this cleanup was launched fire-and-forget from a non-async framework callback.
  const cleanupPromise = Promise.resolve(outgoing.cleanup()).finally(() => {
    if (tab.pendingRuntimeCleanup === cleanupPromise) {
      tab.pendingRuntimeCleanup = null;
    }
  });
  tab.pendingRuntimeCleanup = cleanupPromise;
  await cleanupPromise;
}

export function isConversationLike(value: unknown): value is Conversation {
  return !!value
    && typeof value === 'object'
    && typeof (value as Conversation).id === 'string'
    && Array.isArray((value as Conversation).messages);
}

export function isClosingLifecycleState(state: TabData['lifecycleState']): boolean {
  return state === 'closing';
}

export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function updatePlanModeUI(tab: TabData, plugin: ClaudianPlugin, mode: string): void {
  const providerId = getTabProviderId(tab, plugin);
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  if (uiConfig.applyPermissionMode) {
    uiConfig.applyPermissionMode(mode, snapshot);
  } else {
    snapshot.permissionMode = mode;
  }
  ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
    plugin.settings,
    providerId,
    snapshot,
  );
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.ui.planModeToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'claudian-input-plan-mode',
    mode === 'plan' && getTabCapabilities(tab, plugin).supportsPlanMode,
  );
}
