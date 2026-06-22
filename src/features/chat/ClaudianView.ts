import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';

import type { ChatTabReservation } from '../../core/chatTabReservations';
import { GIT_COMMIT_PROMPT } from '../../core/prompt/gitCommit';
import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import { asSettingsBag, VIEW_TYPE_CLAUDIAN } from '../../core/types';
import { t } from '../../i18n/i18n';
import type ClaudianPlugin from '../../main';
import { createProviderIconSvg } from '../../shared/icons';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import { openPluginSettingsTab } from '../../utils/obsidianPrivateApi';
import { renderAgentAvatar } from '../agents/agentAvatar';
import { rosterAgentToPersona } from '../agents/personaRegistry';
import { openQuickActionsModal } from '../quickActions/openQuickActionsModal';
import { dispatchQuickActionToTab } from '../quickActions/runQuickActionForFile';
import { resolveModelContextWindow } from '../settings/customModels/resolveModelContextWindow';
import { ClaudianViewWorkOrderBridge } from './ClaudianViewWorkOrderBridge';
import type { HistoryConversationOpenState } from './controllers/ConversationController';
import {
  type HydrationFailedBannerPayload,
  registerHydrationFailedSubscriber,
} from './hydration/hydrationFailedSubscriber';
import {
  getTabProviderId,
  getTabTitle,
  onProviderAvailabilityChanged,
  sendTabInputMessageFromExplicitEnterShortcut,
  updatePlanModeUI,
} from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import type { TabData, TabId, TaskRunTabHandle } from './tabs/types';
import { GitActionButton } from './ui/GitActionButton';
import { WorkOrderActivityDropdown } from './ui/WorkOrderActivityDropdown';
import { deriveEditedFilesFromMessages } from './utils/editedFiles';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;
  private _workOrderBridge: ClaudianViewWorkOrderBridge | null = null;

  // Tab management
  private tabManager: TabManager | null = null;
  // False until restoreOrCreateTabs() finishes: the tab manager is assigned
  // before the async restore runs, so the Agent Board queue must not count the
  // live tab count during that window or it can overbook the cap / drop tabs.
  private tabsRestored = false;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  /** History hydration failures awaiting a bound tab to render their banner. */
  private pendingHydrationErrors = new Map<string, { code: string; message: string }>();

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private titleSlotEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private titleTextEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private headerActionsContent: HTMLElement | null = null;
  private workOrderActivitySlotEl: HTMLElement | null = null;
  private workOrderActivityDropdown: WorkOrderActivityDropdown | null = null;
  private disposeWorkOrderActivitySubscription: (() => void) | null = null;
  private newTabButtonEl: HTMLElement | null = null;
  private gitActionButton: GitActionButton | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;
  private headerMetaRowEl: HTMLElement | null = null;
  private boundAgentChipSlotEl: HTMLElement | null = null;
  // Monotonic token so concurrent syncBoundAgentChip calls don't double-render.
  private boundAgentChipGen = 0;

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this) as () => Promise<void> | void;
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'Claudian';
  }

  getIcon(): string {
    return 'bot';
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      // onProviderAvailabilityChanged detaches any stale runtime synchronously
      // and tracks its async cleanup on the tab; initializeTabService awaits that
      // pending cleanup before constructing a replacement, so this fire-and-forget
      // call can never overlap the old CLI process with a new one.
      onProviderAvailabilityChanged(tab, this.plugin).catch((error) =>
        this.plugin.logger.scope('chat').error('provider-availability runtime cleanup failed', error),
      );
      const providerId = getTabProviderId(tab, this.plugin);
      const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        this.plugin.settings,
        providerId,
      );
      const model = providerSettings.model;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const capabilities = ProviderRegistry.getCapabilities(providerId);
      const contextWindow = resolveModelContextWindow(
        uiConfig,
        providerSettings,
        model,
        providerSettings.customContextLimits,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
      }

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
        providerSettings.permissionMode === 'plan' && capabilities.supportsPlanMode,
      );
    }

    this.gitActionButton?.updateDisplay();
    this.tabManager?.primeProviderRuntime();
  }

  /**
   * Re-applies the "show files changed by the agent" setting to open tabs so the
   * toggle takes effect immediately in the current session: clears the strip when
   * disabled, and rebuilds it from each tab's transcript when re-enabled.
   */
  applyEditedFilesSetting(): void {
    const enabled = this.plugin.settings.showAgentEditedFiles !== false;
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      if (enabled) {
        tab.state.setEditedFiles(deriveEditedFilesFromMessages(this.plugin.app, tab.state.messages));
      } else {
        tab.state.clearEditedFiles();
      }
    }
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId | ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  async onOpen() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container');

    const header = this.viewContainerEl.createDiv({ cls: 'claudian-header' });
    this.buildHeader(header);

    // View-lifecycle event handlers + keyboard scope. These null-guard the tab
    // manager, so they are safe to register once per open whether or not a
    // provider is enabled (and survive empty<->content transitions).
    this.wireEventHandlers();

    // No enabled provider means there is nothing to chat with. Render a
    // configure-first placeholder and skip tab manager creation entirely.
    const enabledProviders = ProviderRegistry.getEnabledProviderIds(
      asSettingsBag(this.plugin.settings),
    );
    if (enabledProviders.length === 0) {
      this.renderEmptyState(this.viewContainerEl);
      return;
    }

    await this.initTabContent();
  }

  /** Builds the tab UI + manager. The header must already be rendered. */
  private async initTabContent(): Promise<void> {
    if (!this.viewContainerEl) {
      return;
    }
    this.emptyStateEl?.remove();
    this.emptyStateEl = null;

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'claudian-tab-content-container' });

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateNavRowLocation();
          this.gitActionButton?.updateDisplay();
          this.persistTabState();
          this.syncProviderBrandColor();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.syncHeaderTitle();
          this.updateHistoryDropdown();
          this.updateNavRowLocation();
          this.gitActionButton?.updateDisplay();
          this.persistTabState();
          this.syncProviderBrandColor();
          void this.syncBoundAgentChip();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.syncHeaderTitle();
          this.persistTabState();
        },
        onTabStreamingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => {
          this.updateTabBar();
          this.syncHeaderTitle();
        },
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.syncHeaderTitle();
          this.gitActionButton?.updateDisplay();
          this.persistTabState();
          this.syncProviderBrandColor();
          void this.syncBoundAgentChip();
        },
        onTabProviderChanged: () => {
          this.updateTabBar();
          this.gitActionButton?.updateDisplay();
          this.syncProviderBrandColor();
        },
      }
    );

    await this.restoreOrCreateTabs();
    this.tabsRestored = true;
    // Notify Agent Board queue the tab budget is now readable. During
    // restoreOrCreateTabs(), each createTab() fires chat:tabs-changed but
    // areTabsRestored() was still false, so getTabSlotUsage() reported full
    // capacity via the hasClaudianLeaf fallback. Now that tabsRestored is true
    // the correct work-order count can be read; fire once so the queue
    // re-evaluates without waiting for the next manual tab create/close.
    this.plugin.events.emit('chat:tabs-changed', {
      openCount: this.tabManager?.getTabCount() ?? 0,
      chatCount: this.tabManager?.countTabsByKind('chat') ?? 0,
      workOrderCount: this.tabManager?.countTabsByKind('work-order') ?? 0,
    });
    this.syncProviderBrandColor();
    this.syncHeaderTitle();
    void this.syncBoundAgentChip();
    this.updateLayoutForPosition();
    this.tabManager?.primeProviderRuntime();
  }

  /** Flushes pending tab-bar work, persists tab state, and destroys the tab
   * manager + tab bar. Shared by the in-place teardown and view close paths. */
  private async destroyTabRuntime(): Promise<void> {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }
    await this.persistTabStateImmediate();
    await this.tabManager?.destroy();
    this.tabManager = null;
    this.tabBar?.destroy();
    this.tabBar = null;
  }

  /** Tears down the tab UI (manager + tab bar + DOM) without touching the
   * view-lifecycle event handlers/scope, so the empty state can take over. */
  private async teardownTabContent(): Promise<void> {
    await this.destroyTabRuntime();
    this.tabBarContainerEl?.remove();
    this.tabBarContainerEl = null;
    this.tabContentEl?.remove();
    this.tabContentEl = null;
    this.navRowContent?.remove();
    this.navRowContent = null;
    this.disposeWorkOrderActivityDropdown();
    this.headerActionsContent?.remove();
    this.headerActionsContent = null;
    this.newTabButtonEl = null;
    this.historyDropdown = null;
    this.boundAgentChipSlotEl?.empty();
    this.gitActionButton?.dispose();
    this.gitActionButton = null;
  }

  /**
   * Re-evaluates provider availability. When the panel is showing the
   * configure-first empty state and a provider has since been enabled (e.g. from
   * settings), it promotes the panel to the full tab UI without requiring a
   * close/reopen.
   */
  async refreshProviderAvailability(): Promise<void> {
    if (!this.viewContainerEl) {
      return;
    }
    const hasProviders = ProviderRegistry.getEnabledProviderIds(
      asSettingsBag(this.plugin.settings),
    ).length > 0;

    if (hasProviders && !this.tabManager) {
      // A provider was enabled while the empty state was showing.
      await this.initTabContent();
    } else if (!hasProviders && this.tabManager) {
      // The last provider was disabled; drop back to the empty state in place.
      await this.teardownTabContent();
      if (this.headerEl) {
        this.headerEl.empty();
        this.buildHeader(this.headerEl);
      }
      this.renderEmptyState(this.viewContainerEl);
    }
  }

  async onClose() {
    // Vault events registered via registerEvent are auto-released by the
    // Component lifecycle — no manual offref sweep needed.
    await this.destroyTabRuntime();
    this.disposeWorkOrderActivityDropdown();
    this.gitActionButton?.dispose();
    this.gitActionButton = null;
    this.scope = null;
  }

  // ============================================
  // UI Building
  // ============================================

  /** Renders a configure-first placeholder when no chat provider is enabled. */
  private renderEmptyState(container: HTMLElement): void {
    const emptyState = (this.emptyStateEl = container.createDiv({ cls: 'claudian-empty-state' }));
    emptyState.createEl('h3', {
      cls: 'claudian-empty-state-title',
      text: 'Welcome to Claudian',
    });
    emptyState.createEl('p', {
      cls: 'claudian-empty-state-message',
      text: 'Claudian runs a coding-agent CLI inside Obsidian — your vault is its workspace. Set up one provider to get started:',
    });

    const steps = emptyState.createEl('ol', { cls: 'claudian-empty-state-steps' });
    steps.createEl('li', {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Claude Code" is a product name.
      text: 'Open settings → Claudian → general and enable a provider (Claude Code, Cursor, Codex, or OpenCode).',
    });
    steps.createEl('li', {
      text: "In that provider's settings tab, set the path to its CLI (install the CLI first if you haven't).",
    });
    steps.createEl('li', {
      text: 'Come back here and start chatting.',
    });

    const button = emptyState.createEl('button', {
      cls: 'claudian-empty-state-button mod-cta',
      text: 'Open settings',
    });
    button.addEventListener('click', () => this.openPluginSettings());
  }

  /** Opens the Obsidian settings dialog focused on the Claudian plugin tab. */
  private openPluginSettings(): void {
    openPluginSettingsTab(this.app, this.plugin.manifest.id);
  }

  private buildHeader(header: HTMLElement) {
    this.headerEl = header;

    // Row 1: title (logo + title text; tab badges mount here in header mode).
    const titleRow = header.createDiv({ cls: 'claudian-header-title-row' });
    this.titleSlotEl = titleRow.createDiv({ cls: 'claudian-title-slot' });

    // Logo (hidden when 2+ tabs) — populated by syncHeaderLogo()
    this.logoEl = this.titleSlotEl.createSpan({ cls: 'claudian-logo' });
    this.syncHeaderLogo(DEFAULT_CHAT_PROVIDER_ID);

    // Title text (hidden in header mode when 2+ tabs)
    this.titleTextEl = this.titleSlotEl.createEl('h4', { text: 'Claudian', cls: 'claudian-title-text' });

    // Row 2: bound-agent chip (left) + header actions (Git, and the action
    // cluster in header mode — right). Collapsed by updateHeaderMetaRow() when it
    // has neither a chip nor visible actions, so an unbound conversation with
    // nothing to commit shows only the title row.
    this.headerMetaRowEl = header.createDiv({ cls: 'claudian-header-meta-row claudian-hidden' });
    this.boundAgentChipSlotEl = this.headerMetaRowEl.createDiv({ cls: 'claudian-bound-agent-chip-slot' });
    this.headerActionsEl = this.headerMetaRowEl.createDiv({ cls: 'claudian-header-actions claudian-header-actions-slot claudian-hidden' });

    if (this.plugin.gitStatusWatcher) {
      this.gitActionButton = new GitActionButton(this.headerActionsEl, {
        subscribeGitStatus: (cb) => this.plugin.gitStatusWatcher!.subscribe(cb),
        isGitActionsEnabled: () => this.isActiveTabGitActionEnabled(),
        onGitCommit: () => this.sendGitCommitPromptToActiveTab(),
      });
      this.headerActionsEl.removeClass('claudian-hidden');
    }

    this.updateHeaderMetaRow();
  }

  /**
   * Shows the second header row only when it carries content — a bound-agent
   * chip and/or a visible actions slot (Git / the header-mode cluster) — so the
   * row collapses cleanly for an unbound conversation with nothing to commit.
   */
  private updateHeaderMetaRow(): void {
    if (!this.headerMetaRowEl) return;
    const hasChip = (this.boundAgentChipSlotEl?.childElementCount ?? 0) > 0;
    const hasActions = this.headerActionsEl != null && !this.headerActionsEl.hasClass('claudian-hidden');
    this.headerMetaRowEl.toggleClass('claudian-hidden', !hasChip && !hasActions);
  }

  /**
   * Builds the nav row content (tab badges + header actions).
   * This is called once and the content is moved between locations.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument = this.containerEl.ownerDocument;

    // Create a fragment to hold nav row content
    const fragment = activeDocument.createDocumentFragment();

    // Tab badges (left side in nav row, or in title slot for header mode)
    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'claudian-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice(t('chat.tab.createFailed')));
      },
    });
    fragment.appendChild(this.tabBarContainerEl);

    // Header actions (right side)
    this.headerActionsContent = activeDocument.createElement('div');
    this.headerActionsContent.className = 'claudian-header-actions';

    // Work-order activity slot (first) — mounts the WO dropdown when any
    // running / needs-input / finished work-order tab exists. Placed before
    // Quick Actions so the persistent button order stays stable; the dropdown
    // toggles `claudian-hidden` when empty so flex gap collapses.
    this.workOrderActivitySlotEl = this.headerActionsContent.createDiv({ cls: 'claudian-work-order-activity-slot' });
    this.mountWorkOrderActivityDropdown();

    // Quick actions button — opens the QuickActionsModal scoped to the active tab.
    // Lives above the textarea in nav row mode and at the top of the header in header mode.
    const quickActionsBtn = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn' });
    setIcon(quickActionsBtn, 'zap');
    quickActionsBtn.setAttribute('aria-label', t('quickActions.toolbar.ariaLabel'));
    quickActionsBtn.setAttribute('title', t('quickActions.toolbar.title'));
    // Pre-warm the Skills tab cache on hover so the modal opens against a hot cache.
    // Idempotent: VaultSkillAggregator deduplicates concurrent fetches per provider.
    quickActionsBtn.addEventListener('mouseenter', () => {
      void this.plugin.vaultSkillAggregator?.listAllStreaming(() => {});
    });
    quickActionsBtn.addEventListener('click', () => {
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      openQuickActionsModal(this.plugin, {
        onRun: (action) => {
          // Resolve the active tab at run time — user may have switched tabs while the modal was open.
          const targetTab = this.tabManager?.getActiveTab();
          if (!targetTab) return;
          // Route through the shared dispatcher so this entry point emits
          // usage.recorded on success, same as the context-menu + favorites
          // paths. Bypassing the helper here previously caused the leaderboard
          // to undercount header-launched runs.
          void dispatchQuickActionToTab(this.plugin, targetTab, action);
        },
      });
    });

    // New tab button (plus icon)
    this.newTabButtonEl = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn claudian-new-tab-btn' });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.setAttribute('aria-label', 'New tab');
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice(t('chat.tab.createFailed')));
    });

    // New conversation button (square-pen icon - new conversation in current tab)
    const newBtn = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn' });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', 'New conversation');
    newBtn.addEventListener('click', () => {
      void (async () => {
        await this.tabManager?.createNewConversation();
        this.updateHistoryDropdown();
      })().catch(() => new Notice(t('chat.tab.createConversationFailed')));
    });

    // History dropdown
    const historyContainer = this.headerActionsContent.createDiv({ cls: 'claudian-history-container' });
    const historyBtn = historyContainer.createDiv({ cls: 'claudian-header-btn' });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', 'Chat history');

    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });

    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    fragment.appendChild(this.headerActionsContent);

    // Create a wrapper div to hold the fragment (for input mode nav row)
    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'claudian-input-nav-content';
    wrapper.appendChild(fragment);
    return wrapper;
  }


  private mountWorkOrderActivityDropdown(): void {
    if (!this.workOrderActivitySlotEl || !this.plugin.workOrderActivity) return;
    this.disposeWorkOrderActivitySubscription?.();
    this.workOrderActivityDropdown?.destroy();
    this.workOrderActivityDropdown = new WorkOrderActivityDropdown(this.workOrderActivitySlotEl, {
      summary: this.plugin.workOrderActivity.getSummary(),
      onOpenItem: (id) => this.plugin.workOrderActivity?.openItem(id),
      onCloseItem: (tabId) => this.plugin.workOrderActivity?.closeTab(tabId),
    });
    this.disposeWorkOrderActivitySubscription = this.plugin.workOrderActivity.subscribe((summary) => {
      this.workOrderActivityDropdown?.update(summary);
    });
  }

  private disposeWorkOrderActivityDropdown(): void {
    this.disposeWorkOrderActivitySubscription?.();
    this.disposeWorkOrderActivitySubscription = null;
    this.workOrderActivityDropdown?.destroy();
    this.workOrderActivityDropdown = null;
    this.workOrderActivitySlotEl = null;
  }

  /**
   * Moves nav row content based on tabBarPosition setting.
   * - 'input' mode: Both tab badges and actions go to active tab's navRowEl
   * - 'header' mode: Tab badges go to title slot (after logo), actions go to header right side
   */
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl || !this.headerActionsContent) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    if (isHeaderMode) {
      // Header mode: Tab badges go to title slot, actions go to header right side
      if (this.titleSlotEl) {
        this.titleSlotEl.appendChild(this.tabBarContainerEl);
      }
      if (this.headerActionsEl) {
        this.headerActionsEl.appendChild(this.headerActionsContent);
        this.headerActionsEl.removeClass('claudian-hidden');
      }
    } else {
      // Input mode: Both go to active tab's navRowEl via the wrapper
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab && this.navRowContent) {
        // Re-assemble the nav row content wrapper
        this.navRowContent.appendChild(this.tabBarContainerEl);
        this.navRowContent.appendChild(this.headerActionsContent);
        activeTab.dom.navRowEl.appendChild(this.navRowContent);
      }
      // Hide header actions slot when in input mode
      if (this.headerActionsEl) {
        this.headerActionsEl.toggleClass('claudian-hidden', !this.gitActionButton);
      }
    }

    // The actions-slot visibility just changed; recompute the meta row so it
    // collapses or shows alongside the chip.
    this.updateHeaderMetaRow();
  }

  /**
   * Updates layout when tabBarPosition setting changes.
   * Called from settings when user changes the tab bar position.
   */
  updateLayoutForPosition(): void {
    if (!this.viewContainerEl) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Update container class for CSS styling
    this.viewContainerEl.toggleClass('claudian-container--header-mode', isHeaderMode);

    // Move nav content to appropriate location
    this.updateNavRowLocation();

    // Update tab bar and title visibility
    this.updateTabBarVisibility();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private isActiveTabGitActionEnabled(): boolean {
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab) {
      return false;
    }

    const providerId = getTabProviderId(activeTab, this.plugin);
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      providerId,
    );

    return ProviderRegistry.getChatUIConfig(providerId).isGitActionsEnabled?.(settings) !== false;
  }

  private sendGitCommitPromptToActiveTab(): void {
    const inputController = this.tabManager?.getActiveTab()?.controllers.inputController;
    if (!inputController) {
      return;
    }

    void inputController.sendMessage({ content: GIT_COMMIT_PROMPT });
  }

  /** Opens a fresh chat tab pinned to the work order's provider/model and auto-sends its prompt. */
  /**
   * Opens a fresh tab for a work-order run and returns a live handle: the caller
   * (the Agent Board, via its execution surface) observes the stream, sends
   * follow-ups, and awaits the terminal result without the tab being focused.
   * Returns null when no tab could be opened (view not ready / tab cap reached).
   */
  // Lazily built so prototype-only test instances (which skip the constructor)
  // still resolve the bridge through the same callbacks the real view wires.
  private get workOrderBridge(): ClaudianViewWorkOrderBridge {
    if (!this._workOrderBridge) {
      this._workOrderBridge = new ClaudianViewWorkOrderBridge({
        getTabManager: () => this.tabManager,
        findConversationTab: (conversationId) => {
          const cross = this.plugin.findConversationAcrossViews(conversationId);
          if (!cross) return null;
          const tabManager = cross.view === this ? this.tabManager : cross.view.getTabManager();
          return { tabManager, tabId: cross.tabId };
        },
        openConversationInNewTab: async (conversationId) => {
          await this.tabManager?.openConversation(conversationId, { preferNewTab: true });
        },
      });
    }
    return this._workOrderBridge;
  }

  startTaskRunInFreshTab(options: {
    providerId: ProviderId;
    model: string;
    prompt: string;
    tabReservation?: ChatTabReservation;
    workOrderPath?: string;
    boundAgentId?: string;
  }): Promise<TaskRunTabHandle | null> {
    return this.workOrderBridge.startTaskRunInFreshTab(options);
  }

  /**
   * Routes a commit-and-push prompt into a work-order's chat. Delegates to
   * {@link ClaudianViewWorkOrderBridge}; the cross-view conversation lookup is
   * supplied as a `findConversationTab` callback at construction.
   */
  injectCommitTurnForConversation(options: {
    conversationId: string | null;
    fallbackProviderId: ProviderId;
    fallbackModel: string;
    prompt: string;
  }): Promise<void> {
    return this.workOrderBridge.injectCommitTurnForConversation(options);
  }

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice(t('chat.tab.switchFailed')));
    }
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      const tab = this.tabManager?.getTab(tabId);
      // If streaming, treat close like user interrupt (force close cancels the stream)
      const force = tab?.state.isStreaming ?? false;
      await this.tabManager?.closeTab(tabId, force);
      this.updateTabBarVisibility();
    } catch {
      new Notice(t('chat.tab.closeFailed'));
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxChatTabs ?? 3;
      new Notice(t('chat.tabs.maxChatReached', { count: String(maxTabs) }));
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.countTabsByKind('chat');
    // Normally the bar hides with a single chat tab. But a hidden work-order
    // tab can be the active tab (opened from the Work Orders dropdown), and
    // work-order badges are omitted from getTabBarItems(); once that work order
    // is terminal it also drops out of the dropdown. Without surfacing the bar
    // here the user is stranded on the work-order tab with no visible control
    // to switch back. Show it whenever a work-order tab is active and at least
    // one chat tab exists to return to.
    const activeIsWorkOrder = this.tabManager.getActiveTab()?.kind === 'work-order';
    const showTabBar = tabCount >= 2 || (activeIsWorkOrder && tabCount >= 1);
    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Hide tab badges when only 1 tab, show when 2+
    this.tabBarContainerEl.toggleClass('claudian-hidden', !showTabBar);

    // In header mode, badges replace logo/title in the same location
    // In input mode, keep logo/title visible (badges are in nav row)
    const hideBranding = showTabBar && isHeaderMode;
    if (this.logoEl) {
      this.logoEl.toggleClass('claudian-hidden', hideBranding);
    }
    if (this.titleTextEl) {
      this.titleTextEl.toggleClass('claudian-hidden', hideBranding);
    }

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('claudian-hidden', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  /** Sets `data-provider` on the root container so CSS brand color follows the active provider. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
    this.syncHeaderLogo(providerId);
  }

  /**
   * UX-4 — surface the active session's title in the header instead of the
   * static "Claudian" branding. The title was previously only visible by
   * hovering the tab badge; users couldn't tell what conversation was open
   * at a glance.
   *
   * Falls back to "Claudian" when no tab is active (empty state or tab
   * teardown). Tab-bar visibility logic (`updateLayoutForPosition`) still
   * decides whether the title element is shown at all — in header mode with
   * 2+ tabs the title hides because the badges replace it; this method only
   * controls the text content of the element.
   */
  private syncHeaderTitle(): void {
    if (!this.titleTextEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const title = activeTab ? getTabTitle(activeTab, this.plugin) : 'Claudian';
    this.titleTextEl.setText(title);
    this.titleTextEl.setAttribute('aria-label', title);
    this.titleTextEl.title = title;
  }

  /** Renders or clears the bound-agent chip below the header. */
  private async syncBoundAgentChip(): Promise<void> {
    const slot = this.boundAgentChipSlotEl;
    if (!slot) return;

    // Resolve everything BEFORE touching the DOM, guarded by a generation token.
    // Two near-simultaneous calls (e.g. active-tab change + refresh on chat open)
    // would otherwise each `empty()` then `await`, rendering two chips. Only the
    // latest invocation past the awaits mutates the slot.
    const gen = ++this.boundAgentChipGen;
    const conversationId = this.tabManager?.getActiveTab()?.conversationId;
    const conversation = conversationId
      ? await this.plugin.getConversationById(conversationId)
      : null;
    const agent = conversation?.boundAgentId
      ? await this.plugin.agentRosterStore?.get(conversation.boundAgentId)
      : null;
    if (gen !== this.boundAgentChipGen) return;

    slot.empty();
    if (conversationId && agent) {
      const chip = slot.createDiv({ cls: 'claudian-bound-agent-chip' });
      chip.setAttribute('title', t('agentRoster.chattingWith', { name: agent.name }));

      const avatarEl = chip.createDiv({ cls: 'claudian-bound-agent-chip-avatar' });
      renderAgentAvatar(avatarEl, rosterAgentToPersona(agent), 18);

      chip.createSpan({ cls: 'claudian-bound-agent-chip-label', text: agent.name });
    }
    this.updateHeaderMetaRow();
  }

  /**
   * Renders an inline error banner inside the conversation pane when history
   * hydration fails. Replaces the in-stream sentinel that Opencode used before
   * Task 4 (history-service-contract). No-op when no tab matches the id —
   * the `Notice` toast from `registerHydrationFailedSubscriber` is still shown.
   */
  /**
   * Records a history hydration failure so the conversation pane can surface it
   * as an inline banner. The failure is emitted synchronously during hydration —
   * before the target tab is bound to the conversation (`switchTo` rebinds only
   * in `restoreConversation`; `createTab` hydrates before the tab exists) — so a
   * lookup by `tab.conversationId` here would miss. Instead we stash it by
   * conversation id and let `ConversationController.restoreConversation` consume
   * it once the tab is bound. The `Notice` toast (raised by the subscriber) still
   * fires regardless, so a failure is never silent.
   */
  private renderHydrationErrorBanner(
    conversationId: string,
    payload: HydrationFailedBannerPayload,
  ): void {
    this.pendingHydrationErrors.set(conversationId, { code: payload.code, message: payload.message });
  }

  /** Returns and clears any pending hydration failure for a conversation. */
  consumePendingHydrationError(conversationId: string): { code: string; message: string } | null {
    const pending = this.pendingHydrationErrors.get(conversationId) ?? null;
    this.pendingHydrationErrors.delete(conversationId);
    return pending;
  }

  /** Rebuilds the header logo SVG to match the given provider. */
  private syncHeaderLogo(providerId: ProviderId): void {
    if (!this.logoEl) return;
    const icon = ProviderRegistry.getChatUIConfig(providerId).getProviderIcon?.();
    if (!icon) return;
    const existing = this.logoEl.querySelector('svg');
    if (existing?.getAttribute('data-provider') === providerId) return;
    this.logoEl.empty();
    const svg = createProviderIconSvg(icon, {
      dataProvider: providerId,
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationOpenState: (id) => this.getHistoryConversationOpenState(id),
      });
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.historyDropdown?.removeClass('visible');
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.historyDropdown?.removeClass('visible');
  }

  private getHistoryConversationOpenState(conversationId: string): HistoryConversationOpenState {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return 'current';
    }

    if (this.findTabWithConversation(conversationId)) {
      return 'open';
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      return 'open';
    }

    return 'closed';
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.historyDropdown?.removeClass('visible');
    });

    // View-level Shift+Tab to toggle plan mode (works from any focused element)
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const providerId = getTabProviderId(activeTab, this.plugin);
        if (!ProviderRegistry.getCapabilities(providerId).supportsPlanMode) return;
        const current = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          providerId,
        ).permissionMode as string;
        if (current === 'plan') {
          const restoreMode = activeTab.state.prePlanPermissionMode ?? 'normal';
          activeTab.state.prePlanPermissionMode = null;
          updatePlanModeUI(activeTab, this.plugin, restoreMode);
        } else {
          activeTab.state.prePlanPermissionMode = current;
          updatePlanModeUI(activeTab, this.plugin, 'plan');
        }
      }
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });

    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    // Vault events - forward to active tab's file context manager.
    // registerEvent ties the ref to this Component's lifecycle so cleanup
    // happens automatically on onunload — no need to track via eventRefs[].
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.registerEvent(this.plugin.app.vault.on('create', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('delete', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('rename', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('modify', () => markCacheDirty(false)));

    // UX-4: refresh header title + tab bar when the active tab's conversation
    // is renamed (manual rename or auto-title generation).
    this.register(this.plugin.events.on('conversation:renamed', (payload) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab?.conversationId === payload.conversationId) {
        this.syncHeaderTitle();
      }
      this.updateTabBar();
    }));

    // History Service Contract (Task 11): surface a Notice + inline banner when
    // `ConversationStore` reports a hydration / delete failure. Without this,
    // Opencode users with corrupt SQLite would see a blank pane (Task 4
    // removed the in-stream sentinel that used to render the error there).
    this.register(registerHydrationFailedSubscriber(this.plugin.events, (conversationId, payload) => {
      this.renderHydrationErrorBanner(conversationId, payload);
    }));

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = window.setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Whether the tab manager has finished restoring its persisted tabs. The
   *  Agent Board queue gates on this so it doesn't count an empty live tab set
   *  mid-restore and overbook the tab cap. */
  areTabsRestored(): boolean {
    return this.tabsRestored;
  }
}
