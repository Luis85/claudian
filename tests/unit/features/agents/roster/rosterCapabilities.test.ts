import {
  CLAUDIAN_TOOL_MCP_PREFIX,
  createRosterAgent,
  rosterIdFromSlug,
  slugifyRosterName,
  toolCapabilityId,
} from '@/features/agents/roster/rosterCapabilities';

describe('rosterCapabilities', () => {
  it('builds the mcp capability id for a user tool', () => {
    expect(toolCapabilityId('search_tasks')).toBe('mcp__claudian__search_tasks');
    expect(CLAUDIAN_TOOL_MCP_PREFIX).toBe('mcp__claudian__');
  });

  it('slugifies a name and forms a roster id', () => {
    expect(slugifyRosterName('My Cool Agent!')).toBe('my-cool-agent');
    expect(rosterIdFromSlug('my-cool-agent')).toBe('roster:my-cool-agent');
  });

  it('creates a default agent with required fields', () => {
    const a = createRosterAgent('Reviewer', 1000);
    expect(a.id).toBe('roster:reviewer');
    expect(a.name).toBe('Reviewer');
    expect(a.roles).toEqual(['worker']);
    expect(a.tools).toEqual([]);
    expect(a.skills).toEqual([]);
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
  });
});
