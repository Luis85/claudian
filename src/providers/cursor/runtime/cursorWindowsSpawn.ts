// The Cursor CLI on Windows is typically an npm-style `.cmd` shim. Windows refuses
// to spawn `.cmd`/`.bat` batch files without a shell (Node's CVE-2024-27980 fix),
// so those are wrapped through cmd.exe via the shared `wrapWindowsCmdShim` helper.

import { wrapWindowsCmdShim } from '../../../utils/windowsSpawn';

export interface CursorSpawnSpec {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * Resolves the command/args to actually hand to `spawn()`. On Windows, when the
 * resolved CLI is a batch shim (`.cmd`/`.bat`), it is wrapped through cmd.exe to
 * avoid `spawn EINVAL`. On every other platform (and for `.exe`/native binaries)
 * the command passes through unchanged.
 */
export function resolveCursorSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CursorSpawnSpec {
  const trimmed = command.trim();
  if (!trimmed || platform !== 'win32') {
    return { command, args };
  }

  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return wrapWindowsCmdShim(trimmed, args);
  }

  return { command, args };
}
