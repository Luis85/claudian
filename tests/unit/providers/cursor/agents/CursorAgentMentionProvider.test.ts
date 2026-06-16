import { CursorAgentMentionProvider } from '@/providers/cursor/agents/CursorAgentMentionProvider';
import type { CursorAgentStorage } from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

function providerWith(agents: CursorAgentDefinition[]): CursorAgentMentionProvider {
  const storage = { loadAll: jest.fn(async () => agents) } as unknown as CursorAgentStorage;
  return new CursorAgentMentionProvider(storage);
}

describe('CursorAgentMentionProvider', () => {
  it('surfaces file agents and builtins with their sources', async () => {
    const provider = providerWith([
      { name: 'reviewer', description: 'Vault reviewer.', prompt: '', source: 'vault' },
      { name: 'helper', description: 'Global helper.', prompt: '', source: 'global' },
    ]);
    await provider.loadAgents();

    const results = provider.searchAgents('');
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get('reviewer')!.source).toBe('vault');
    expect(byName.get('helper')!.source).toBe('global');
    expect(byName.get('Explore')!.source).toBe('builtin');
  });

  it('maps claude-compat agents to the vault source label', async () => {
    const provider = providerWith([
      { name: 'researcher', description: 'Compat. (from .claude/agents)', prompt: '', source: 'claude-compat' },
    ]);
    await provider.loadAgents();

    expect(provider.searchAgents('researcher')[0]!.source).toBe('vault');
  });

  it('filters by name or description substring', async () => {
    const provider = providerWith([
      { name: 'reviewer', description: 'Checks diffs.', prompt: '', source: 'vault' },
    ]);
    await provider.loadAgents();

    expect(provider.searchAgents('diffs')).toHaveLength(1);
    expect(provider.searchAgents('zzz')).toHaveLength(0);
  });
});
