/**
 * Specorator - OS path classification for drag-and-drop into chat context.
 *
 * Pure function. Given an absolute OS path plus the vault root and configured
 * external roots, decide whether the path belongs to the vault, to an external
 * context root, or to neither.
 */

import { normalizePathForComparison } from '@/utils/externalContext';

export type OsPathClassification =
  | { kind: 'vault-file'; relPath: string }
  | { kind: 'vault-folder'; relPath: string }
  | { kind: 'external-file'; contextRoot: string }
  | { kind: 'external-folder'; contextRoot: string }
  | { kind: 'rejected' };

export interface OsPathInfo {
  isDirectory: boolean;
}

export function classifyOsPath(
  absolutePath: string,
  vaultPath: string,
  externalRoots: string[],
  info: OsPathInfo
): OsPathClassification {
  const normalizedAbs = normalizePathForComparison(absolutePath);
  const normalizedVault = normalizePathForComparison(vaultPath);

  if (isUnder(normalizedAbs, normalizedVault)) {
    const relPath = stripPrefix(normalizedAbs, normalizedVault);
    return info.isDirectory
      ? { kind: 'vault-folder', relPath }
      : { kind: 'vault-file', relPath };
  }

  for (const root of externalRoots) {
    const normalizedRoot = normalizePathForComparison(root);
    if (isUnder(normalizedAbs, normalizedRoot)) {
      return info.isDirectory
        ? { kind: 'external-folder', contextRoot: root }
        : { kind: 'external-file', contextRoot: root };
    }
  }

  return { kind: 'rejected' };
}

function isUnder(normalizedChild: string, normalizedRoot: string): boolean {
  if (!normalizedRoot) return false;
  if (normalizedChild === normalizedRoot) return true;
  return normalizedChild.startsWith(normalizedRoot + '/');
}

function stripPrefix(normalizedChild: string, normalizedRoot: string): string {
  if (normalizedChild === normalizedRoot) return '';
  return normalizedChild.slice(normalizedRoot.length + 1);
}
