import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import type {
  ProviderCliResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { getVaultPath } from '../../../utils/path';
import { CursorAgentMentionProvider } from '../agents/CursorAgentMentionProvider';
import { buildCursorAgentEnvironment } from '../runtime/cursorAgentEnv';
import { cursorCliSpec } from '../runtime/CursorCliResolver';
import { refreshCursorModelCatalog } from '../runtime/cursorModelCatalog';
import { getCursorProviderSettings } from '../settings';
import { CursorAgentStorage } from '../storage/CursorAgentStorage';
import { cursorSettingsTabRenderer } from '../ui/CursorSettingsTab';

export interface CursorWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: CursorAgentStorage;
  agentMentionProvider: CursorAgentMentionProvider;
}

function createCursorCliResolver(): ProviderCliResolver {
  return new CachedCliResolver(cursorCliSpec);
}

function warmCursorModelCatalog(plugin: PluginContext, cliResolver: ProviderCliResolver): void {
  const settings = asSettingsBag(plugin.settings);
  if (!getCursorProviderSettings(settings).enabled) {
    return;
  }
  const cliPath = cliResolver.resolveFromSettings(settings);
  if (!cliPath) {
    return;
  }
  const env = buildCursorAgentEnvironment(plugin);
  const cwd = getVaultPath(plugin.app) ?? process.cwd();
  void refreshCursorModelCatalog(cliPath, env, cwd).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Timeouts are expected (slow CLI / offline) and self-recover via cache.
    if (/timed out/i.test(message)) {
      return;
    }
    plugin.logger.scope('cursor.workspace').warn('model discovery failed', err);
  });
}

export async function createCursorWorkspaceServices(
  plugin: PluginContext,
  vaultAdapter: VaultFileAdapter,
  homeAdapter: HomeFileAdapter,
): Promise<CursorWorkspaceServices> {
  const cliResolver = createCursorCliResolver();
  warmCursorModelCatalog(plugin, cliResolver);

  const agentStorage = new CursorAgentStorage(vaultAdapter, homeAdapter);
  const agentMentionProvider = new CursorAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    cliResolver,
    settingsTabRenderer: cursorSettingsTabRenderer,
    agentStorage,
    agentMentionProvider,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const cursorWorkspaceRegistration: ProviderWorkspaceRegistration<CursorWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter, homeAdapter }) => createCursorWorkspaceServices(
    plugin,
    vaultAdapter,
    homeAdapter,
  ),
};
