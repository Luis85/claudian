import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath, parseEnvironmentVariables } from './env';
import { expandHomePath, parsePathEntries } from './path';

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Expands a user-configured CLI path and returns it only when it points at a real file. */
function resolveConfiguredCliPath(configuredPath: string | undefined): string | null {
  const trimmed = (configuredPath ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const expandedPath = expandHomePath(trimmed);
    return isExistingFile(expandedPath) ? expandedPath : null;
  } catch {
    return null;
  }
}

/** Scans the enhanced PATH for the first existing binary among the given candidate names. */
export function findBinaryOnPath(binaryNames: string[], additionalPath?: string): string | null {
  const searchEntries = parsePathEntries(getEnhancedPath(additionalPath));

  for (const dir of searchEntries) {
    if (!dir) continue;

    for (const binaryName of binaryNames) {
      const candidate = path.join(dir, binaryName);
      if (isExistingFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Shared CLI-path resolution cascade: host-scoped configured path, then the
 * legacy single-path setting, then a PATH scan seeded with any PATH override
 * from the provider's custom environment text.
 */
export function resolveConfiguredOrDiscoveredCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
  findBinary: (additionalPath?: string) => string | null,
): string | null {
  return resolveConfiguredCliPath(hostnamePath)
    ?? resolveConfiguredCliPath(legacyPath)
    ?? findBinary(parseEnvironmentVariables(envText || '').PATH);
}
