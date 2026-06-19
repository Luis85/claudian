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
