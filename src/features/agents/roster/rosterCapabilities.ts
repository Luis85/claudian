import type { RosterAgent } from './rosterTypes';

export const CLAUDIAN_TOOL_MCP_PREFIX = 'mcp__claudian__';

export function toolCapabilityId(toolName: string): string {
  return `${CLAUDIAN_TOOL_MCP_PREFIX}${toolName}`;
}

export function slugifyRosterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function rosterIdFromSlug(slug: string): string {
  return `roster:${slug}`;
}

/**
 * Returns `baseId` if free, otherwise the first `baseId-<n>` (n>=2) not in
 * `existingIds`. Prevents two same-named new agents from overwriting one file.
 */
export function dedupeRosterId(baseId: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}-${n}`)) n += 1;
  return `${baseId}-${n}`;
}

export function createRosterAgent(name: string, now: number): RosterAgent {
  const slug = slugifyRosterName(name) || 'agent';
  return {
    id: rosterIdFromSlug(slug),
    name,
    description: '',
    prompt: '',
    tools: [],
    disallowedTools: [],
    skills: [],
    roles: ['worker'],
    createdAt: now,
    updatedAt: now,
  };
}
