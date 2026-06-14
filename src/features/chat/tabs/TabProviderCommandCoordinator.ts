import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  ProviderTabWarmupContext,
  ProviderTabWarmupMode,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { Conversation, SlashCommand } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getTabProviderId } from './providerResolution';
import { initializeTabService } from './Tab';
import type { TabData, TabId } from './types';

type ProviderCommandCacheEntry = {
  commands: SlashCommand[];
  key: string;
};

type ProviderWarmupContext = {
  conversation: Conversation | null;
  externalContextPaths: string[];
  runtime: ChatRuntime | null;
  tab: ProviderTabWarmupContext['tab'];
  warmupMode: ProviderTabWarmupMode;
};

type ProviderCommandContext = ProviderWarmupContext & {
  cacheKey: string;
};

type ProviderCommandWarmupEntry = {
  key: string;
  promise: Promise<SlashCommand[]>;
};

/**
 * Tab-state escapes the coordinator reads through {@link TabManager}. They are
 * live accessors (not snapshots) so the coordinator always sees the current tab
 * set / active tab without a back-reference to the manager.
 */
export interface TabProviderCommandCoordinatorDeps {
  readonly plugin: ClaudianPlugin;
  getTabs(): Map<TabId, TabData>;
  getActiveTabId(): TabId | null;
  getActiveTab(): TabData | null;
  filterTabsByProvider(
    providerIds: ProviderId | ProviderId[] | undefined,
    resolve: (tab: TabData) => ProviderId,
  ): Iterable<TabData>;
}

/**
 * Owns the provider-aware command catalog and runtime-warmup coordination for a
 * tab set: the per-tab command cache + in-flight warmup dedup, the warmup-mode
 * resolution, and the cache-key construction. Extracted from `TabManager` so
 * the manager keeps tab CRUD/fork while this holds the command/warmup state
 * machine behind a small accessor seam.
 */
export class TabProviderCommandCoordinator {
  private readonly providerCommandWarmups = new Map<TabId, ProviderCommandWarmupEntry>();
  private readonly providerCommandCache = new Map<TabId, ProviderCommandCacheEntry>();

  constructor(private readonly deps: TabProviderCommandCoordinatorDeps) {}

  invalidateProviderCommandCaches(providerIds?: ProviderId | ProviderId[]): void {
    for (const tab of this.deps.filterTabsByProvider(providerIds, (tab) => getTabProviderId(tab, this.deps.plugin))) {
      this.providerCommandWarmups.delete(tab.id);
      this.providerCommandCache.delete(tab.id);
      tab.ui?.slashCommandDropdown?.resetSdkSkillsCache();
    }
  }

  primeProviderRuntime(providerIds?: ProviderId | ProviderId[]): void {
    for (const tab of this.deps.filterTabsByProvider(providerIds, (tab) => tab.service?.providerId ?? tab.providerId)) {
      this.maybePrimeProviderRuntime(tab);
    }
  }

  /** Drops the cached command/warmup state for a closed tab. */
  forgetTab(tabId: TabId): void {
    this.providerCommandWarmups.delete(tabId);
    this.providerCommandCache.delete(tabId);
  }

  async getSdkCommands(tabId?: TabId): Promise<SlashCommand[]> {
    const targetTab = (tabId ? this.deps.getTabs().get(tabId) : this.deps.getActiveTab()) ?? null;
    if (!targetTab) {
      return [];
    }

    const providerId = getTabProviderId(targetTab, this.deps.plugin);
    const staticCapabilities = ProviderRegistry.getCapabilities(providerId);
    if (!staticCapabilities.supportsProviderCommands) {
      return [];
    }

    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    const runtimeCommandLoader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    const context = await this.buildProviderWarmupContext(targetTab, providerId);
    if (
      targetTab.lifecycleState === 'blank'
      && runtimeCommandLoader
      && (context.warmupMode !== 'commands' || targetTab.id !== this.deps.getActiveTabId())
    ) {
      catalog?.setRuntimeCommands([]);
      return [];
    }

    let sdkCommands: SlashCommand[] = [];

    const targetService = targetTab.service;
    if (targetService?.providerId === providerId && targetService.isReady()) {
      sdkCommands = await targetService.getSupportedCommands();
    } else if (!runtimeCommandLoader) {
      for (const tab of this.deps.getTabs().values()) {
        if (tab.id === targetTab.id) {
          continue;
        }
        if (tab.service?.providerId === providerId && tab.service.isReady()) {
          sdkCommands = await tab.service.getSupportedCommands();
          break;
        }
      }
    }

    if (sdkCommands.length === 0) {
      sdkCommands = await this.ensureProviderCommandRuntime(targetTab, providerId, context);
    }

    catalog?.setRuntimeCommands(sdkCommands);

    return sdkCommands;
  }

  private async ensureProviderCommandRuntime(
    tab: TabData,
    providerId: ProviderId,
    warmupContext?: ProviderWarmupContext,
  ): Promise<SlashCommand[]> {
    if (!this.isProviderCommandLoaderAvailable(providerId)) {
      return [];
    }

    const resolvedWarmupContext = warmupContext
      ?? await this.buildProviderWarmupContext(tab, providerId);
    const context = this.buildProviderCommandContext(
      tab,
      providerId,
      resolvedWarmupContext,
    );
    const cached = this.providerCommandCache.get(tab.id);
    if (
      (!context.runtime || !context.runtime.isReady())
      && cached
      && cached.key === context.cacheKey
    ) {
      return cached.commands.map((command) => ({ ...command }));
    }

    const existing = this.providerCommandWarmups.get(tab.id);
    if (existing?.key === context.cacheKey) {
      return await existing.promise;
    }
    this.providerCommandWarmups.delete(tab.id);

    const warmup = this.warmProviderCommandRuntime(tab, providerId, context).finally(() => {
      if (this.providerCommandWarmups.get(tab.id)?.promise === warmup) {
        this.providerCommandWarmups.delete(tab.id);
      }
    });
    this.providerCommandWarmups.set(tab.id, {
      key: context.cacheKey,
      promise: warmup,
    });
    return await warmup;
  }

  maybePrimeProviderRuntime(tab: TabData): void {
    void this.prewarmProviderTab(tab).catch(() => {});
  }

  private isProviderCommandLoaderAvailable(providerId: ProviderId): boolean {
    const loader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    if (!loader) return false;
    return loader.isAvailable(this.deps.plugin.settings);
  }

  async prewarmProviderTab(tab: TabData): Promise<void> {
    const providerId = tab.service?.providerId ?? tab.providerId;
    const context = await this.buildProviderWarmupContext(tab, providerId);
    const hasReadyRuntime = tab.service?.providerId === providerId && tab.service.isReady();
    if (!hasReadyRuntime && tab.id !== this.deps.getActiveTabId()) {
      return;
    }

    switch (context.warmupMode) {
      case 'commands':
        await this.getSdkCommands(tab.id);
        return;
      case 'runtime':
        await this.ensureProviderTabRuntimeReady(tab, providerId, context);
        return;
      default:
        return;
    }
  }

  private async ensureProviderTabRuntimeReady(
    tab: TabData,
    providerId: ProviderId,
    context: ProviderWarmupContext,
  ): Promise<void> {
    if (!context.runtime || context.runtime.providerId !== providerId || !tab.serviceInitialized) {
      await initializeTabService(tab, this.deps.plugin, context.conversation);
    }

    const runtime = tab.service?.providerId === providerId ? tab.service : null;
    if (!runtime) {
      return;
    }

    runtime.syncConversationState(context.conversation, context.externalContextPaths);
    await runtime.ensureReady();
    if (ProviderRegistry.getCapabilities(providerId).supportsProviderCommands) {
      await this.getSdkCommands(tab.id);
    }
  }

  private async buildProviderWarmupContext(
    tab: TabData,
    providerId: ProviderId,
  ): Promise<ProviderWarmupContext> {
    const conversation = tab.conversationId
      ? await this.deps.plugin.getConversationById(tab.conversationId)
      : null;
    const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
    const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
      ?? (hasConversationContext
        ? conversation?.externalContextPaths ?? []
        : this.deps.plugin.settings.persistentExternalContextPaths ?? []);
    const runtime = tab.service?.providerId === providerId ? tab.service : null;
    const warmupMode = this.resolveProviderTabWarmupMode({
      conversation,
      externalContextPaths,
      plugin: this.deps.plugin,
      runtime,
      tab: {
        conversationId: tab.conversationId,
        draftModel: tab.draftModel,
        lifecycleState: tab.lifecycleState,
        providerId,
      },
    });

    return {
      conversation,
      externalContextPaths,
      runtime,
      tab: {
        conversationId: tab.conversationId,
        draftModel: tab.draftModel,
        lifecycleState: tab.lifecycleState,
        providerId,
      },
      warmupMode,
    };
  }

  private resolveProviderTabWarmupMode(context: ProviderTabWarmupContext): ProviderTabWarmupMode {
    return ProviderWorkspaceRegistry.getTabWarmupPolicy(context.tab.providerId)?.resolveMode(context) ?? 'none';
  }

  private buildProviderCommandContext(
    tab: TabData,
    providerId: ProviderId,
    warmupContext: ProviderWarmupContext,
  ): ProviderCommandContext {
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );

    return {
      ...warmupContext,
      cacheKey: JSON.stringify({
        allowSessionCreation: warmupContext.warmupMode === 'commands'
          && tab.lifecycleState === 'blank'
          && tab.id === this.deps.getActiveTabId(),
        conversationId: warmupContext.conversation?.id ?? null,
        draftModel: tab.draftModel ?? null,
        externalContextPaths: warmupContext.externalContextPaths,
        lifecycleState: tab.lifecycleState,
        providerId,
        providerSettings,
        providerState: warmupContext.conversation?.providerState ?? null,
        sessionId: warmupContext.conversation?.sessionId ?? null,
        warmupMode: warmupContext.warmupMode,
      }),
    };
  }

  private async warmProviderCommandRuntime(
    tab: TabData,
    providerId: ProviderId,
    context: ProviderCommandContext,
  ): Promise<SlashCommand[]> {
    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    const loader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    if (!catalog || !loader) {
      return [];
    }
    const commands = await loader.loadCommands({
      allowSessionCreation: context.warmupMode === 'commands'
        && tab.lifecycleState === 'blank'
        && tab.id === this.deps.getActiveTabId(),
      conversation: context.conversation,
      externalContextPaths: context.externalContextPaths,
      plugin: this.deps.plugin,
      runtime: context.runtime,
    });

    if (!context.runtime || !context.runtime.isReady()) {
      this.providerCommandCache.set(tab.id, {
        key: context.cacheKey,
        commands: commands.map((command) => ({ ...command })),
      });
    } else {
      this.providerCommandCache.delete(tab.id);
    }
    catalog.setRuntimeCommands(commands);
    return commands;
  }

  getProviderCatalogConfig(tab: TabData) {
    const providerId = getTabProviderId(tab, this.deps.plugin);
    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    if (!catalog) return null;

    return {
      config: catalog.getDropdownConfig(),
      getEntries: async () => {
        await this.getSdkCommands(tab.id);
        return catalog.listDropdownEntries({ includeBuiltIns: false });
      },
    };
  }
}
