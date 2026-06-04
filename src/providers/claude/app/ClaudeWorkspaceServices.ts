import { extractMcpServerSecrets } from '../../../core/mcp/mcpSecrets';
import { McpServerManager } from '../../../core/mcp/McpServerManager';
import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  AppAgentManager,
  AppAgentStorage,
  AppMcpStorage,
  AppPluginManager,
  ProviderCliResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { PluginContext } from '../../../core/types/PluginContext';
import { promptVaultTrust } from '../../../shared/modals/VaultTrustModal';
import { getVaultPath } from '../../../utils/path';
import { AgentManager } from '../agents/AgentManager';
import { ClaudeCommandCatalog } from '../commands/ClaudeCommandCatalog';
import { probeRuntimeCommands } from '../commands/probeRuntimeCommands';
import { PluginManager } from '../plugins/PluginManager';
import { claudeCliSpec } from '../runtime/ClaudeCliResolver';
import {
  isClaudeVaultTrusted,
  setClaudeVaultTrusted,
  vaultProjectSettingsRisky,
} from '../runtime/claudeProjectTrust';
import { StorageService } from '../storage/StorageService';
import { claudeSettingsTabRenderer } from '../ui/ClaudeSettingsTab';

export interface ClaudeWorkspaceServices extends ProviderWorkspaceServices {
  claudeStorage: StorageService;
  cliResolver: ProviderCliResolver;
  mcpStorage: AppMcpStorage;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentStorage: AppAgentStorage;
  agentManager: AppAgentManager;
  commandCatalog: ProviderCommandCatalog;
  agentMentionProvider: AppAgentManager;
}

export async function createClaudeWorkspaceServices(
  plugin: PluginContext,
  adapter: VaultFileAdapter,
): Promise<ClaudeWorkspaceServices> {
  const claudeStorage = new StorageService(plugin, adapter);
  await claudeStorage.ensureDirectories();

  // SEC-2: the per-turn setting-source gate reads project-settings risk fresh from
  // disk, so it always reflects the current `.claude/settings.json`. Here we only
  // surface a one-time (non-blocking) trust prompt when risk is present at init and
  // the vault is untrusted; until trusted the gate withholds the project/local sources.
  if (vaultProjectSettingsRisky(plugin) && !isClaudeVaultTrusted(plugin)) {
    void maybePromptVaultTrust(plugin);
  }

  const cliResolver = new CachedCliResolver(claudeCliSpec);
  const mcpStorage = claudeStorage.mcp;
  // SEC-A Phase 3: resolve secret auth-header / stdio-env values from SecretStorage
  // at launch (the value never lives in `.claude/mcp.json`).
  const mcpManager = new McpServerManager(mcpStorage, (id) => plugin.secretStore.get(id));

  // SEC-3 one-time grandfather: trust vault MCP servers already present at upgrade
  // so an existing config is not silently disabled, while newly-synced servers
  // still default to disabled. The flag lives in the per-vault settings file, so
  // it runs once per vault on first post-upgrade init.
  if (!plugin.settings.mcpVaultServersGrandfathered) {
    try {
      await mcpStorage.grandfatherExistingServers();
    } catch {
      // best-effort migration; never block workspace init
    }
    plugin.settings.mcpVaultServersGrandfathered = true;
    await plugin.saveSettings();
  }

  await mcpManager.loadServers();

  // SEC-A Phase 3: one-time migration of any plaintext secret headers/env already
  // in `.claude/mcp.json` into SecretStorage. Best-effort; never blocks init.
  try {
    const servers = mcpManager.getServers();
    if (extractMcpServerSecrets(servers, plugin.secretStore)) {
      await mcpStorage.save(servers);
    }
  } catch {
    // migration must not break workspace init
  }

  const vaultPath = getVaultPath(plugin.app) ?? '';
  const pluginManager = new PluginManager(vaultPath, claudeStorage.ccSettings);
  await pluginManager.loadPlugins();

  const agentStorage = claudeStorage.agents;
  const agentManager = new AgentManager(vaultPath, pluginManager);
  await agentManager.loadAgents();

  const commandCatalog = new ClaudeCommandCatalog(
    claudeStorage.commands,
    claudeStorage.skills,
    () => probeRuntimeCommands(plugin),
  );

  return {
    claudeStorage,
    cliResolver,
    mcpStorage,
    mcpServerManager: mcpManager,
    mcpManager,
    pluginManager,
    agentStorage,
    agentManager,
    commandCatalog,
    agentMentionProvider: agentManager,
    settingsTabRenderer: claudeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentManager.loadAgents();
    },
  };
}

/**
 * SEC-2: surface the one-time trust prompt for an untrusted, risky vault. Runs
 * outside workspace init so it never blocks startup; the gate already withholds
 * the risky sources, so a deferred/declined answer is safe. On trust the change
 * is persisted — the next turn rebuilds the query config (settingSources flips),
 * which `QueryOptionsBuilder.needsRestart` detects and restarts to honor them.
 */
async function maybePromptVaultTrust(plugin: PluginContext): Promise<void> {
  try {
    const trusted = await promptVaultTrust(plugin.app);
    if (trusted) {
      await setClaudeVaultTrusted(plugin, true);
    }
  } catch {
    // A modal failure must never break workspace init; the vault stays untrusted.
  }
}

export const claudeWorkspaceRegistration: ProviderWorkspaceRegistration<ClaudeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createClaudeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetClaudeWorkspaceServices(): ClaudeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('claude') as ClaudeWorkspaceServices | null;
}

export function getClaudeWorkspaceServices(): ClaudeWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('claude') as ClaudeWorkspaceServices;
}
