import * as path from 'path';

import { buildAllowlistedSubprocessEnvironment } from '../../../core/providers/subprocessEnvironmentAllowlist';
import type { PluginContext } from '../../../core/types/PluginContext';
import { getEnhancedPath } from '../../../utils/env';

function windowsSystemRoot(): string | undefined {
  return process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR;
}

function ensureWindowsCursorAgentPath(pathValue: string): string {
  const systemRoot = windowsSystemRoot();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const extras = [
    ...(systemRoot
      ? [
        path.win32.join(systemRoot, 'System32'),
        path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      ]
      : []),
    path.win32.join(programFiles, 'Git', 'cmd'),
    path.win32.join(programFiles, 'Git', 'bin'),
    path.win32.join(programFilesX86, 'Git', 'cmd'),
    path.win32.join(programFilesX86, 'Git', 'bin'),
  ];

  const segments = pathValue.split(';').filter(Boolean);
  const seen = new Set(segments.map((segment) => segment.toLowerCase()));
  const prefix: string[] = [];
  for (const extra of extras) {
    const key = extra.toLowerCase();
    if (!seen.has(key)) {
      prefix.push(extra);
      seen.add(key);
    }
  }
  return [...prefix, ...segments].join(';');
}

function resolveWindowsPowerShellShell(): string | undefined {
  const systemRoot = windowsSystemRoot();
  if (!systemRoot) {
    return undefined;
  }
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * cursor-agent picks a shell executor at startup. On Windows the Git Bash path
 * spawns tools with detached:true (visible console), while PowerShell uses
 * detached:false. GUI hosts like Obsidian often have a minimal PATH that omits
 * System32, so cursor-agent can miss PowerShell and fall back to Bash/Naive.
 */
function applyWindowsCursorAgentShellEnvironment(
  env: Record<string, string>,
  customEnv: Record<string, string>,
): void {
  const userSet = (key: string) => Object.prototype.hasOwnProperty.call(customEnv, key);

  // Cursor Agent uses these Git-for-Windows signals to select its Bash executor.
  // They are paths/mode flags rather than secrets, and preserving them keeps Bash
  // tool calls running in Bash instead of silently switching to PowerShell.
  for (const key of ['MSYSTEM', 'EXEPATH', 'MINGW_PREFIX']) {
    if (!userSet(key) && typeof process.env[key] === 'string' && !env[key]) {
      env[key] = process.env[key] as string;
    }
  }

  env.PATH = ensureWindowsCursorAgentPath(env.PATH ?? '');

  if (!userSet('SHELL')) {
    const shell = env.SHELL ?? '';
    const looksLikeGitBash = /[\\/]git[\\/].*bash\.exe/i.test(shell) || /msys/i.test(shell);
    const hasGitBashSignals = !!env.MSYSTEM || !!env.EXEPATH || !!env.MINGW_PREFIX || looksLikeGitBash;
    if (!shell && !hasGitBashSignals) {
      const powershell = resolveWindowsPowerShellShell();
      if (powershell) {
        env.SHELL = powershell;
      }
    }
  }
}

export function buildCursorAgentEnvironment(plugin: PluginContext): Record<string, string> {
  const customEnv = plugin.getResolvedEnvironmentVariables('cursor');
  const env = buildAllowlistedSubprocessEnvironment({
    processEnv: process.env,
    customEnv,
    providerPrefixPattern: /^CURSOR_/i,
    pathOverride: getEnhancedPath(customEnv.PATH),
  });

  if (process.platform === 'win32') {
    applyWindowsCursorAgentShellEnvironment(env, customEnv);
  }

  return env;
}
