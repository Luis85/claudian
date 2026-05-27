import type { CliResolutionSpec } from '../../../core/providers/CachedCliResolver';
import { getCursorProviderSettings } from '../settings';
import { resolveCursorCliPath } from './CursorBinaryLocator';

export const cursorCliSpec: CliResolutionSpec = {
  providerId: 'cursor',
  read: settings => {
    const cursorSettings = getCursorProviderSettings(settings);
    return {
      cliPath: cursorSettings.cliPath,
      cliPathsByHost: cursorSettings.cliPathsByHost,
      extra: undefined,
    };
  },
  resolve: ({ hostnamePath, legacyPath, envText }) =>
    resolveCursorCliPath(hostnamePath, legacyPath, envText),
};
