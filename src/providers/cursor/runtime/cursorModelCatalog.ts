import { spawn } from 'child_process';

import { resolveCursorSpawnSpec } from './cursorWindowsSpawn';

// Minimal, safe set used before any live discovery completes. Never empty so
// the picker always has something selectable. composer-1 is a real model (not
// an alias for auto), so it stays in the list.
export const STATIC_FALLBACK_MODEL_IDS: readonly string[] = [
  'auto',
  'composer-2',
  'composer-2-fast',
  'composer-1.5',
  'composer-1',
];

interface CursorModelCatalogCache {
  ids: string[];
  fetchedAt: number;
}

let catalogCache: CursorModelCatalogCache | null = null;

const LIST_MODELS_TIMEOUT_MS = 10_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][\w.:/-]*$/;
const TEXT_HEADER_PATTERN = /available models|models?:?$/i;

function extractIdFromObject(entry: Record<string, unknown>): string | null {
  for (const key of ['id', 'name', 'model']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parseJsonModelList(stdout: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { models?: unknown })?.models)
      ? (parsed as { models: unknown[] }).models
      : null;
  if (!source) {
    return null;
  }

  const ids: string[] = [];
  for (const entry of source) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) {
        ids.push(trimmed);
      }
    } else if (entry && typeof entry === 'object') {
      const id = extractIdFromObject(entry as Record<string, unknown>);
      if (id) {
        ids.push(id);
      }
    }
  }

  return ids;
}

function parseTextModelList(stdout: string): string[] {
  const ids: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }

    // Strip common bullet markers.
    line = line.replace(/^[*\-•]\s*/, '').trim();
    // Strip trailing markers like "(current)" / "(default)".
    line = line.replace(/\s*\((?:current|default)\)\s*$/i, '').trim();

    if (!line || TEXT_HEADER_PATTERN.test(line)) {
      continue;
    }

    // Lines may carry a description after the id; keep only the first token.
    const token = line.split(/\s+/)[0];
    if (token && MODEL_ID_PATTERN.test(token)) {
      ids.push(token);
    }
  }
  return ids;
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Parses `cursor-agent --list-models` output. Tries JSON first (array of
 * strings, or array/object-wrapped objects carrying id/name/model), then falls
 * back to plain-text/bulleted parsing. Exported for unit testing.
 */
export function parseModelListOutput(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const jsonIds = parseJsonModelList(trimmed);
  const ids = jsonIds ?? parseTextModelList(trimmed);
  return dedupe(ids);
}

function runListModels(
  cliPath: string,
  env: Record<string, string>,
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const spawnSpec = resolveCursorSpawnSpec(cliPath, ['--list-models']);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd,
      env,
      windowsHide: true,
      ...(spawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });

    let stdout = '';
    let settled = false;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('Timed out listing Cursor models'));
      }
    }, LIST_MODELS_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        reject(err);
      }
    });

    child.on('close', () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(stdout);
      }
    });
  });
}

/**
 * Spawns the Cursor CLI to discover available models and refreshes the module
 * cache. On any error or empty result the existing good cache (or the static
 * fallback) is preserved and returned — discovery never destroys known ids.
 */
export async function refreshCursorModelCatalog(
  cliPath: string,
  env: Record<string, string>,
  cwd: string = process.cwd(),
): Promise<string[]> {
  if (!cliPath?.trim()) {
    return getCachedCursorModelIds();
  }

  try {
    const stdout = await runListModels(cliPath, env, cwd);
    const ids = parseModelListOutput(stdout);
    if (ids.length === 0) {
      return getCachedCursorModelIds();
    }
    catalogCache = { ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    return getCachedCursorModelIds();
  }
}

/** Returns cached discovered ids if present, else the static fallback. */
export function getCachedCursorModelIds(): string[] {
  if (catalogCache && catalogCache.ids.length > 0) {
    return [...catalogCache.ids];
  }
  return [...STATIC_FALLBACK_MODEL_IDS];
}

/** Clears the module cache. Test-only. */
export function resetCursorModelCatalog(): void {
  catalogCache = null;
}
