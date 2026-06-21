import { formatBoundAgentPersona } from '@/features/agents/roster/boundAgentPersona';

describe('formatBoundAgentPersona', () => {
  it('leads with a forceful identity directive naming the agent', () => {
    const text = formatBoundAgentPersona({
      name: 'Researcher',
      description: 'a read-only investigator',
      prompt: 'Cite sources for every claim.',
    });
    expect(text.startsWith('You are Researcher — a read-only investigator.')).toBe(true);
    expect(text).toContain('answer as Researcher');
    expect(text).toContain('Cite sources for every claim.');
    // Instructions come after the identity block.
    expect(text.indexOf('You are Researcher')).toBeLessThan(text.indexOf('Cite sources'));
  });

  it('omits the description dash when there is no description', () => {
    const text = formatBoundAgentPersona({ name: 'Debugger', prompt: 'Find the root cause.' });
    expect(text.startsWith('You are Debugger.')).toBe(true);
    expect(text).not.toContain('—');
  });

  it('still gives an identity when the agent has no instructions', () => {
    const text = formatBoundAgentPersona({ name: 'Planner' });
    expect(text.startsWith('You are Planner.')).toBe(true);
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(formatBoundAgentPersona({ name: '   ', prompt: '  ' })).toBe('');
  });
});
