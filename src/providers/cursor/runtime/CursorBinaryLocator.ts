import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath, parsePathEntries } from '../../../utils/path';

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveConfiguredPath(configuredPath: string | undefined): string | null {
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

export function findCursorAgentBinaryPath(
  additionalPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  // On Windows the npm-style install also drops an extensionless `agent` shell
  // shim that CreateProcess cannot execute (spawn EINVAL); prefer the runnable
  // `.exe`/`.cmd` variants. `.cmd` is then wrapped via cmd.exe at spawn time.
  // Both `agent.*` and `cursor-agent.*` names ship (the standalone installer
  // under %LOCALAPPDATA%\cursor-agent exposes `cursor-agent`), so try both;
  // `agent.*` wins when present to preserve historical behavior.
  const binaryNames = platform === 'win32'
    ? ['agent.exe', 'agent.cmd', 'cursor-agent.exe', 'cursor-agent.cmd', 'agent', 'cursor-agent']
    : ['agent', 'cursor-agent'];
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

export function resolveCursorCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
  hostPlatform: NodeJS.Platform = process.platform,
): string | null {
  const configuredHostnamePath = resolveConfiguredPath(hostnamePath);
  if (configuredHostnamePath) {
    return configuredHostnamePath;
  }

  const configuredLegacyPath = resolveConfiguredPath(legacyPath);
  if (configuredLegacyPath) {
    return configuredLegacyPath;
  }

  const customEnv = parseEnvironmentVariables(envText || '');
  return findCursorAgentBinaryPath(customEnv.PATH, hostPlatform);
}
