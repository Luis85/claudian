// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

import type { TFile, TFolder } from 'obsidian';
import { Notice, Plugin } from 'obsidian';
import { z } from 'zod';

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
import { ChatTabReservations } from './core/chatTabReservations';
import { EventBus } from './core/events/EventBus';
import { formatLogEntries } from './core/logging/formatLogEntries';
import { Logger } from './core/logging/Logger';
import type { MissingMcpSecret } from './core/mcp/mcpSecrets';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  serializeEnvironmentVariables,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import {
  migrateEnvSecrets,
  pruneScopeSecretRefs,
  resolveProviderEnvVars,
} from './core/providers/secretEnvVars';
import type { ProviderId } from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { SecretStore } from './core/security/secretStore';
import { VaultFileAdapter } from './core/storage/VaultFileAdapter';
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
import type { EnvironmentScope, SecretEnvVarRef } from './core/types/settings';
import type { UsageEventMap } from './core/usage/events';
import { UsageStorage } from './core/usage/UsageStorage';
import { UsageTracker } from './core/usage/UsageTracker';
import { AgentRosterStore } from './features/agents/roster/AgentRosterStore';
import { toolCapabilityId } from './features/agents/roster/rosterCapabilities';
import { AgentRosterView, VIEW_TYPE_AGENT_ROSTER } from './features/agents/roster/view/AgentRosterView';
import { ClaudianView } from './features/chat/ClaudianView';
import { sendFeedbackPrompt } from './features/chat/feedback/sendFeedbackPrompt';
import { isClaudianView } from './features/chat/isClaudianView';
import type { GitStatusWatcher } from './features/chat/services/GitStatusWatcher';
import { isCaptureEligible, openCaptureFromMessage } from './features/quickActions/captureFromMessage';
import { QuickActionFavoritesCache } from './features/quickActions/QuickActionFavoritesCache';
import { QuickActionLastUsedStore } from './features/quickActions/quickActionLastUsedStore';
import { QuickActionStorage } from './features/quickActions/QuickActionStorage';
import { buildProviderRecords } from './features/quickActions/skills/buildProviderRecords';
import { VaultSkillAggregator } from './features/quickActions/skills/VaultSkillAggregator';
import { ClaudianSettingTab } from './features/settings/ClaudianSettings';
import { SkillLibraryView, VIEW_TYPE_SKILL_LIBRARY } from './features/skills/view/SkillLibraryView';
import { CommitOnAcceptCoordinator } from './features/tasks/commit/CommitOnAcceptCoordinator';
import { CommitOnAcceptModal } from './features/tasks/commit/CommitOnAcceptModal';
import { ChatTabExecutionSurface } from './features/tasks/execution/ChatTabExecutionSurface';
import { ChatWorkOrderLinker } from './features/tasks/execution/ChatWorkOrderLinker';
import { createQueueControlState, type QueueControlState } from './features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from './features/tasks/execution/QueueSlotTracker';
import { RunSidecarStore } from './features/tasks/storage/RunSidecarStore';
import { TaskNoteStore } from './features/tasks/storage/TaskNoteStore';
import { AgentBoardView } from './features/tasks/ui/AgentBoardView';
import { WorkOrderActivityProvider } from './features/tasks/ui/WorkOrderActivityProvider';
import { ClaudianToolRegistry } from './features/tools/ClaudianToolRegistry';
import { ClaudianHttpToolServer } from './features/tools/host/ClaudianHttpToolServer';
import { buildClaudianToolMcpServer } from './features/tools/host/InProcessToolMcpServer';
import { transpileToolSource } from './features/tools/transpile';
import { ToolLibraryView, VIEW_TYPE_TOOL_LIBRARY } from './features/tools/view/ToolLibraryView';
import { setLocale, t } from './i18n/i18n';
import type { Locale } from './i18n/types';
import type { BrowserSelectionContext } from './utils/browser';
import { chatMessageText } from './utils/chatMessageText';
import { getVaultPath } from './utils/path';

export default class ClaudianPlugin extends Plugin implements PluginContext {
  settings!: ClaudianSettings;
  /** SEC-A: keychain-backed secret store (Obsidian SecretStorage), set in onload. */
  secretStore!: SecretStore;
  /** SEC-A: secret ids already warned about as missing on this device (dedup). */
  private readonly warnedMissingSecretIds = new Set<string>();
  readonly events = new EventBus<ClaudianEventMap>();
  readonly logger = new Logger({ enabled: false, level: 'warn' });
  /** Optional, registry-driven actions rendered in the chat user-message toolbar. */
  readonly chatMessageActions: ChatMessageAction[] = [];
  storage!: SharedAppStorage;
  gitStatusWatcher: GitStatusWatcher | null = null;
  private commitOnAcceptCoordinator: CommitOnAcceptCoordinator | null = null;
  conversationStore!: ConversationStore;
  /** Plugin-lifetime singleton. Built in onload before any consumer reads it. */
  public quickActionStorage!: QuickActionStorage;
  public quickActionFavoritesCache: QuickActionFavoritesCache | null = null;
  public quickActionLastUsedStore: QuickActionLastUsedStore | null = null;
  public vaultSkillAggregator: VaultSkillAggregator | null = null;
  public vaultFileAdapter!: VaultFileAdapter;
  public toolRegistry!: ClaudianToolRegistry;
  /** Shared plugin-lifetime store for roster agent definitions. Constructed in onload
   * after vaultFileAdapter; consumers must not build their own instance. */
  public agentRosterStore!: AgentRosterStore;
  public usageTracker: UsageTracker | null = null;
  private httpToolServer: ClaudianHttpToolServer | null = null;
  private lifecycle!: PluginLifecycle;
  private unloaded = true;
  private viewActivator!: PluginViewActivator;
  private envApply!: EnvironmentApplyService;
  /** Plugin-level concurrency gate shared by every Agent Board queue runner. */
  queueSlotTracker!: QueueSlotTracker;
  /** Shared sidecar store for per-run heartbeat + ledger writes under
   * `.claudian/runs/<runId>/`. Coordinators in different Agent Board panes
   * route through this single instance so cross-pane writes don't race. */
  runSidecarStore!: RunSidecarStore;
  /**
   * Identifies this plugin instance to per-run sidecars. Minted at construction
   * (NOT in onload) so a unit-test stub or restored-leaf path that reads it
   * before onload still sees a stable id. Stamped on every heartbeat write;
   * orphan recovery uses a mismatch to detect "previous plugin load" sidecars
   * immediately, without waiting for the 5-minute stale-`at` window.
   */
  readonly runtimeId: string = generateRuntimeId();
  /** Shared in-flight work-order ids, so coordinators in different Agent Board
   * panes observe the same active runs and never double-launch the same card. */
  readonly taskActiveRuns = new Set<string>();
  /** The queue's single global control state (pause/halt/failure-count), shared
   * by every board's runner. It starts paused on every plugin load; the user
   * must explicitly run the queue for this session. */
  readonly queueControl: QueueControlState = createQueueControlState(true);
  /** Chat tabs queue runs have committed to opening but not yet created. Shared
   * so concurrent Agent Board panes can't double-book the same free tabs. */
  readonly chatTabReservations = new ChatTabReservations();
  workOrderActivity: WorkOrderActivityProvider | null = null;
  lastKnownTabManagerState: AppTabManagerState | null = null;

  async onload() {
    this.unloaded = false;
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
    this.queueSlotTracker = new QueueSlotTracker(this.settings.agentBoardQueueCap);
    this.runSidecarStore = new RunSidecarStore(this.app.vault.adapter, '.claudian/runs');
    this.workOrderActivity = new WorkOrderActivityProvider(this);
    this.workOrderActivity.start();
    this.register(() => {
      this.workOrderActivity?.dispose();
      this.workOrderActivity = null;
    });

    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );

    this.addRibbonIcon('bot', 'Open Claudian', () => {
      void this.activateView();
    });

    const taskExecutionSurface = new ChatTabExecutionSurface(this);
    {
      const noteStore = new TaskNoteStore();
      this.commitOnAcceptCoordinator = new CommitOnAcceptCoordinator({
        events: this.events,
        loadTaskSpec: async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!file || !('vault' in file)) {
            throw new Error('Work order file not found');
          }
          const content = await this.app.vault.read(file as Parameters<typeof this.app.vault.read>[0]);
          return noteStore.parse(path, content).task;
        },
        getGitStatus: async () => {
          await this.gitStatusWatcher?.refresh();
          return this.gitStatusWatcher?.getLastStatus() ?? { isRepo: false, dirtyCount: 0 };
        },
        isProviderGitEnabled: (providerId) => {
          try {
            const config = ProviderRegistry.getChatUIConfig(providerId as ProviderId);
            return config.isGitActionsEnabled?.(this.settings) !== false;
          } catch {
            return false;
          }
        },
        openModal: (opts) => {
          const modal = new CommitOnAcceptModal(this.app, opts);
          modal.open();
          return modal.result();
        },
        surface: taskExecutionSurface,
        readSettings: () => this.settings,
        saveSettings: () => this.saveSettings(),
        logger: this.logger.scope('tasks.commitOnAccept'),
        showNotice: (message) => { new Notice(message); },
      });
      this.commitOnAcceptCoordinator.start();
    }
    this.registerView(
      VIEW_TYPE_CLAUDIAN_AGENT_BOARD,
      (leaf) => new AgentBoardView(leaf, this, taskExecutionSurface),
    );

    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    this.addRibbonIcon('kanban-square', 'Open Agent Board', () => {
      void this.activateAgentBoardView();
    });

    this.registerView(VIEW_TYPE_AGENT_ROSTER, (leaf) => new AgentRosterView(leaf, this));
    this.registerView(VIEW_TYPE_TOOL_LIBRARY, (leaf) => new ToolLibraryView(leaf, this));
    this.registerView(VIEW_TYPE_SKILL_LIBRARY, (leaf) => new SkillLibraryView(leaf, this));

    const openView = async (viewType: string) => {
      const { workspace } = this.app;
      const existing = workspace.getLeavesOfType(viewType)[0];
      const leaf = existing ?? workspace.getLeaf('tab');
      if (!existing) {
        await leaf.setViewState({ type: viewType, active: true });
      }
      workspace.revealLeaf(leaf);
    };
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Roster" is the product feature name.
    this.addRibbonIcon('users', 'Open Agent Roster', () => void openView(VIEW_TYPE_AGENT_ROSTER));
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Roster" is the product feature name.
    this.addCommand({ id: 'open-agent-roster', name: 'Open Agent Roster', callback: () => void openView(VIEW_TYPE_AGENT_ROSTER) });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Tool Library" is the product feature name.
    this.addCommand({ id: 'open-tool-library', name: 'Open Tool Library', callback: () => void openView(VIEW_TYPE_TOOL_LIBRARY) });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Skill Library" is the product feature name.
    this.addCommand({ id: 'open-skill-library', name: 'Open Skill Library', callback: () => void openView(VIEW_TYPE_SKILL_LIBRARY) });

    const chatWorkOrderLinker = new ChatWorkOrderLinker(this);

    // Registration order = left-to-right render order inside .claudian-text-actions
    // (which itself sits left of the copy button). Visual order under an assistant
    // response: thumbs-up, thumbs-down, work-order, copy. The capture action below
    // targets user messages only (gated by isCaptureEligible).
    this.registerChatMessageAction({
      id: 'thumbs-up-feedback',
      label: t('chat.feedback.thumbsUp.label'),
      icon: 'thumbs-up',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        sendFeedbackPrompt(this, msg, conversationId, 'up');
      },
    });

    this.registerChatMessageAction({
      id: 'thumbs-down-feedback',
      label: t('chat.feedback.thumbsDown.label'),
      icon: 'thumbs-down',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        sendFeedbackPrompt(this, msg, conversationId, 'down');
      },
    });

    this.registerChatMessageAction({
      id: 'create-work-order-from-message',
      label: 'Create work order',
      icon: 'kanban-square',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        void chatWorkOrderLinker.promoteMessageToWorkOrder(msg, conversationId);
      },
    });

    this.registerChatMessageAction({
      id: 'capture-prompt-as-quick-action',
      label: t('quickActions.capture.label'),
      icon: 'bookmark-plus',
      isEligible: isCaptureEligible,
      run: (msg) => openCaptureFromMessage(this, msg),
    });

    registerPluginCommands({ plugin: this, taskExecutionSurface, chatWorkOrderLinker });

    this.quickActionStorage = new QuickActionStorage(
      new VaultFileAdapter(this.app),
      () => this.settings.quickActionsFolder ?? 'Quick Actions',
    );
    this.quickActionFavoritesCache = new QuickActionFavoritesCache(
      this.quickActionStorage,
      this.app,
      () => this.settings.quickActionsFolder ?? 'Quick Actions',
    );
    this.quickActionFavoritesCache.start();

    // Tool registry: discover/transpile/validate user-authored tools under .claudian/tools/.
    this.vaultFileAdapter = new VaultFileAdapter(this.app);
    this.agentRosterStore = new AgentRosterStore(this.vaultFileAdapter, this.events);
    this.toolRegistry = new ClaudianToolRegistry(this.vaultFileAdapter, {
      transpile: transpileToolSource,
      requireResolve: (id) => {
        if (id === 'zod' || id === 'claudian/tools') return { z };
        const req = (window as { require?: (m: string) => unknown }).require;
        return req ? req(id) : undefined;
      },
    });
    await this.toolRegistry.load();
    this.httpToolServer = new ClaudianHttpToolServer(
      () => this.toolRegistry.list(),
      (signal) => ({ app: this.app, signal }),
    );
    await this.httpToolServer.start();
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file.path.startsWith('.claudian/tools/')) {
          void this.toolRegistry.load().then(() => {
            this.events.emit('toolLibrary:changed');
            void this.httpToolServer?.rebuild();
          });
        }
      }),
    );

    // Usage tracker must subscribe to the bus BEFORE any entry point that
    // can emit `usage.recorded` is registered. The file/folder context menu
    // (`registerWorkspaceMenus`) is the earliest such entry point — if a
    // user fires a quick action between onload and onLayoutReady, the bus
    // would silently drop the event and the leaderboard would undercount.
    // Hydration is awaited so the in-memory map reflects disk state before
    // start() subscribes; without this ordering, an event that lands
    // between subscribe and hydrate would be wiped by hydrate's clear().
    const usageStorage = new UsageStorage(new VaultFileAdapter(this.app), this.logger);
    this.usageTracker = new UsageTracker(
      this.events as unknown as EventBus<UsageEventMap>,
      usageStorage,
      () => Date.now(),
      this.logger,
    );
    await this.usageTracker.hydrate();
    this.usageTracker.start();

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
    if (this.unloaded) return;
    // Skills tab cache: hydrate persisted index, then pre-warm in background.
    const aggregator = new VaultSkillAggregator(
      () => buildProviderRecords(this),
      {
        logger: this.logger,
        eventBus: this.events,
        cacheAdapter: new VaultFileAdapter(this.app),
        ttlMs: 60_000,
      },
    );
    this.vaultSkillAggregator = aggregator;
    await aggregator.hydrate();
    if (this.unloaded || this.vaultSkillAggregator !== aggregator) {
      aggregator.dispose();
      return;
    }
    void aggregator.listAllStreaming(() => {});
    const lastUsedStore = new QuickActionLastUsedStore({
      adapter: new VaultFileAdapter(this.app),
      logger: this.logger.scope('quickActions'),
    });
    await lastUsedStore.hydrate();
    if (this.unloaded) return;
    this.quickActionLastUsedStore = lastUsedStore;
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

  async onunload(): Promise<void> {
    this.unloaded = true;
    if (this.usageTracker) {
      void this.usageTracker.flush();
      this.usageTracker.dispose();
      this.usageTracker = null;
    }
    this.vaultSkillAggregator?.dispose();
    this.vaultSkillAggregator = null;
    this.quickActionFavoritesCache?.dispose();
    this.quickActionFavoritesCache = null;
    this.commitOnAcceptCoordinator?.stop();
    this.commitOnAcceptCoordinator = null;
    this.gitStatusWatcher?.stop();
    this.gitStatusWatcher = null;
    if (this.quickActionLastUsedStore) {
      // Null the field BEFORE awaiting so any in-flight `set()` from a
      // still-mounted modal short-circuits instead of arming another write
      // against a store we're about to discard.
      const store = this.quickActionLastUsedStore;
      this.quickActionLastUsedStore = null;
      await store.flush();
    }
    if (this.httpToolServer) {
      const server = this.httpToolServer;
      this.httpToolServer = null;
      await server.stop();
    }
    this.lifecycle?.shutdownActiveRuntimes();
    void this.lifecycle?.persistOpenTabStates();
  }

  getClaudianToolServer(grantedToolIds?: string[]): unknown {
    if (!this.toolRegistry) return undefined;
    let loaded = this.toolRegistry.list().filter((t) => t.module && !t.error);
    // A bound agent with a non-empty tool grant scopes the server to only its
    // granted capability ids; an empty/absent grant exposes all user tools.
    if (grantedToolIds && grantedToolIds.length > 0) {
      const granted = new Set(grantedToolIds);
      loaded = loaded.filter(
        (t) => t.module && granted.has(toolCapabilityId(t.module.manifest.name)),
      );
    }
    if (loaded.length === 0) return undefined;
    return buildClaudianToolMcpServer(loaded, (signal) => ({
      app: this.app,
      signal,
    }));
  }

  getHttpToolServerConfig(): { url: string; headers: Record<string, string> } | null {
    return this.httpToolServer?.getConfig() ?? null;
  }

  async resolveBoundAgent(
    boundAgentId: string,
  ): Promise<{ prompt?: string; model?: string; tools?: string[] } | null> {
    const agent = await this.agentRosterStore?.get(boundAgentId);
    if (!agent) return null;
    return { prompt: agent.prompt, model: agent.modelSelection?.modelId, tools: agent.tools };
  }

  async addFileToActiveChat(file: TFile): Promise<boolean> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const fileContextManager = activeTab?.ui.fileContextManager;

    if (!activeTab || !fileContextManager) {
      new Notice(t('chat.context.fileNoTab'));
      return false;
    }

    if (!fileContextManager.attachFileAsPill(file.path)) {
      new Notice(t('chat.context.fileAttachFailed', { path: file.path }));
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(t('chat.context.fileAdded', { path: file.path }));
    return true;
  }

  async addFolderToActiveChat(folder: TFolder): Promise<boolean> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const fileContextManager = activeTab?.ui.fileContextManager;

    if (!activeTab || !fileContextManager) {
      new Notice(t('chat.context.folderNoTab'));
      return false;
    }

    if (!fileContextManager.attachFolderAsPill(folder.path)) {
      new Notice(t('chat.context.folderAttachFailed', { path: folder.path }));
      return false;
    }

    activeTab.dom.inputEl.focus();
    new Notice(t('chat.context.folderAdded', { path: folder.path }));
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

  getTabSlotUsage(): { used: number; max: number } {
    return this.viewActivator.getTabSlotUsage();
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
      events: this.events,
    });
    const { claudian } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_CLAUDIAN_SETTINGS,
      ...claudian,
    };

    // SEC-A: keychain-backed secret store. Requires Obsidian >= 1.11.5 (the
    // plugin's minAppVersion), so app.secretStorage is always present.
    this.secretStore = new SecretStore(this.app.secretStorage);
    // One-time migration of any plaintext API keys/tokens in the active env
    // blobs into SecretStorage (idempotent; cheap no-op once done).
    const didMigrateSecrets = migrateEnvSecrets(
      this.settings,
      ProviderRegistry.getRegisteredProviderIds(),
      this.secretStore,
    );

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

    if (changed || didNormalizeModelVariants || didNormalizeProviderSelection || didMigrateSecrets) {
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
      new Notice(t('diagnostics.logsEmpty'));
      return;
    }
    await navigator.clipboard.writeText(formatLogEntries(entries));
    new Notice(t('diagnostics.logsCopied', { count: entries.length }));
  }

  async saveSettings() {
    ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    ProviderSettingsCoordinator.persistProjectedProviderState(
      this.settings,
    );

    await this.storage.saveClaudianSettings(this.settings);
    // The queue cap is global, shared across every board's runner, so syncing it
    // here makes a settings change take effect live without a board refresh.
    this.queueSlotTracker?.setCap(this.settings.agentBoardQueueCap);
    // Any settings change can change what the queue may launch: the concurrency
    // cap, the chat-tab limit (free execution slots), or a card's eligibility
    // (provider enabled, model availability). Wake every open board's runner so
    // it re-evaluates at once instead of stalling until an unrelated
    // chat/status/run/vault event ticks it. tick() is idempotent and cheap, so
    // an unrelated settings change is a harmless no-op re-evaluation.
    this.events.emit('task:queue-cap-changed');
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

  /** SEC-A: persist secret-var refs and run the env reconcile/sync for the scope. */
  async applySecretEnvVars(refs: SecretEnvVarRef[], scope: EnvironmentScope): Promise<void> {
    return this.envApply.applySecretEnvVars(refs, scope);
  }

  /** SEC-A: migrate plaintext secrets (shared/provider/snippet blobs) into SecretStorage. */
  migrateEnvSecretsNow(): boolean {
    return migrateEnvSecrets(
      this.settings,
      ProviderRegistry.getRegisteredProviderIds(),
      this.secretStore,
    );
  }

  /** SEC-A: drop a deleted snippet's secret refs and clear values no other ref uses. */
  pruneSnippetSecrets(snippetId: string): boolean {
    return pruneScopeSecretRefs(
      this.settings,
      `snippet:${snippetId}`,
      (id) => this.secretStore.clear(id),
    );
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

  /**
   * SEC-A: the parsed runtime env for a provider with secret values overlaid
   * from SecretStorage. This is what every child-process spawn path uses — the
   * plaintext blob (via `getActiveEnvironmentVariables`) no longer carries keys.
   * A secret that is absent on this device (e.g. synced from another machine) is
   * left unset rather than injected empty; the settings UI prompts re-entry.
   */
  getResolvedEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): Record<string, string> {
    const { env, missing } = this.resolveProviderEnv(providerId);
    if (missing.length > 0) {
      this.warnMissingDeviceSecrets(missing);
    }
    return env;
  }

  /** Parse the provider env and overlay SecretStorage values; reports missing refs. */
  private resolveProviderEnv(
    providerId: ProviderId,
  ): { env: Record<string, string>; missing: SecretEnvVarRef[] } {
    return resolveProviderEnvVars(this.settings, providerId, (id) => this.secretStore.get(id));
  }

  /**
   * SEC-A: env text for env-hash reconciliation plus the names of any referenced
   * secrets missing on this device. Hashing the resolved env keeps a watched
   * key's value stable across the plaintext→keychain move; `missingKeys` lets the
   * reconciler defer invalidation only when one of ITS watched keys isn't present.
   */
  getEnvironmentHashInput(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): { text: string; missingKeys: string[] } {
    const { env, missing } = this.resolveProviderEnv(providerId);
    return { text: serializeEnvironmentVariables(env), missingKeys: missing.map((ref) => ref.name) };
  }

  /**
   * SEC-A: a secret referenced by settings but absent in this device's
   * SecretStorage (e.g. settings synced from another machine). It's omitted from
   * the launch env rather than injected empty; surface it once per id via a
   * user-visible Notice (not the diagnostic logger, which is off by default and
   * not yet enabled during initial load) so the user knows to re-enter it. The
   * full settings re-entry UI lands in Phase 4.
   */
  private warnMissingDeviceSecrets(missing: SecretEnvVarRef[]): void {
    for (const ref of missing) {
      if (this.warnedMissingSecretIds.has(ref.secretId)) continue;
      this.warnedMissingSecretIds.add(ref.secretId);
      this.logger.scope('secrets').debug(`Secret "${ref.name}" (${ref.scope}) missing on this device.`);
      new Notice(t('env.secretMissing', { name: ref.name }));
    }
  }

  /**
   * SEC-A Phase 3: surface MCP auth-header / stdio-env secrets that are absent on
   * this device (e.g. a vault synced from another machine) so the user re-enters
   * them in the server's settings, mirroring the provider env-secret prompt.
   * Otherwise the server launches/tests without its credential while the editor
   * still shows a masked ref. Deduped by id alongside env secrets.
   */
  warnMissingMcpSecrets(missing: MissingMcpSecret[]): void {
    for (const ref of missing) {
      if (this.warnedMissingSecretIds.has(ref.secretId)) continue;
      this.warnedMissingSecretIds.add(ref.secretId);
      this.logger
        .scope('secrets')
        .debug(`MCP secret "${ref.name}" for "${ref.serverName}" missing on this device.`);
      new Notice(t('env.secretMissing', { name: `${ref.serverName}: ${ref.name}` }));
    }
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

  async openConversation(
    conversationId: string,
    options: { requireNewTab?: boolean; preferNewTab?: boolean; activate?: boolean } = {},
  ): Promise<void> {
    if (!this.getConversationSync(conversationId)) {
      new Notice(t('chat.history.linkedNotFound'));
      return;
    }
    await this.activateView();
    const view = await this.ensureViewOpen();
    await view?.getTabManager()?.openConversation(conversationId, options);
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
      // SEC-A: hash the resolved env (secrets overlaid) and defer invalidation
      // when a referenced secret is missing on this device.
      (providerId) => this.getEnvironmentHashInput(providerId),
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
    boundAgentId?: string;
  }): Promise<Conversation> {
    return this.conversationStore.createConversation(options);
  }

  switchConversation(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<Conversation | null> {
    return this.conversationStore.switchConversation(id, options);
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

/**
 * Mint a stable id for this plugin instance. Stamped into every sidecar
 * heartbeat so orphan recovery can detect "previous plugin load" sidecars
 * without waiting for the 5-minute stale-`at` window. Prefers Web Crypto's
 * `randomUUID`; falls back to a `time-rand` token for ancient runtimes.
 */
function generateRuntimeId(): string {
  const cryptoApi = (window as Window & { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
