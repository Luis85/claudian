import * as fs from 'node:fs';

import type { CliResolutionSpec } from '../../../core/providers/CachedCliResolver';
import { expandHomePath } from '../../../utils/path';
import { getOpencodeProviderSettings } from '../settings';

function resolveConfiguredCliPath(cliPath: string): string | null {
  if (!cliPath) {
    return null;
  }
  try {
    const expanded = expandHomePath(cliPath);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    return null;
  }
  return null;
}

/** Resolves the OpenCode CLI path from configured paths only — no PATH auto-detection. */
export function resolveOpencodeCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
): string | null {
  return (
    resolveConfiguredCliPath((hostnamePath ?? '').trim())
    ?? resolveConfiguredCliPath((legacyPath ?? '').trim())
  );
}

export const opencodeCliSpec: CliResolutionSpec = {
  providerId: 'opencode',
  read: settings => {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    return {
      cliPath: opencodeSettings.cliPath,
      cliPathsByHost: opencodeSettings.cliPathsByHost,
      extra: undefined,
    };
  },
  resolve: ({ hostnamePath, legacyPath }) => resolveOpencodeCliPath(hostnamePath, legacyPath),
};
