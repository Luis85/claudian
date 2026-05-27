import type { CliResolutionSpec } from '../../../core/providers/CachedCliResolver';
import type { CodexInstallationMethod } from '../settings';
import { getCodexProviderSettings } from '../settings';
import { resolveCodexCliPath } from './CodexBinaryLocator';

export const codexCliSpec: CliResolutionSpec<CodexInstallationMethod> = {
  providerId: 'codex',
  read: settings => {
    const codexSettings = getCodexProviderSettings(settings);
    return {
      cliPath: codexSettings.cliPath,
      cliPathsByHost: codexSettings.cliPathsByHost,
      extra: codexSettings.installationMethod,
    };
  },
  resolve: ({ hostnamePath, legacyPath, envText, extra }) =>
    resolveCodexCliPath(hostnamePath, legacyPath, envText, { installationMethod: extra }),
  cacheKeyForExtra: installationMethod => installationMethod,
};
