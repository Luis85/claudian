import {
  createRosterAgent,
  dedupeRosterId,
  rosterIdFromSlug,
  slugifyRosterName,
  SPECORATOR_TOOL_MCP_PREFIX,
  toolCapabilityId,
} from '@/features/agents/roster/rosterCapabilities';

describe('rosterCapabilities', () => {
  it('builds the mcp capability id for a user tool', () => {
    expect(toolCapabilityId('search_tasks')).toBe('mcp__specorator__search_tasks');
    expect(SPECORATOR_TOOL_MCP_PREFIX).toBe('mcp__specorator__');
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

  it('dedupes a roster id against existing ids', () => {
    expect(dedupeRosterId('roster:new-agent', [])).toBe('roster:new-agent');
    expect(dedupeRosterId('roster:new-agent', ['roster:new-agent'])).toBe('roster:new-agent-2');
    expect(
      dedupeRosterId('roster:new-agent', ['roster:new-agent', 'roster:new-agent-2']),
    ).toBe('roster:new-agent-3');
  });
});
