// Windows refuses to spawn `.cmd`/`.bat` batch files without a shell (Node's
// CVE-2024-27980 fix, 18.20.2+/20.12.2+), throwing `spawn EINVAL`. The Cursor
// CLI on Windows is typically an npm-style `.cmd` shim, so batch commands must be
// run through cmd.exe with verbatim, manually-quoted arguments. This mirrors the
// approach the Codex provider already uses (CodexAppServerProcess).

const WINDOWS_CMD_ARGUMENT_CHARS = /[\s"&<>|{}^=;!'+,`~()%@]/u;

function requiresWindowsShellQuoting(value: string): boolean {
  return WINDOWS_CMD_ARGUMENT_CHARS.test(value)
    || value.includes('[')
    || value.includes(']');
}

function quoteWindowsShellArgument(value: string): string {
  if (!value.length) {
    return '""';
  }

  if (!requiresWindowsShellQuoting(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

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
    const shellCommand = [trimmed, ...args]
      .map(value => quoteWindowsShellArgument(value))
      .join(' ');

    return {
      command: process.env.ComSpec || process.env.comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${shellCommand}"`],
      windowsVerbatimArguments: true,
    };
  }

  return { command, args };
}
