import type {
  McpServerConfig,
  PermissionMode as SDKPermissionMode,
  Query,
} from '@anthropic-ai/claude-agent-sdk';

import { vetActiveServersForRuntime } from '../../../core/mcp/mcpRuntimeVetting';
import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type {
  ChatRuntimeQueryOptions,
} from '../../../core/runtime/types';
import type { ClaudianSettings, PermissionMode } from '../../../core/types/settings';
import {
  resolveEffortLevel,
} from '../types/models';
import { QueryOptionsBuilder } from './ClaudeQueryOptionsBuilder';
import type {
  ClaudeEnsureReadyOptions,
  ClosePersistentQueryOptions,
  PersistentQueryConfig,
} from './types';

export interface ClaudeDynamicUpdateDeps {
  getPersistentQuery: () => Query | null;
  getCurrentConfig: () => PersistentQueryConfig | null;
  mutateCurrentConfig: (mutate: (config: PersistentQueryConfig) => void) => void;
  getVaultPath: () => string | null;
  getCliPath: () => string | null;
  getScopedSettings: () => ClaudianSettings;
  getPermissionMode: () => PermissionMode;
  resolveSDKPermissionMode: (mode: PermissionMode) => SDKPermissionMode;
  mcpManager: McpServerManager;
  /** Optional in-process Claudian user-tool MCP server (Claude only). */
  getClaudianToolServer?: () => unknown;
  getClaudianToolKey?: () => string;
  buildPersistentQueryConfig: (
    vaultPath: string,
    cliPath: string,
    externalContextPaths?: string[],
    boundAgentPrompt?: string,
  ) => PersistentQueryConfig;
  needsRestart: (newConfig: PersistentQueryConfig) => boolean;
  ensureReady: (options: ClaudeEnsureReadyOptions) => Promise<boolean>;
  setCurrentExternalContextPaths: (paths: string[]) => void;
  notifyFailure: (message: string) => void;
}

export async function applyClaudeDynamicUpdates(
  deps: ClaudeDynamicUpdateDeps,
  queryOptions?: ChatRuntimeQueryOptions,
  restartOptions?: ClosePersistentQueryOptions,
  allowRestart = true,
): Promise<void> {
  const persistentQuery = deps.getPersistentQuery();
  if (!persistentQuery) {
    return;
  }

  const vaultPath = deps.getVaultPath();
  if (!vaultPath) {
    return;
  }

  const cliPath = deps.getCliPath();
  if (!cliPath) {
    return;
  }

  const settings = deps.getScopedSettings();
  // Match the options-builder precedence (explicit override > bound-agent model >
  // settings) so a bound agent's model survives across persistent turns rather
  // than reverting to the global default after the first (restart) turn.
  const selectedModel = QueryOptionsBuilder.resolveEffectiveModel(
    queryOptions?.model,
    queryOptions?.boundAgentModel,
    settings.model,
  );
  const permissionMode = deps.getPermissionMode();

  // Each helper re-reads the live config so an earlier mutation is visible to
  // later branches. Ordering (model → effort → permission → MCP) is load-bearing
  // and must match the original sequence.
  await updateModel(deps, persistentQuery, selectedModel);
  await updateEffortLevel(deps, persistentQuery, selectedModel, settings.effortLevel);
  await updatePermissionMode(deps, persistentQuery, permissionMode);
  await updateMcpServers(deps, persistentQuery, queryOptions);

  const newExternalContextPaths = queryOptions?.externalContextPaths || [];
  deps.setCurrentExternalContextPaths(newExternalContextPaths);

  if (!allowRestart) {
    return;
  }

  await maybeRestart(deps, queryOptions, restartOptions, {
    vaultPath,
    cliPath,
    newExternalContextPaths,
  });
}

async function updateModel(
  deps: ClaudeDynamicUpdateDeps,
  persistentQuery: Query,
  selectedModel: string,
): Promise<void> {
  const currentConfig = deps.getCurrentConfig();
  if (!currentConfig || selectedModel === currentConfig.model) {
    return;
  }
  try {
    await persistentQuery.setModel(selectedModel);
    deps.mutateCurrentConfig(config => {
      config.model = selectedModel;
    });
  } catch {
    deps.notifyFailure('Failed to update model');
  }
}

async function updateEffortLevel(
  deps: ClaudeDynamicUpdateDeps,
  persistentQuery: Query,
  selectedModel: string,
  settingsEffortLevel: ClaudianSettings['effortLevel'],
): Promise<void> {
  const effortLevel = resolveEffortLevel(selectedModel, settingsEffortLevel);
  const currentEffort = deps.getCurrentConfig()?.effortLevel ?? null;
  if (effortLevel === currentEffort) {
    return;
  }
  try {
    // SDK runtime accepts `max`, but the current type definition for
    // Settings.effortLevel has not caught up yet.
    await persistentQuery.applyFlagSettings({ effortLevel } as unknown as Parameters<Query['applyFlagSettings']>[0]);
    deps.mutateCurrentConfig(config => {
      config.effortLevel = effortLevel;
    });
  } catch {
    deps.notifyFailure('Failed to update effort level');
  }
}

async function updatePermissionMode(
  deps: ClaudeDynamicUpdateDeps,
  persistentQuery: Query,
  permissionMode: PermissionMode,
): Promise<void> {
  const currentConfig = deps.getCurrentConfig();
  if (!currentConfig) {
    return;
  }
  const sdkMode = deps.resolveSDKPermissionMode(permissionMode);
  const currentSdkMode = currentConfig.sdkPermissionMode ?? null;

  // The Claude Code auto-mode opt-in is a startup flag. The restart path below
  // will rebuild the query with that capability before auto becomes active.
  const requiresAutoModeRestart = sdkMode === 'auto' && !currentConfig.enableAutoMode;
  if (requiresAutoModeRestart) {
    return;
  }

  if (sdkMode === currentSdkMode) {
    deps.mutateCurrentConfig(config => {
      config.permissionMode = permissionMode;
      config.sdkPermissionMode = sdkMode;
    });
    return;
  }

  try {
    await persistentQuery.setPermissionMode(sdkMode);
    deps.mutateCurrentConfig(config => {
      config.permissionMode = permissionMode;
      config.sdkPermissionMode = sdkMode;
    });
  } catch {
    deps.notifyFailure('Failed to update permission mode');
  }
}

async function updateMcpServers(
  deps: ClaudeDynamicUpdateDeps,
  persistentQuery: Query,
  queryOptions?: ChatRuntimeQueryOptions,
): Promise<void> {
  const mcpMentions = queryOptions?.mcpMentions || new Set<string>();
  const uiEnabledServers = queryOptions?.enabledMcpServers || new Set<string>();
  const combinedMentions = new Set([...mcpMentions, ...uiEnabledServers]);
  const mcpServers = deps.mcpManager.getActiveServers(combinedMentions);
  // The in-process Claudian tool server (Claude only) is added after vetting —
  // it's an `sdk`-type server, not a URL-based one. Track its presence in the
  // key so toggling tools on/off re-applies (setMcpServers replaces the full set).
  const claudianToolServer = deps.getClaudianToolServer?.();
  // Encode the scoped tool *contents* (not just presence) so a mid-session
  // grant edit or a tool added/removed/errored re-applies the server.
  const claudianKey = claudianToolServer ? `|claudian:${deps.getClaudianToolKey?.() ?? ''}` : '';
  const mcpServersKey = JSON.stringify(mcpServers) + claudianKey;

  const currentConfig = deps.getCurrentConfig();
  if (!currentConfig || mcpServersKey === currentConfig.mcpServersKey) {
    return;
  }

  // SECURITY (SEC-D): vet URL-based servers before their configs reach the
  // Claude CLI — the settings Test button is not on this path. Unsafe
  // servers are dropped (fail closed) rather than failing the turn; the key
  // still tracks the raw set so the drop is not re-announced every turn.
  const vetted = await vetActiveServersForRuntime(mcpServers);
  for (const entry of vetted.dropped) {
    deps.notifyFailure(`MCP server "${entry.name}" was not activated: ${entry.reason}`);
  }
  const serverConfigs: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(vetted.safe)) {
    serverConfigs[name] = config;
  }
  if (claudianToolServer) {
    // Key matches CLAUDIAN_TOOL_SERVER_NAME in features/tools; kept as a literal
    // because providers must not import from the features layer.
    serverConfigs['claudian'] = claudianToolServer as McpServerConfig;
  }

  try {
    await persistentQuery.setMcpServers(serverConfigs);
    deps.mutateCurrentConfig(config => {
      config.mcpServersKey = mcpServersKey;
    });
  } catch {
    deps.notifyFailure('Failed to update MCP servers');
  }
}

interface RestartContext {
  vaultPath: string;
  cliPath: string;
  newExternalContextPaths: string[];
}

async function maybeRestart(
  deps: ClaudeDynamicUpdateDeps,
  queryOptions: ChatRuntimeQueryOptions | undefined,
  restartOptions: ClosePersistentQueryOptions | undefined,
  context: RestartContext,
): Promise<void> {
  const newConfig = deps.buildPersistentQueryConfig(
    context.vaultPath,
    context.cliPath,
    context.newExternalContextPaths,
    queryOptions?.boundAgentPrompt,
  );
  if (!deps.needsRestart(newConfig)) {
    return;
  }

  const restarted = await deps.ensureReady({
    externalContextPaths: context.newExternalContextPaths,
    preserveHandlers: restartOptions?.preserveHandlers,
    force: true,
  });

  if (restarted && deps.getPersistentQuery()) {
    await applyClaudeDynamicUpdates(deps, queryOptions, restartOptions, false);
  }
}
