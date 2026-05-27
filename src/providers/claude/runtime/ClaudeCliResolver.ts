import * as fs from 'fs';

import type { CliResolutionSpec } from '../../../core/providers/CachedCliResolver';
import { parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { findClaudeCLIPath } from '../cli/findClaudeCLIPath';
import { getClaudeProviderSettings } from '../settings';

function resolveConfiguredPath(rawPath: string | undefined): string | null {
  const trimmed = (rawPath ?? '').trim();
  if (!trimmed) return null;
  try {
    const expanded = expandHomePath(trimmed);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    // Fall through
  }
  return null;
}

/** Resolves the Claude CLI path with priority: device-specific -> legacy -> PATH auto-detect. */
export function resolveClaudeCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
): string | null {
  return (
    resolveConfiguredPath(hostnamePath) ??
    resolveConfiguredPath(legacyPath) ??
    findClaudeCLIPath(parseEnvironmentVariables(envText || '').PATH)
  );
}

export const claudeCliSpec: CliResolutionSpec = {
  providerId: 'claude',
  read: settings => {
    const claudeSettings = getClaudeProviderSettings(settings);
    return {
      cliPath: claudeSettings.cliPath,
      cliPathsByHost: claudeSettings.cliPathsByHost,
      extra: undefined,
    };
  },
  resolve: ({ hostnamePath, legacyPath, envText }) =>
    resolveClaudeCliPath(hostnamePath, legacyPath, envText),
};
