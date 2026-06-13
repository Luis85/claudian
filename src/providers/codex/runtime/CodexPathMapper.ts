import * as path from 'path';

import type { CodexExecutionTarget, CodexPathMapper } from './codexLaunchTypes';

function normalizeWindowsPath(value: string): string {
  if (!value) {
    return '';
  }

  let normalized = value.replace(/\//g, '\\');
  if (normalized.startsWith('\\\\?\\UNC\\')) {
    normalized = `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`;
  } else if (normalized.startsWith('\\\\?\\')) {
    normalized = normalized.slice('\\\\?\\'.length);
  }

  return path.win32.normalize(normalized);
}

function normalizePosixPath(value: string): string {
  if (!value) {
    return '';
  }

  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function maybeMapWindowsDriveToWsl(hostPath: string): string | null {
  const normalized = normalizeWindowsPath(hostPath);
  const match = normalized.match(/^([A-Za-z]):(?:\\(.*))?$/);
  if (!match) {
    return null;
  }

  const drive = match[1].toLowerCase();
  const tail = (match[2] ?? '').replace(/\\/g, '/');
  return tail ? `/mnt/${drive}/${tail}` : `/mnt/${drive}`;
}

function maybeMapWslUncToLinux(hostPath: string, distroName?: string): string | null {
  const normalized = normalizeWindowsPath(hostPath);
  const match = normalized.match(/^\\\\wsl\$\\([^\\]+)(?:\\(.*))?$/i);
  if (!match) {
    return null;
  }

  const uncDistro = match[1];
  if (distroName && uncDistro.toLowerCase() !== distroName.toLowerCase()) {
    return null;
  }

  const tail = match[2] ? match[2].replace(/\\/g, '/') : '';
  return tail ? `/${tail}` : '/';
}

function maybeMapLinuxToWindowsDrive(targetPath: string): string | null {
  const normalized = normalizePosixPath(targetPath);
  const match = normalized.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) {
    return null;
  }

  const drive = match[1].toUpperCase();
  const tail = match[2] ? match[2].replace(/\//g, '\\') : '';
  return tail ? `${drive}:\\${tail}` : `${drive}:\\`;
}

function maybeMapLinuxToWslUnc(targetPath: string, distroName?: string): string | null {
  if (!distroName) {
    return null;
  }

  const normalized = normalizePosixPath(targetPath);
  if (!normalized.startsWith('/')) {
    return null;
  }

  const tail = normalized === '/' ? '' : normalized.slice(1).replace(/\//g, '\\');
  return tail ? `\\\\wsl$\\${distroName}\\${tail}` : `\\\\wsl$\\${distroName}`;
}

function assembleMapper(
  target: CodexExecutionTarget,
  toTargetPath: (hostPath: string) => string | null,
  toHostPath: (targetPath: string) => string | null,
): CodexPathMapper {
  return {
    target,
    toTargetPath,
    toHostPath,
    mapTargetPathList(hostPaths: string[]): string[] {
      return hostPaths
        .map(toTargetPath)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    },
    canRepresentHostPath(hostPath: string): boolean {
      return toTargetPath(hostPath) !== null;
    },
  };
}

function normalizeForPlatformFamily(
  value: string,
  platformFamily: CodexExecutionTarget['platformFamily'],
): string | null {
  if (!value) {
    return null;
  }

  return platformFamily === 'windows'
    ? normalizeWindowsPath(value)
    : normalizePosixPath(value);
}

function createIdentityMapper(target: CodexExecutionTarget): CodexPathMapper {
  // Identity mapping is symmetric: host and target paths normalize the same way,
  // so both directions share one platform-family normalizer.
  const normalize = (value: string): string | null =>
    normalizeForPlatformFamily(value, target.platformFamily);

  return assembleMapper(target, normalize, normalize);
}

function createWslPathMapper(target: CodexExecutionTarget): CodexPathMapper {
  const toTargetPath = (hostPath: string): string | null => {
    if (!hostPath) {
      return null;
    }

    return maybeMapWslUncToLinux(hostPath, target.distroName)
      ?? maybeMapWindowsDriveToWsl(hostPath);
  };
  const toHostPath = (targetPath: string): string | null => {
    if (!targetPath) {
      return null;
    }

    return maybeMapLinuxToWindowsDrive(targetPath)
      ?? maybeMapLinuxToWslUnc(targetPath, target.distroName);
  };

  return assembleMapper(target, toTargetPath, toHostPath);
}

export function createCodexPathMapper(target: CodexExecutionTarget): CodexPathMapper {
  return target.method === 'wsl'
    ? createWslPathMapper(target)
    : createIdentityMapper(target);
}
