import {
  findBinaryOnPath,
  resolveConfiguredOrDiscoveredCliPath,
} from '../../../utils/cliBinaryLocator';

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
  return findBinaryOnPath(binaryNames, additionalPath);
}

export function resolveCursorCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
  hostPlatform: NodeJS.Platform = process.platform,
): string | null {
  return resolveConfiguredOrDiscoveredCliPath(
    hostnamePath,
    legacyPath,
    envText,
    (additionalPath) => findCursorAgentBinaryPath(additionalPath, hostPlatform),
  );
}
