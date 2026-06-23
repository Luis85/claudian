import type { Plugin } from 'obsidian';

import type { SpecoratorEventMap } from '../../app/events/specoratorEvents';
import type { BrowserSelectionContext } from '../../utils/browser';
import type { SharedAppStorage } from '../bootstrap/storage';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/Logger';
import type { MissingMcpSecret } from '../mcp/mcpSecrets';
import type { AppTabManagerState } from '../providers/types';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { SecretStore } from '../security/secretStore';
import type {
  ChatMessageAction,
  SpecoratorSettings,
  Conversation,
  ConversationMeta,
  ConversationSnapshot,
} from './index';
import type { ProviderId } from './provider';
import type { EnvironmentScope, SecretEnvVarRef } from './settings';

/**
 * Narrow chat-tab manager surface consumed by the provider boundary.
 *
 * Providers broadcast runtime lifecycle work across open tabs without
 * importing the concrete `TabManager` from `features/`, keeping the core
 * contracts free of feature dependencies.
 */
export interface ChatTabManagerHandle {
  broadcastToAllTabs(fn: (service: ChatRuntime) => Promise<void>): Promise<void>;
  broadcastToProviderTabs(
    providerIds: ProviderId | ProviderId[],
    fn: (service: ChatRuntime) => Promise<void>,
  ): Promise<void>;
}

/**
 * Narrow chat-view surface consumed by the provider boundary. The concrete
 * `SpecoratorView` implements this so provider settings tabs and runtimes can
 * refresh UI and reach the tab manager without `core/` depending on the view.
 */
export interface ChatViewHandle {
  getTabManager(): ChatTabManagerHandle | null;
  refreshModelSelector(): void;
  invalidateProviderCommandCaches(providerIds?: ProviderId | ProviderId[]): void;
  /** Re-applies `hiddenProviderCommands` to open command dropdowns. Optional: implemented by the full chat view. */
  updateHiddenProviderCommands?(): void;
}

/**
 * Narrow plugin surface the provider-neutral core and provider adaptors depend
 * on, replacing the concrete `SpecoratorPlugin` at the chat-facing boundary.
 *
 * `SpecoratorPlugin implements PluginContext`, so real plugins pass everywhere
 * this is required. Members mirror the concrete implementation exactly; the
 * interface adapts to `SpecoratorPlugin`, never the reverse. Inverting the
 * dependency here keeps `core/` and `providers/` independent of `src/main`.
 */
export interface PluginContext
  extends Pick<Plugin, 'app' | 'manifest' | 'loadData' | 'saveData'> {
  settings: SpecoratorSettings;
  storage: SharedAppStorage;
  readonly events: EventBus<SpecoratorEventMap>;
  readonly logger: Logger;
  readonly chatMessageActions: ChatMessageAction[];
  gitStatusWatcher: { refresh(): Promise<void> } | null;

  saveSettings(): Promise<void>;
  normalizeModelVariantSettings(): boolean;
  copyDiagnosticLogs(): Promise<void>;

  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  /** SEC-A: persist secret-var refs and reconcile/sync the affected provider scope. */
  applySecretEnvVars(refs: SecretEnvVarRef[], scope: EnvironmentScope): Promise<void>;
  /** SEC-A: keychain-backed secret value store (get/set/has/list/clear). */
  readonly secretStore: SecretStore;
  /** SEC-A: migrate plaintext secrets (shared/provider/snippet blobs) into SecretStorage; returns whether settings changed. */
  migrateEnvSecretsNow(): boolean;
  /** SEC-A: drop a deleted snippet's `snippet:<id>` secret refs and clear unreferenced values. */
  pruneSnippetSecrets(snippetId: string): boolean;
  /** SEC-A: warn (once per id) that an MCP server's migrated secret is absent on this device. */
  warnMissingMcpSecrets(missing: MissingMcpSecret[]): void;
  getActiveEnvironmentVariables(providerId?: ProviderId): string;
  /** SEC-A: parsed runtime env with SecretStorage values overlaid (for child-process spawns). */
  getResolvedEnvironmentVariables(providerId?: ProviderId): Record<string, string>;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  getResolvedProviderCliPath(providerId: ProviderId): string | null;

  getActiveBrowserSelection(): BrowserSelectionContext | null;
  getActiveConversationSnapshot(): ConversationSnapshot | null;
  openConversation(
    conversationId: string,
    options?: { requireNewTab?: boolean; preferNewTab?: boolean; activate?: boolean },
  ): Promise<void>;
  activateView(): Promise<void>;

  createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    boundAgentId?: string;
  }): Promise<Conversation>;
  switchConversation(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<void>;
  getConversationById(id: string): Promise<Conversation | null>;
  getConversationSync(id: string): Conversation | null;
  getConversationList(): ConversationMeta[];

  persistTabManagerState(state: AppTabManagerState): Promise<void>;

  /**
   * Resolves a bound roster agent's chat projection (system prompt + model) by
   * id, or `null` when unknown. The return shape is core-local so this contract
   * needs no `core/` → `features/` import; the plugin implements it via its
   * roster store. When `providerId` is supplied (the conversation's provider),
   * the projected `model` is only the agent's saved model if that model targets
   * the same provider — otherwise it is dropped so a cross-provider model id
   * never reaches a runtime it doesn't belong to.
   */
  resolveBoundAgent?(
    boundAgentId: string,
    providerId?: ProviderId,
  ): Promise<{ prompt?: string; model?: string; tools?: string[] } | null>;

  /**
   * Returns an in-process Specorator user-tool MCP server built from the current
   * tool registry, or `undefined` when no tools are loaded. The callback is
   * typed to return `unknown` to avoid a `core/` → `features/` import; the
   * Claude runtime casts through `unknown` when merging into `mcpServers`.
   *
   * When `grantedToolIds` is non-empty the server is scoped to only those
   * capability ids (`mcp__specorator__*`) — used to project a bound roster agent's
   * tool grant onto the conversation. An empty/absent list exposes all tools.
   */
  getSpecoratorToolServer?: (grantedToolIds?: string[]) => unknown;

  /**
   * Stable fingerprint of the user tools the specorator server exposes for the
   * given grant. The Claude runtime folds it into the persistent-query MCP key
   * so a mid-session grant edit / registry change re-applies the scoped server.
   */
  getSpecoratorToolKey?: (grantedToolIds?: string[]) => string;

  /**
   * Returns the URL and auth header for the in-process HTTP MCP tool server,
   * or `null` when unavailable. Plain-data shape so `core/` and `providers/`
   * can consume it without importing `features/` types.
   *
   * When `grantedToolIds` is a non-empty bound-agent grant, the returned config
   * carries a per-grant bearer token scoping the server to only those tools; an
   * empty/absent grant returns the byte-identical all-tools default token.
   */
  getHttpToolServerConfig?(
    grantedToolIds?: string[],
  ): { url: string; headers: Record<string, string> } | null;

  getView(): ChatViewHandle | null;
  getAllViews(): ChatViewHandle[];
  findConversationAcrossViews(
    conversationId: string,
  ): { view: ChatViewHandle; tabId: string } | null;
}
