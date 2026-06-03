// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

import type { TFile, TFolder } from 'obsidian';
import { Notice, Plugin } from 'obsidian';

import { registerPluginCommands } from './app/commands/registerPluginCommands';
import { registerWorkspaceMenus } from './app/commands/registerWorkspaceMenus';
import { ConversationStore } from './app/conversations/ConversationStore';
import { EnvironmentApplyService } from './app/environment/EnvironmentApplyService';
import type { ClaudianEventMap } from './app/events/claudianEvents';
import { PluginLifecycle } from './app/lifecycle/PluginLifecycle';
import { DEFAULT_CLAUDIAN_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import { PluginViewActivator } from './app/views/PluginViewActivator';
import type { SharedAppStorage } from './core/bootstrap/storage';
import { EventBus } from './core/events/EventBus';
import { formatLogEntries } from './core/logging/formatLogEntries';
import { Logger } from './core/logging/Logger';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import type {
  ChatMessageAction,
  ClaudianSettings,
  Conversation,
  ConversationMeta,
  ConversationSnapshot,
} from './core/types';
import {
  VIEW_TYPE_CLAUDIAN,
  VIEW_TYPE_CLAUDIAN_AGENT_BOARD,
} from './core/types';
import type { PluginContext } from './core/types/PluginContext';
import type { EnvironmentScope } from './core/types/settings';
import { ClaudianView } from './features/chat/ClaudianView';
import { isClaudianView } from './features/chat/isClaudianView';
import type { GitStatusWatcher } from './features/chat/services/GitStatusWatcher';
import { ClaudianSettingTab } from './features/settings/ClaudianSettings';
import { ChatTabExecutionSurface } from './features/tasks/execution/ChatTabExecutionSurface';
import { ChatWorkOrderLinker } from './features/tasks/execution/ChatWorkOrderLinker';
import { AgentBoardView } from './features/tasks/ui/AgentBoardView';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import type { BrowserSelectionContext } from './utils/browser';
import { chatMessageText } from './utils/chatMessageText';
import { getVaultPath } from './utils/path';

export default class ClaudianPlugin extends Plugin implements PluginContext {
  settings!: ClaudianSettings;
  readonly events = new EventBus<ClaudianEventMap>();
  readonly logger = new Logger({ enabled: false, level: 'warn' });
  /** Optional, registry-driven actions rendered in the chat user-message toolbar. */
  readonly chatMessageActions: ChatMessageAction[] = [];
  storage!: SharedAppStorage;
  gitStatusWatcher: GitStatusWatcher | null = null;
  conversationStore!: ConversationStore;
  private lifecycle!: PluginLifecycle;
  private viewActivator!: PluginViewActivator;
  private envApply!: EnvironmentApplyService;
  lastKnownTabManagerState: AppTabManagerState | null = null;

  async onload() {
    await this.loadSettings();

    this.logger.setEnabled(this.settings.loggingEnabled ?? false);
    this.logger.setLevel(this.settings.logLevel ?? 'warn');
    this.events.setErrorSink((error, event) => {
      this.logger.scope('events').error(`handler for "${event}" threw`, error);
    });

    this.lifecycle = new PluginLifecycle(this);
    // installGitWatcher is light (object construction + 4 event registrations,
    // no IO until first subscriber attaches) but view restoration reads
    // `gitStatusWatcher` synchronously in `buildHeader`, so it stays here to
    // keep the git button wired on a restored leaf.
    this.lifecycle.installGitWatcher();

    this.viewActivator = new PluginViewActivator(this);
    this.envApply = new EnvironmentApplyService(this);

    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );

    this.addRibbonIcon('bot', 'Open Claudian', () => {
      void this.activateView();
    });

    const taskExecutionSurface = new ChatTabExecutionSurface(this);
    this.registerView(
      VIEW_TYPE_CLAUDIAN_AGENT_BOARD,
      (leaf) => new AgentBoardView(leaf, this, taskExecutionSurface),
    );

    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    this.addRibbonIcon('kanban-square', 'Open Agent Board', () => {
      void this.activateAgentBoardView();
    });


    const chatWorkOrderLinker = new ChatWorkOrderLinker(this);

    this.registerChatMessageAction({
      id: 'create-work-order-from-message',
      label: 'Create work order',
      icon: 'kanban-square',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        void chatWorkOrderLinker.promoteMessageToWorkOrder(msg, conversationId);
      },
    });

    registerPluginCommands({ plugin: this, taskExecutionSurface, chatWorkOrderLinker });

    registerWorkspaceMenus(this);


    this.addSettingTab(new ClaudianSettingTab(this.app, this));

    // Heavy provider workspace initialization is deferred until the workspace
    // finishes restoring leaves. ProviderWorkspaceRegistry.initializeAll walks
    // Claude MCP/plugins/agents, Codex skills/subagents, and Cursor's model
    // catalog — running these concurrently still costs hundreds of ms of
    // sync-blocking work on cold start. onLayoutReady is Obsidian's "boot
    // finished" signal; provider services don't have to exist for view
    // restoration since runtime services are lazy-initialized per tab.
    this.app.workspace.onLayoutReady(() => {
      void this.completeDeferredOnload();
    });
  }

  private async completeDeferredOnload(): Promise<void> {
    try {
      await ProviderWorkspaceRegistry.initializeAll(this);
    } catch (error) {
      this.logger.scope('onload').error('provider workspace init failed', error);
      return;
    }
    // Restored views constructed before provider services were ready may have
    // mounted the empty-state placeholder; reprobe so they can promote to the
    // full tab UI now that providers are available.
    for (const view of this.getAllViews()) {
      try {
        await view.refreshProviderAvailability();
      } catch (error) {
        this.logger.scope('onload').error('view refresh after deferred init failed', error);
      }
    }
  }

  onunload(): void {
    this.gitStatusWatcher?.stop();
    this.gitStatusWatcher = null;
    this.lifecycle.shutdownActiveRuntimes();
    void this.lifecycle.persistOpenTabStates();
  }


  async addFileToActiveChat(file: TFile): Promise<boolean> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const fileContextManager = activeTab?.ui.fileContextManager;

    if (!activeTab || !fileContextManager) {
      new Notice('Open Claudian chat and enable a provider before adding file context.');
      return false;
    }

    if (!fileContextManager.attachFileAsPill(file.path)) {
      new Notice(`Could not add file to chat: ${file.path}`);
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(`Added ${file.path} to Claudian chat`);
    return true;
  }

  async addFolderToActiveChat(folder: TFolder): Promise<boolean> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const fileContextManager = activeTab?.ui.fileContextManager;

    if (!activeTab || !fileContextManager) {
      new Notice('Open Claudian chat and enable a provider before adding folder context.');
      return false;
    }

    if (!fileContextManager.attachFolderAsPill(folder.path)) {
      new Notice(`Could not add folder to chat: ${folder.path}`);
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(`Added ${folder.path}/ to Claudian chat`);
    return true;
  }

  async activateView(): Promise<void> {
    return this.viewActivator.activateView();
  }

  async activateAgentBoardView(): Promise<void> {
    return this.viewActivator.activateAgentBoardView();
  }

  async runNextReadyWorkOrder(): Promise<void> {
    return this.viewActivator.runNextReadyWorkOrder();
  }

  canCreateNewTab(): boolean {
    return this.viewActivator.canCreateNewTab();
  }

  private async ensureViewOpen(): Promise<ClaudianView | null> {
    return this.viewActivator.ensureViewOpen();
  }

  async openNewTab(): Promise<void> {
    return this.viewActivator.openNewTab();
  }

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    this.conversationStore = new ConversationStore({
      storage: this.storage,
      getVaultPath: () => getVaultPath(this.app),
      repairViewsAfterDelete: (conversationId) => this.repairViewsAfterConversationDelete(conversationId),
    });
    const { claudian } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_CLAUDIAN_SETTINGS,
      ...claudian,
    };

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost)
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    if (
      this.settings.savedProviderPermissionMode
      && typeof this.settings.savedProviderPermissionMode === 'object'
      && !Array.isArray(this.settings.savedProviderPermissionMode)
    ) {
      for (const [providerId, mode] of Object.entries(this.settings.savedProviderPermissionMode)) {
        if (mode === 'plan') {
          this.settings.savedProviderPermissionMode[providerId] = 'normal';
        }
      }
    }
    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const backfilledConversations = await this.conversationStore.loadConversations();
    setLocale(this.settings.locale as Locale);

    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants || didNormalizeProviderSelection) {
      await this.saveSettings();
    }

    const conversationsToSave = new Set([...backfilledConversations, ...invalidatedConversations]);
    for (const conv of conversationsToSave) {
      await this.storage.sessions.saveMetadata(
        this.storage.sessions.toSessionMetadata(conv)
      );
    }
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async copyDiagnosticLogs(): Promise<void> {
    const entries = this.logger.snapshot();
    if (entries.length === 0) {
      new Notice('No diagnostic log entries');
      return;
    }
    await navigator.clipboard.writeText(formatLogEntries(entries));
    new Notice(`Copied ${entries.length} log entries`);
  }

  async saveSettings() {
    ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    ProviderSettingsCoordinator.persistProjectedProviderState(
      this.settings,
    );

    await this.storage.saveClaudianSettings(this.settings);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    return this.envApply.apply(scope, envText);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    return this.envApply.applyBatch(updates);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getActiveBrowserSelection(): BrowserSelectionContext | null {
    return this.getView()?.getActiveTab()?.controllers.browserSelectionController?.getContext() ?? null;
  }

  registerChatMessageAction(action: ChatMessageAction): void {
    this.chatMessageActions.push(action);
  }

  getActiveConversationSnapshot(): ConversationSnapshot | null {
    const conversationId = this.getView()?.getActiveTab()?.conversationId;
    if (!conversationId) return null;
    const title = this.getConversationSync(conversationId)?.title ?? 'Conversation';
    return { id: conversationId, title };
  }

  async openConversation(conversationId: string): Promise<void> {
    if (!this.getConversationSync(conversationId)) {
      new Notice('Linked conversation not found. It may have been deleted.');
      return;
    }
    await this.activateView();
    await this.getView()?.getTabManager()?.openConversation(conversationId);
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  getResolvedProviderCliPath(providerId: ProviderId): string | null {
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      return null;
    }

    return cliResolver.resolveFromSettings(this.settings);
  }

  private reconcileModelWithEnvironment(providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds()): {
    changed: boolean;
    invalidatedConversations: Conversation[];
  } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversationStore.getConversations(),
      providerIds,
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  // Cancels any active stream and resets every open tab bound to a deleted
  // conversation back to a fresh conversation. Lives on the shell because it
  // reaches concrete view/tab controllers; the store invokes it through a
  // narrow callback so it stays free of feature dependencies.
  private async repairViewsAfterConversationDelete(conversationId: string): Promise<void> {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === conversationId) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.conversationController?.createNew({ force: true });
        }
      }
    }
  }

  createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    orchestratorMode?: boolean;
  }): Promise<Conversation> {
    return this.conversationStore.createConversation(options);
  }

  switchConversation(id: string): Promise<Conversation | null> {
    return this.conversationStore.switchConversation(id);
  }

  deleteConversation(id: string): Promise<void> {
    return this.conversationStore.deleteConversation(id);
  }

  renameConversation(id: string, title: string): Promise<void> {
    return this.conversationStore.renameConversation(id, title);
  }

  updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    return this.conversationStore.updateConversation(id, updates);
  }

  getConversationById(id: string): Promise<Conversation | null> {
    return this.conversationStore.getConversationById(id);
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversationStore.getConversationSync(id);
  }

  findEmptyConversation(): Conversation | null {
    return this.conversationStore.findEmptyConversation();
  }

  getConversationList(): ConversationMeta[] {
    return this.conversationStore.getConversationList();
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): ClaudianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).find(isClaudianView) ?? null;
  }

  getAllViews(): ClaudianView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).filter(isClaudianView);
  }

  findConversationAcrossViews(conversationId: string): { view: ClaudianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

}
