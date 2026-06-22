import { toolCapabilityId } from '../agents/roster/rosterCapabilities';
import type { LoadedTool } from './toolTypes';

/**
 * From a raw tool-registry listing, returns the error-free, module-bearing tools
 * scoped to a bound agent's grant. An empty or absent grant exposes every
 * error-free tool; a non-empty grant keeps only tools whose capability id is
 * granted.
 */
export function getScopedTools(loaded: LoadedTool[], grantedToolIds?: string[]): LoadedTool[] {
  const usable = loaded.filter((t) => t.module && !t.error);
  if (!grantedToolIds || grantedToolIds.length === 0) return usable;
  const granted = new Set(grantedToolIds);
  return usable.filter((t) => t.module && granted.has(toolCapabilityId(t.module.manifest.name)));
}

/**
 * A stable, order-independent fingerprint of the scoped tool set: the sorted,
 * comma-joined manifest names. Folded into the persistent-query MCP key so a
 * tool-grant edit or a registry add/remove/error forces the server to re-apply.
 */
export function scopedToolKey(loaded: LoadedTool[], grantedToolIds?: string[]): string {
  return getScopedTools(loaded, grantedToolIds)
    .map((t) => t.module!.manifest.name)
    .sort()
    .join(',');
}
