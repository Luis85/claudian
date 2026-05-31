// The Cursor CLI on Windows is a shim chain: `agent.cmd` invokes PowerShell,
// which invokes `node.exe index.js $args`. Routing a prompt through cmd.exe AND
// PowerShell double-reparses quotes/backslashes/colons and breaks `.ps1` arg
// binding. Spawning `node.exe index.js <args>` directly lets Node escape argv
// for a single CreateProcess, so prompts with quotes/backticks/`$`/`;`/`&`/`|`/
// backslashes and workspace paths with spaces/parens pass through cleanly.
// `resolveCursorSpawnSpec` (the cmd.exe wrapper) remains the fallback when the
// node + index.js entry point cannot be located.

import * as fs from 'fs';
import * as path from 'path';

import { resolveCursorSpawnSpec } from './cursorWindowsSpawn';

export interface CursorLaunchSpec {
  command: string;
  args: string[];
  extraEnv?: Record<string, string>;
  windowsVerbatimArguments?: boolean;
}

export interface CursorNodeEntry {
  node: string;
  entry: string;
}

const VERSION_DIR_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/;

function isFileSafe(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function versionSortKey(versionName: string): string {
  const datePart = versionName.split('-')[0];
  const [year, month, day] = datePart.split('.');
  return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
}

/**
 * Locates the `node` binary and `index.js` entry that the Cursor shim itself
 * resolves to. Looks next to the shim first, then under
 * `<installRoot>/versions/<latest>/`. Returns null on any fs error or miss.
 */
export function resolveCursorNodeEntry(
  cliPath: string,
  platform: NodeJS.Platform = process.platform,
): CursorNodeEntry | null {
  // Use platform-specific path semantics so win32 shim paths resolve correctly
  // even when the host (e.g. CI) runs POSIX. On the real target platform this is
  // identical to the host `path`.
  const p = platform === 'win32' ? path.win32 : path.posix;
  const nodeName = platform === 'win32' ? 'node.exe' : 'node';
  const dir = p.dirname(cliPath);

  const adjacentNode = p.join(dir, nodeName);
  const adjacentEntry = p.join(dir, 'index.js');
  if (isFileSafe(adjacentNode) && isFileSafe(adjacentEntry)) {
    return { node: adjacentNode, entry: adjacentEntry };
  }

  try {
    const versionsDir = p.join(dir, 'versions');
    const candidates = fs
      .readdirSync(versionsDir)
      .filter(name => VERSION_DIR_PATTERN.test(name))
      .sort((a, b) => versionSortKey(b).localeCompare(versionSortKey(a)));

    for (const version of candidates) {
      const node = p.join(versionsDir, version, nodeName);
      const entry = p.join(versionsDir, version, 'index.js');
      if (isFileSafe(node) && isFileSafe(entry)) {
        return { node, entry };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function deriveInvokedAs(cliPath: string, platform: NodeJS.Platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const base = p.basename(cliPath);
  const stripped = base.replace(/\.(cmd|bat|ps1|exe)$/i, '');
  return stripped || 'cursor-agent';
}

/**
 * Resolves how to launch the Cursor CLI. Prefers spawning `node index.js`
 * directly (robust argv escaping on all platforms); falls back to
 * `resolveCursorSpawnSpec` when the node entry point cannot be located.
 */
export function resolveCursorLaunch(
  cliPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CursorLaunchSpec {
  const entry = resolveCursorNodeEntry(cliPath, platform);
  if (entry) {
    return {
      command: entry.node,
      args: [entry.entry, ...args],
      extraEnv: { CURSOR_INVOKED_AS: deriveInvokedAs(cliPath, platform) },
    };
  }

  const spec = resolveCursorSpawnSpec(cliPath, args, platform);
  return {
    command: spec.command,
    args: spec.args,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  };
}
