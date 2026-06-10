import * as fs from 'fs/promises';
import * as path from 'path';

import type { AcpReadTextFileRequest } from './types';

/**
 * Resolves a client-supplied path against the session cwd and rejects anything
 * that escapes the workspace. Shared by ACP fileSystem delegates (chat runtime
 * and aux query runner) so the sandbox check cannot drift between them.
 */
export function resolveWorkspaceScopedPath(
  cwd: string,
  rawPath: string,
  accessErrorMessage: string,
): string {
  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(cwd, rawPath);
  const relative = path.relative(cwd, resolvedPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedPath;
  }

  throw new Error(accessErrorMessage);
}

/** Implements the ACP `fs/read_text_file` line/limit window over a resolved path. */
export async function readWorkspaceTextFile(
  resolvedPath: string,
  request: Pick<AcpReadTextFileRequest, 'line' | 'limit'>,
): Promise<{ content: string }> {
  const content = await fs.readFile(resolvedPath, 'utf-8');

  if (request.line === undefined && request.limit === undefined) {
    return { content };
  }

  const lines = content.split(/\r?\n/);
  const startIndex = Math.max(0, (request.line ?? 1) - 1);
  const endIndex = request.limit
    ? startIndex + Math.max(0, request.limit)
    : lines.length;

  return {
    content: lines.slice(startIndex, endIndex).join('\n'),
  };
}
