import { Notice } from 'obsidian';

import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { getEnabledProviderForModel, getProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderChatUIConfig, ProviderId } from '../../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { QuickActionStorage } from '../../quickActions/QuickActionStorage';
import { QuickActionsModal } from '../../quickActions/ui/QuickActionsModal';
import { resolveModelContextWindow } from '../../settings/customModels/resolveModelContextWindow';
import { BangBashService } from '../services/BangBashService';
import { BangBashModeManager as BangBashModeManagerClass } from '../ui/BangBashModeManager';
import { FileContextManager } from '../ui/FileContext';
import { ImageContextManager } from '../ui/ImageContext';
import { createInputToolbar } from '../ui/InputToolbar';
import { InstructionModeManager as InstructionModeManagerClass } from '../ui/InstructionModeManager';
import { NavigationSidebar } from '../ui/NavigationSidebar';
import { OrchestratorGoalModal } from '../ui/OrchestratorGoalModal';
import {
  isOrchestratorModeActive,
  setOrchestratorModeActive,
  syncOrchestratorModeUI,
} from '../ui/orchestratorModeUi';
import { StatusPanel } from '../ui/StatusPanel';
import { autoResizeTextarea } from '../ui/textareaResize';
import { recalculateUsageForModel } from '../utils/usageInfo';
import { getTabProviderId } from './providerResolution';
import { getBlankTabModelOptions } from './tabModelPolicy';
import {
  applyProviderUIGating,
  cleanupTabRuntime,
  ensureTitleGenerationService,
  getProviderMcpManager,
  getTabCapabilities,
  getTabChatUIConfig,
  getTabHiddenCommands,
  getTabPermissionMode,
  getTabSettingsSnapshot,
  type ProviderCatalogInfo,
  refreshTabProviderUI,
  syncSlashCommandDropdownForProvider,
  syncTabProviderServices,
  updatePlanModeUI,
  updateTabProviderSettings,
} from './tabShared';
import type { TabData } from './types';

function initializeContextManagers(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom } = tab;
  const app = plugin.app;

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.inputEl,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl
  );
  tab.ui.fileContextManager.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin)));

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl
  );
}

function initializeSlashCommands(
  tab: TabData,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: { config: ProviderCommandDropdownConfig; getEntries: () => Promise<ProviderCommandEntry[]> } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onSelect: () => {},
      onHide: () => {},
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      providerConfig: catalogInfo?.config,
      getProviderEntries: catalogInfo?.getEntries,
    }
  );
}

/**
 * Initializes instruction mode and todo panel for a tab.
 */
function initializeInstructionAndTodo(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom } = tab;

  syncTabProviderServices(tab, plugin);
  ensureTitleGenerationService(tab, plugin);
  tab.ui.instructionModeManager = new InstructionModeManagerClass(
    dom.inputEl,
    {
      onSubmit: async (rawInstruction) => {
        await tab.controllers.inputController?.handleInstructionSubmit(rawInstruction);
      },
      getInputWrapper: () => dom.inputWrapper,
    }
  );

  // Bang bash mode (! command execution)
  if (isBangBashEnabled(plugin.settings)) {
    const vaultPath = getVaultPath(plugin.app);
    if (vaultPath) {
      const enhancedPath = getEnhancedPath();
      const bashService = new BangBashService(vaultPath, enhancedPath);

      tab.ui.bangBashModeManager = new BangBashModeManagerClass(
        dom.inputEl,
        {
          onSubmit: async (command) => {
            const statusPanel = tab.ui.statusPanel;
            if (!statusPanel) return;

            const id = `bash-${Date.now()}`;
            statusPanel.addBashOutput({ id, command, status: 'running', output: '' });

            const result = await bashService.execute(command);
            const output = [result.stdout, result.stderr, result.error].filter(Boolean).join('\n').trim();
            const status = result.exitCode === 0 ? 'completed' : 'error';
            statusPanel.updateBashOutput(id, { status, output, exitCode: result.exitCode });
          },
          getInputWrapper: () => dom.inputWrapper,
        }
      );
    }
  }

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}

function isBangBashEnabled(settings: Record<string, unknown>): boolean {
  return ProviderRegistry.getEnabledProviderIds(settings).some((providerId) => (
    ProviderRegistry.getChatUIConfig(providerId).isBangBashEnabled?.(settings) ?? false
  ));
}

/**
 * Creates and wires the input toolbar for a tab.
 */
function initializeInputToolbar(
  tab: TabData,
  plugin: ClaudianPlugin,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
  onProviderChanged?: (providerId: ProviderId) => void | Promise<void>,
): void {
  const { dom } = tab;

  const inputToolbar = dom.inputWrapper.createDiv({ cls: 'claudian-input-toolbar' });

  // Blank-tab UI config wrapper that returns mixed model options
  const blankTabUIConfigProxy = (): ProviderChatUIConfig => {
    const draftProvider = tab.draftModel
      ? getEnabledProviderForModel(tab.draftModel, plugin.settings)
      : DEFAULT_CHAT_PROVIDER_ID;
    const baseConfig = ProviderRegistry.getChatUIConfig(draftProvider);
    return {
      ...baseConfig,
      getModelOptions: (settings: Record<string, unknown>) =>
        getBlankTabModelOptions(settings),
    };
  };

  const toolbarComponents = createInputToolbar(inputToolbar, {
    getUIConfig: () => {
      if (tab.lifecycleState === 'blank') {
        return blankTabUIConfigProxy();
      }
      return getTabChatUIConfig(tab, plugin);
    },
    getCapabilities: () => getTabCapabilities(tab, plugin),
    getSettings: () => getTabSettingsSnapshot(tab, plugin),
    getEnvironmentVariables: () => plugin.getActiveEnvironmentVariables(),
    onModelChange: async (model: string) => {
      // For blank tabs, update draft model and derive provider
      if (tab.lifecycleState === 'blank') {
        const previousProvider = tab.providerId;
        tab.draftModel = model;
        const newProvider = getEnabledProviderForModel(
          model,
          plugin.settings,
        );
        const didProviderChange = newProvider !== previousProvider;
        if (tab.service) {
          // Await so the outgoing runtime's CLI process exits before the next
          // send constructs a replacement for the newly selected provider.
          await cleanupTabRuntime(tab);
        }
        tab.providerId = newProvider;
        if (didProviderChange) {
          syncTabProviderServices(tab, plugin);
        }
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig);

        // Update settings for the new provider
        const uiConfig = ProviderRegistry.getChatUIConfig(newProvider);
        await updateTabProviderSettings(tab, plugin, (settings) => {
          settings.model = model;
          uiConfig.applyModelDefaults(model, settings);
        });
        if (didProviderChange) {
          await onProviderChanged?.(newProvider);
        }
        await uiConfig.prepareModelMetadata?.(model, plugin.settings, { plugin });
        tab.ui.thinkingBudgetSelector?.updateDisplay();
        tab.ui.serviceTierToggle?.updateDisplay();
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.modeSelector?.updateDisplay();
        // Re-render options (provider may have changed reasoning controls)
        tab.ui.modelSelector?.renderOptions();
        tab.ui.modeSelector?.renderOptions();
        applyProviderUIGating(tab, plugin);
        return;
      }

      // For bound tabs, reject cross-provider model changes
      const boundProvider = tab.providerId;
      const modelProvider = getProviderForModel(model, plugin.settings);
      if (modelProvider !== boundProvider) {
        new Notice(t('chat.tab.providerSwitchBlocked'));
        tab.ui.modelSelector?.updateDisplay();
        return;
      }

      const uiConfig: ProviderChatUIConfig = getTabChatUIConfig(tab, plugin);
      const providerSettings = await updateTabProviderSettings(tab, plugin, (settings) => {
        settings.model = model;
        uiConfig.applyModelDefaults(model, settings);
      });
      await uiConfig.prepareModelMetadata?.(model, plugin.settings, { plugin });
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();

      // Recalculate context usage percentage for the new model's context window
      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = resolveModelContextWindow(
          uiConfig,
          providerSettings,
          model,
          providerSettings.customContextLimits,
        );
        tab.state.usage = recalculateUsageForModel(currentUsage, model, newContextWindow);
      }
    },
    onModeChange: async (mode: string) => {
      await updateTabProviderSettings(tab, plugin, (settings) => {
        getTabChatUIConfig(tab, plugin).applyModeSelection?.(mode, settings);
      });
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
    },
    onThinkingBudgetChange: async (budget: string) => {
      await updateTabProviderSettings(tab, plugin, (settings) => {
        settings.thinkingBudget = budget;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, budget, settings);
      });
    },
    onEffortLevelChange: async (effort: string) => {
      await updateTabProviderSettings(tab, plugin, (settings) => {
        settings.effortLevel = effort;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, effort, settings);
      });
    },
    onServiceTierChange: async (serviceTier: string) => {
      await updateTabProviderSettings(tab, plugin, (settings) => {
        settings.serviceTier = serviceTier;
      });
      tab.ui.serviceTierToggle?.updateDisplay();
    },
    onPermissionModeChange: async (mode: string) => {
      await updateTabProviderSettings(tab, plugin, (settings) => {
        const uiConfig = getTabChatUIConfig(tab, plugin);
        if (uiConfig.applyPermissionMode) {
          uiConfig.applyPermissionMode(mode, settings);
        } else {
          settings.permissionMode = mode;
        }
      });
      await maybeWarnYoloMode(plugin, mode);
      tab.ui.permissionToggle?.updateDisplay();
      tab.ui.planModeToggle?.updateDisplay();
      dom.inputWrapper.toggleClass(
        'claudian-input-plan-mode',
        mode === 'plan' && getTabCapabilities(tab, plugin).supportsPlanMode,
      );
    },
    onPlanModeToggle: async () => {
      const planValue = getTabChatUIConfig(tab, plugin).getPermissionModeToggle?.()?.planValue;
      if (!planValue || !getTabCapabilities(tab, plugin).supportsPlanMode) {
        return;
      }
      const current = getTabPermissionMode(tab, plugin);
      if (current === planValue) {
        const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
        tab.state.prePlanPermissionMode = null;
        await updatePlanModeUI(tab, plugin, restoreMode);
      } else {
        tab.state.prePlanPermissionMode = current;
        await updatePlanModeUI(tab, plugin, planValue);
      }
    },
    getOrchestratorEnabled: () => {
      if (tab.orchestratorTabId) {
        return false;
      }
      return plugin.settings.orchestratorEnabled !== false;
    },
    getOrchestratorMode: () => isOrchestratorModeActive(tab, plugin),
    onOrchestratorOpen: () => {
      if (tab.orchestratorTabId) {
        return;
      }
      const isActive = isOrchestratorModeActive(tab, plugin);
      new OrchestratorGoalModal(plugin.app, {
        isActive,
        onTurnOff: async () => {
          await setOrchestratorModeActive(tab, plugin, false);
        },
        onSubmit: async (goal) => {
          if (!isOrchestratorModeActive(tab, plugin)) {
            await setOrchestratorModeActive(tab, plugin, true);
          }
          syncOrchestratorModeUI(tab, plugin);
          void tab.controllers.inputController?.sendMessage({ content: goal });
        },
      }).open();
    },
    onQuickActionsOpen: () => {
      const storage = new QuickActionStorage(
        plugin.storage.getAdapter(),
        () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
      );
      new QuickActionsModal(plugin.app, {
        storage,
        onRun: (action) => {
          void tab.controllers.inputController?.sendMessage({ content: action.prompt });
        },
      }).open();
    },
  });

  tab.ui.modelSelector = toolbarComponents.modelSelector;
  tab.ui.modeSelector = toolbarComponents.modeSelector;
  tab.ui.thinkingBudgetSelector = toolbarComponents.thinkingBudgetSelector;
  tab.ui.contextUsageMeter = toolbarComponents.contextUsageMeter;
  tab.ui.externalContextSelector = toolbarComponents.externalContextSelector;
  tab.ui.mcpServerSelector = toolbarComponents.mcpServerSelector;
  tab.ui.permissionToggle = toolbarComponents.permissionToggle;
  tab.ui.planModeToggle = toolbarComponents.planModeToggle;
  tab.ui.orchestratorToggle = toolbarComponents.orchestratorToggle;
  tab.ui.quickActionsToggle = toolbarComponents.quickActionsToggle;
  tab.ui.serviceTierToggle = toolbarComponents.serviceTierToggle;

  tab.ui.mcpServerSelector.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin)));

  // Sync @-mentions to UI selector
  tab.ui.fileContextManager?.setOnMcpMentionChange((servers) => {
    tab.ui.mcpServerSelector?.addMentionedServers(servers);
  });

  // Wire external context changes
  tab.ui.externalContextSelector.setOnChange(() => {
    tab.ui.fileContextManager?.preScanExternalContexts();
  });

  // Initialize persistent paths
  tab.ui.externalContextSelector.setPersistentPaths(
    plugin.settings.persistentExternalContextPaths || []
  );

  // Wire persistence changes
  tab.ui.externalContextSelector.setOnPersistenceChange((paths) => {
    plugin.settings.persistentExternalContextPaths = paths;
    void plugin.saveSettings();
  });

  refreshTabProviderUI(tab, plugin);

  // Gate provider-specific UI elements
  applyProviderUIGating(tab, plugin);
}

export interface InitializeTabUIOptions {
  getProviderCatalogConfig?: () => ProviderCatalogInfo;
  onProviderChanged?: (providerId: ProviderId) => void | Promise<void>;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  plugin: ClaudianPlugin,
  options: InitializeTabUIOptions = {}
): void {
  const { dom, state } = tab;

  // Initialize context managers (file/image)
  initializeContextManagers(tab, plugin);

  // Selection indicator - add to contextRowEl
  dom.selectionIndicatorEl = dom.contextRowEl.createDiv({ cls: 'claudian-selection-indicator claudian-hidden' });

  dom.browserIndicatorEl = dom.contextRowEl.createDiv({ cls: 'claudian-browser-selection-indicator claudian-hidden' });

  dom.canvasIndicatorEl = dom.contextRowEl.createDiv({ cls: 'claudian-canvas-indicator claudian-hidden' });

  const catalogInfo = options.getProviderCatalogConfig?.() ?? null;
  initializeSlashCommands(
    tab,
    () => getTabHiddenCommands(tab, plugin),
    catalogInfo,
  );

  if (dom.messagesEl.parentElement) {
    tab.ui.navigationSidebar = new NavigationSidebar(
      dom.messagesEl.parentElement,
      dom.messagesEl
    );
  }

  initializeInstructionAndTodo(tab, plugin);
  initializeInputToolbar(tab, plugin, options.getProviderCatalogConfig, options.onProviderChanged);

  state.callbacks = {
    ...state.callbacks,
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
    },
    onTodosChanged: (todos) => tab.ui.statusPanel?.updateTodos(todos),
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
  };

  // ResizeObserver to detect overflow changes (e.g., content growth)
  const resizeObserver = new ResizeObserver(() => {
    tab.ui.navigationSidebar?.updateVisibility();
  });
  resizeObserver.observe(dom.messagesEl);
  dom.eventCleanups.push(() => resizeObserver.disconnect());
}

// SECURITY (SEC-1): 'yolo' maps to SDK bypassPermissions — tools run with no
// approval UI. Warn the user the first time they opt in, then persist a flag so
// the Notice shows only once.
export async function maybeWarnYoloMode(plugin: ClaudianPlugin, mode: string): Promise<void> {
  if (mode !== 'yolo' || plugin.settings.yoloModeWarningShown) {
    return;
  }
  plugin.settings.yoloModeWarningShown = true;
  await plugin.saveSettings();
  new Notice(t('chat.permissionMode.yoloWarning'), 12000);
}
