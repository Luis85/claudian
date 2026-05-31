import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parsePathEntries, resolveNvmDefaultBin } from './path';

const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';
const NODE_EXECUTABLE = isWindows ? 'node.exe' : 'node';
const DEVICE_SETTINGS_STORAGE_KEY = 'claudian.deviceSettingsKey';
let cachedDeviceSettingsKey: string | null = null;

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// Linux excluded: Obsidian registers the CLI through stable symlinks (/usr/local/bin,
// ~/.local/bin), while process.execPath may point to a transient AppImage mount.
function getAppProvidedCliPaths(): string[] {
  if (process.platform === 'darwin') {
    const appBundleMatch = process.execPath.match(/^(.+?\.app)\//);
    if (appBundleMatch) {
      return [path.join(appBundleMatch[1], 'Contents', 'MacOS')];
    }
    return [path.dirname(process.execPath)];
  }

  if (process.platform === 'win32') {
    return [path.dirname(process.execPath)];
  }

  return [];
}

/** GUI apps like Obsidian have minimal PATH, so we add common binary locations. */
function getExtraBinaryPaths(): string[] {
  const home = getHomeDir();

  if (isWindows) {
    const paths: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programData = process.env.ProgramData || 'C:\\ProgramData';

    // Node.js / npm locations
    if (appData) {
      paths.push(path.join(appData, 'npm'));
    }
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'nodejs'));
      paths.push(path.join(localAppData, 'Programs', 'node'));
    }

    // Common program locations (official Node.js installer)
    paths.push(path.join(programFiles, 'nodejs'));
    paths.push(path.join(programFilesX86, 'nodejs'));

    // nvm-windows: active Node.js is usually under %NVM_SYMLINK%
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
      paths.push(nvmSymlink);
    }

    // nvm-windows: stores Node.js versions in %NVM_HOME% or %APPDATA%\nvm
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path.join(appData, 'nvm'));
    }

    // volta: installs to %VOLTA_HOME%\bin or %USERPROFILE%\.volta\bin
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    } else if (home) {
      paths.push(path.join(home, '.volta', 'bin'));
    }

    // fnm (Fast Node Manager): %FNM_MULTISHELL_PATH% is the active Node.js bin
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }

    // fnm (Fast Node Manager): %FNM_DIR% or %LOCALAPPDATA%\fnm
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path.join(localAppData, 'fnm'));
    }

    // Chocolatey: %ChocolateyInstall%\bin or C:\ProgramData\chocolatey\bin
    const chocolateyInstall = process.env.ChocolateyInstall;
    if (chocolateyInstall) {
      paths.push(path.join(chocolateyInstall, 'bin'));
    } else {
      paths.push(path.join(programData, 'chocolatey', 'bin'));
    }

    // scoop: %SCOOP%\shims or %USERPROFILE%\scoop\shims
    const scoopDir = process.env.SCOOP;
    if (scoopDir) {
      paths.push(path.join(scoopDir, 'shims'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current'));
    } else if (home) {
      paths.push(path.join(home, 'scoop', 'shims'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current'));
    }

    // Docker
    paths.push(path.join(programFiles, 'Docker', 'Docker', 'resources', 'bin'));

    // User bin (if exists)
    if (home) {
      paths.push(path.join(home, '.local', 'bin'));
      paths.push(path.join(home, '.bun', 'bin'));
      paths.push(path.join(home, '.opencode', 'bin'));
    }

    paths.push(...getAppProvidedCliPaths());

    return paths;
  } else {
    // Unix paths
    const paths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',  // macOS ARM Homebrew
      '/usr/bin',
      '/bin',
    ];

    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    }

    const asdfRoot = process.env.ASDF_DATA_DIR || process.env.ASDF_DIR;
    if (asdfRoot) {
      paths.push(path.join(asdfRoot, 'shims'));
      paths.push(path.join(asdfRoot, 'bin'));
    }

    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }

    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    }

    if (home) {
      paths.push(path.join(home, '.local', 'bin'));
      paths.push(path.join(home, '.bun', 'bin'));
      paths.push(path.join(home, '.opencode', 'bin'));
      paths.push(path.join(home, '.docker', 'bin'));
      paths.push(path.join(home, '.volta', 'bin'));
      paths.push(path.join(home, '.asdf', 'shims'));
      paths.push(path.join(home, '.asdf', 'bin'));
      paths.push(path.join(home, '.fnm'));

      // NVM: use NVM_BIN if set, otherwise resolve default version from filesystem
      const nvmBin = process.env.NVM_BIN;
      if (nvmBin) {
        paths.push(nvmBin);
      } else {
        const nvmDefault = resolveNvmDefaultBin(home);
        if (nvmDefault) {
          paths.push(nvmDefault);
        }
      }
    }

    paths.push(...getAppProvidedCliPaths());

    return paths;
  }
}

export function findNodeDirectory(additionalPaths?: string): string | null {
  const searchPaths = getExtraBinaryPaths();

  const currentPath = process.env.PATH || '';
  const pathDirs = parsePathEntries(currentPath);
  const additionalDirs = additionalPaths ? parsePathEntries(additionalPaths) : [];
  const allPaths = [...additionalDirs, ...searchPaths, ...pathDirs];

  for (const dir of allPaths) {
    if (!dir) continue;
    try {
      const nodePath = path.join(dir, NODE_EXECUTABLE);
      if (fs.existsSync(nodePath)) {
        const stat = fs.statSync(nodePath);
        if (stat.isFile()) {
          return dir;
        }
      }
    } catch {
      // Inaccessible directory
    }
  }

  return null;
}

export function findNodeExecutable(additionalPaths?: string): string | null {
  const nodeDir = findNodeDirectory(additionalPaths);
  if (nodeDir) {
    return path.join(nodeDir, NODE_EXECUTABLE);
  }
  return null;
}

export function cliPathRequiresNode(cliPath: string): boolean {
  const jsExtensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
  const lower = cliPath.toLowerCase();
  if (jsExtensions.some(ext => lower.endsWith(ext))) {
    return true;
  }

  try {
    if (!fs.existsSync(cliPath)) {
      return false;
    }

    const stat = fs.statSync(cliPath);
    if (!stat.isFile()) {
      return false;
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(cliPath, 'r');
      const buffer = Buffer.alloc(200);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const header = buffer.subarray(0, bytesRead).toString('utf8');
      if (!header.startsWith('#!')) return false;
      const shebangLine = header.split(/\r?\n/)[0].toLowerCase();
      return shebangLine.includes('node');
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }
  } catch {
    return false;
  }
}

export function getMissingNodeError(cliPath: string, enhancedPath?: string): string | null {
  if (!cliPathRequiresNode(cliPath)) {
    return null;
  }

  const nodePath = findNodeExecutable(enhancedPath);
  if (nodePath) {
    return null;
  }

  return 'Claude Code CLI requires Node.js, but Node was not found on PATH. Install Node.js or use the native Claude Code binary, then restart Obsidian.';
}

export function getEnhancedPath(additionalPaths?: string, cliPath?: string): string {
  const extraPaths = getExtraBinaryPaths().filter(p => p);
  const currentPath = process.env.PATH || '';

  const segments: string[] = [];

  if (additionalPaths) {
    segments.push(...parsePathEntries(additionalPaths));
  }

  let cliDirHasNode = false;
  if (cliPath) {
    try {
      const cliDir = path.dirname(cliPath);
      const nodeInCliDir = path.join(cliDir, NODE_EXECUTABLE);
      if (fs.existsSync(nodeInCliDir)) {
        const stat = fs.statSync(nodeInCliDir);
        if (stat.isFile()) {
          segments.push(cliDir);
          cliDirHasNode = true;
        }
      }
    } catch {
      // Ignore errors checking CLI directory
    }
  }

  if (cliPath && cliPathRequiresNode(cliPath) && !cliDirHasNode) {
    const nodeDir = findNodeDirectory();
    if (nodeDir) {
      segments.push(nodeDir);
    }
  }

  segments.push(...extraPaths);

  if (currentPath) {
    segments.push(...parsePathEntries(currentPath));
  }

  const seen = new Set<string>();
  const unique = segments.filter(p => {
    const normalized = isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return unique.join(PATH_SEPARATOR);
}

export function parseEnvironmentVariables(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex > 0) {
      const key = normalized.substring(0, eqIndex).trim();
      let value = normalized.substring(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * System-essential environment variables that legitimate child processes need
 * to function (locate the user/home, temp dirs, locale, terminal, display).
 * Anything outside this set — and outside explicit user-configured vars — is
 * withheld so untrusted child processes (e.g. vault-defined MCP servers) cannot
 * harvest the host's full environment (cloud creds, tokens, ssh-agent sockets).
 */
const SYSTEM_ESSENTIAL_ENV_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'TZ',
  'COLORTERM',
  // Windows path/loader essentials.
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMSPEC',
  'PATHEXT',
  // GUI/X11 plumbing some CLIs probe.
  'DISPLAY',
  'XAUTHORITY',
  // Network plumbing (non-secret): proxy + custom-CA config that network-fetching
  // MCP servers rely on in corporate environments. Withholding these would break
  // TLS/connectivity for servers that previously inherited them; they are config,
  // not credentials, so passing them through does not reopen the secret-leak.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
];

/** Proxy env vars whose values are URLs that may embed `user:pass@` credentials. */
const CREDENTIALED_PROXY_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']);

/**
 * SECURITY (SEC-4): strip embedded `user:pass@` userinfo from a host proxy URL so
 * the credentials aren't handed to an untrusted child while still preserving
 * proxy connectivity (host:port survive). A user who genuinely needs an
 * authenticated proxy inside a server sets it explicitly in that server's `env`.
 */
function stripProxyCredentials(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      return url.toString();
    }
    return value;
  } catch {
    // Not a parseable URL — best-effort strip of a leading `scheme://user:pass@`.
    return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
  }
}

/**
 * SECURITY (SEC-4): Build a curated environment for spawning an untrusted child
 * process instead of forwarding all of `process.env`. Only system-essential keys
 * pass through from the host; the caller supplies any additional process-specific
 * vars (user-configured MCP `env`, an enhanced PATH) via `overrides`, which always
 * win. Use this for vault-defined MCP servers and other untrusted spawn surfaces.
 */
export function buildCuratedChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SYSTEM_ESSENTIAL_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string') {
      // Host proxy URLs may embed credentials — never leak those to the child.
      result[key] = CREDENTIALED_PROXY_KEYS.has(key) ? stripProxyCredentials(value) : value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * SECURITY (SEC-4): Curate the env for a vault-defined stdio MCP server. The
 * server gets system-essentials plus its own configured vars and an enhanced
 * PATH — never the host's full environment. Used both by the in-app connection
 * test (`McpTester`) and the live chat spawn path (`options.mcpServers`).
 */
export function curateStdioMcpEnv(
  configuredEnv?: Record<string, string>,
): Record<string, string> {
  return buildCuratedChildEnv({
    ...configuredEnv,
    PATH: getEnhancedPath(configuredEnv?.PATH),
  });
}

function getDeviceSettingsStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function createOpaqueDeviceSettingsKey(): string {
  const cryptoApi = typeof window === 'undefined' ? null : window.crypto;
  const randomUUID = cryptoApi?.randomUUID?.();
  if (randomUUID) {
    return `device:${randomUUID}`;
  }

  if (cryptoApi?.getRandomValues) {
    const randomBytes = new Uint8Array(16);
    cryptoApi.getRandomValues(randomBytes);
    const entropy = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `device:${Date.now().toString(36)}:${entropy}`;
  }

  const entropy = Math.random().toString(36).slice(2);
  return `device:${Date.now().toString(36)}:${entropy}`;
}

// Backward-compatible name: provider settings still store legacy `cliPathsByHost`
// maps, but new keys are opaque per-install identifiers rather than hostnames.
export function getHostnameKey(): string {
  if (cachedDeviceSettingsKey) {
    return cachedDeviceSettingsKey;
  }

  const storage = getDeviceSettingsStorage();
  const stored = storage?.getItem(DEVICE_SETTINGS_STORAGE_KEY)?.trim();
  if (stored) {
    cachedDeviceSettingsKey = stored;
    return cachedDeviceSettingsKey;
  }

  cachedDeviceSettingsKey = createOpaqueDeviceSettingsKey();
  try {
    storage?.setItem(DEVICE_SETTINGS_STORAGE_KEY, cachedDeviceSettingsKey);
  } catch {
    // Local storage can be unavailable in restricted renderer contexts.
  }

  return cachedDeviceSettingsKey;
}

export function getLegacyHostnameKey(): string {
  try {
    return os.hostname();
  } catch {
    return '';
  }
}

export function migrateLegacyHostnameKeyedMap<T extends string>(
  entries: Record<string, T>,
  currentKey: string,
  legacyHostnameKey: string,
): Record<string, T> {
  if (!currentKey || !legacyHostnameKey || currentKey === legacyHostnameKey) {
    return entries;
  }

  const hasCurrentEntry = Object.prototype.hasOwnProperty.call(entries, currentKey);
  const hasLegacyEntry = Object.prototype.hasOwnProperty.call(entries, legacyHostnameKey);
  if (!hasLegacyEntry) {
    return entries;
  }

  const migrated = { ...entries };
  if (!hasCurrentEntry) {
    migrated[currentKey] = entries[legacyHostnameKey];
  }
  delete migrated[legacyHostnameKey];
  return migrated;
}

export const MIN_CONTEXT_LIMIT = 1_000;
export const MAX_CONTEXT_LIMIT = 10_000_000;

export function parseContextLimit(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/,/g, '');
  if (!trimmed) return null;

  // Match number with optional suffix (k, m)
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(k|m)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const suffix = match[2];

  if (isNaN(value) || value <= 0) return null;

  const MULTIPLIERS: Record<string, number> = { k: 1_000, m: 1_000_000 };
  const multiplier = suffix ? MULTIPLIERS[suffix] ?? 1 : 1;
  const result = Math.round(value * multiplier);

  if (result < MIN_CONTEXT_LIMIT || result > MAX_CONTEXT_LIMIT) return null;

  return result;
}

export function formatContextLimit(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}m`;
  }
  if (tokens >= 1000 && tokens % 1000 === 0) {
    return `${tokens / 1000}k`;
  }
  return tokens.toLocaleString('en-US');
}
