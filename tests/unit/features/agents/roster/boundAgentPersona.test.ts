import {
  formatBoundAgentPersona,
  selectAgentSkills,
} from '@/features/agents/roster/boundAgentPersona';

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

  describe('skills block', () => {
    it('appends a skills block listing each granted skill', () => {
      const text = formatBoundAgentPersona({
        name: 'Researcher',
        prompt: 'Cite sources.',
        skills: [
          { name: 'tdd', description: 'Red-green-refactor loop' },
          { name: 'brainstorming' },
        ],
      });
      expect(text).toContain('You have these skills available — use them when relevant:');
      expect(text).toContain('- tdd: Red-green-refactor loop');
      expect(text).toContain('- brainstorming');
      // Skills come after the prompt block.
      expect(text.indexOf('Cite sources')).toBeLessThan(text.indexOf('these skills available'));
    });

    it('omits the skills block when skills is undefined', () => {
      const text = formatBoundAgentPersona({ name: 'Planner', prompt: 'Plan.' });
      expect(text).not.toContain('these skills available');
    });

    it('omits the skills block when skills is empty', () => {
      const text = formatBoundAgentPersona({ name: 'Planner', prompt: 'Plan.', skills: [] });
      expect(text).not.toContain('these skills available');
    });
  });
});

describe('selectAgentSkills', () => {
  const catalog = [
    { name: 'tdd', description: 'Red-green-refactor loop' },
    { name: 'brainstorming', description: 'Explore intent before building' },
  ];

  it('returns the description for matched names', () => {
    expect(selectAgentSkills(['tdd'], catalog)).toEqual([
      { name: 'tdd', description: 'Red-green-refactor loop' },
    ]);
  });

  it('returns name-only for unmatched names', () => {
    expect(selectAgentSkills(['unknown'], catalog)).toEqual([{ name: 'unknown' }]);
  });

  it('preserves grant order', () => {
    expect(selectAgentSkills(['brainstorming', 'tdd'], catalog)).toEqual([
      { name: 'brainstorming', description: 'Explore intent before building' },
      { name: 'tdd', description: 'Red-green-refactor loop' },
    ]);
  });

  it('returns an empty array when nothing is granted', () => {
    expect(selectAgentSkills([], catalog)).toEqual([]);
  });
});
