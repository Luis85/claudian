// Windows refuses to spawn `.cmd`/`.bat` batch shims without a shell (Node's
// CVE-2024-27980 fix, 18.20.2+/20.12.2+), throwing `spawn EINVAL`. Batch commands
// must run through cmd.exe with verbatim, manually-quoted arguments. Shared by the
// Codex app-server and Cursor CLI spawn paths.

const WINDOWS_CMD_ARGUMENT_CHARS = /[\s"&<>|{}^=;!'+,`~()%@]/u;

export function requiresWindowsShellQuoting(value: string): boolean {
  return WINDOWS_CMD_ARGUMENT_CHARS.test(value)
    || value.includes('[')
    || value.includes(']');
}

export function quoteWindowsShellArgument(value: string): string {
  if (!value.length) {
    return '""';
  }

  if (!requiresWindowsShellQuoting(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export interface WindowsCmdShim {
  command: string;
  args: string[];
  windowsVerbatimArguments: true;
}

/**
 * Wraps a batch command and its args to run through cmd.exe with verbatim,
 * manually-quoted arguments. Callers decide *when* to wrap (which command
 * extensions count as batch shims on their platform); this owns the *how*.
 */
export function wrapWindowsCmdShim(command: string, args: readonly string[]): WindowsCmdShim {
  const shellCommand = [command, ...args]
    .map((value) => quoteWindowsShellArgument(value))
    .join(' ');

  return {
    command: process.env.ComSpec || process.env.comspec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}
