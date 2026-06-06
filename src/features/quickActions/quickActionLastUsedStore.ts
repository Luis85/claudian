import type { ProviderId } from '@/core/providers/types';

export const PERSISTED_SCHEMA_VERSION = 1;

export interface LastUsedEntry {
  providerId: ProviderId;
  model: string;
  updatedAt: number;
}

interface PersistedShape {
  schemaVersion: number;
  writtenAt: number;
  entries: Record<string, LastUsedEntry>;
}

export function serializePersistedLastUsed(
  entries: Map<string, LastUsedEntry>,
  writtenAt: number,
): string {
  const out: PersistedShape = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    writtenAt,
    entries: {},
  };
  for (const [stem, entry] of entries) {
    out.entries[stem] = { ...entry };
  }
  return JSON.stringify(out);
}

export function parsePersistedLastUsed(raw: string): Map<string, LastUsedEntry> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const shape = parsed as Partial<PersistedShape>;
  if (shape.schemaVersion !== PERSISTED_SCHEMA_VERSION) return null;
  if (!shape.entries || typeof shape.entries !== 'object') return null;

  const out = new Map<string, LastUsedEntry>();
  for (const [stem, value] of Object.entries(shape.entries)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<LastUsedEntry>;
    if (typeof entry.providerId !== 'string') continue;
    if (typeof entry.model !== 'string') continue;
    if (typeof entry.updatedAt !== 'number') continue;
    out.set(stem, {
      providerId: entry.providerId as ProviderId,
      model: entry.model,
      updatedAt: entry.updatedAt,
    });
  }
  return out;
}
