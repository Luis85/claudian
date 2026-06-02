import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { SDKNativeMessage, SDKSessionReadResult } from './sdkHistoryTypes';

// Long history files can contain thousands of JSONL lines. Parsing them in a
// single tight loop blocks the renderer (PERF-4: "Loading a long chat from
// history makes the UI unresponsive"). Yielding via a macrotask every N parsed
// lines gives Obsidian and the renderer a chance to run between batches.
// `setTimeout(0)` is intentional — microtask yields (queueMicrotask) do not
// release the event loop.
const YIELD_EVERY_PARSED_LINES = 100;

/**
 * Encodes a vault path for the SDK project directory name.
 * The SDK replaces ALL non-alphanumeric characters with `-`.
 * This handles Unicode characters and special chars.
 */
export function encodeVaultPathForSDK(vaultPath: string): string {
  const absolutePath = path.resolve(vaultPath);
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function getSDKProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Validates an identifier for safe use in filesystem paths (no traversal, bounded length). */
export function isPathSafeId(value: string): boolean {
  if (!value || value.length === 0 || value.length > 128) {
    return false;
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

export function isValidSessionId(sessionId: string): boolean {
  return isPathSafeId(sessionId);
}

export function getSDKSessionPath(vaultPath: string, sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }

  const projectsPath = getSDKProjectsPath();
  const encodedVault = encodeVaultPathForSDK(vaultPath);
  return path.join(projectsPath, encodedVault, `${sessionId}.jsonl`);
}

export function sdkSessionExists(vaultPath: string, sessionId: string): boolean {
  try {
    const sessionPath = getSDKSessionPath(vaultPath, sessionId);
    return existsSync(sessionPath);
  } catch {
    return false;
  }
}

export async function deleteSDKSession(vaultPath: string, sessionId: string): Promise<void> {
  try {
    const sessionPath = getSDKSessionPath(vaultPath, sessionId);
    if (!existsSync(sessionPath)) {
      return;
    }

    await fs.unlink(sessionPath);
  } catch {
    // Best-effort deletion
  }
}

export async function readSDKSession(
  vaultPath: string,
  sessionId: string,
): Promise<SDKSessionReadResult> {
  try {
    const sessionPath = getSDKSessionPath(vaultPath, sessionId);
    if (!existsSync(sessionPath)) {
      return { messages: [], skippedLines: 0 };
    }

    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const messages: SDKNativeMessage[] = [];
    let skippedLines = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const msg = JSON.parse(lines[i]) as SDKNativeMessage;
        messages.push(msg);
      } catch {
        skippedLines++;
      }
      if ((i + 1) % YIELD_EVERY_PARSED_LINES === 0 && i + 1 < lines.length) {
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }

    return { messages, skippedLines };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { messages: [], skippedLines: 0, error: errorMsg };
  }
}
