import { CursorAgentMentionProvider } from '@/providers/cursor/agents/CursorAgentMentionProvider';
import type { CursorAgentStorage } from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

function providerWith(agents: CursorAgentDefinition[]): CursorAgentMentionProvider {
  const storage = { loadAll: jest.fn(async () => agents) } as unknown as CursorAgentStorage;
  return new CursorAgentMentionProvider(storage);
}

describe('CursorAgentMentionProvider', () => {
  it('surfaces file agents but excludes automatic built-ins', async () => {
    const provider = providerWith([
      { name: 'reviewer', description: 'Vault reviewer.', prompt: '', source: 'vault' },
      { name: 'helper', description: 'Global helper.', prompt: '', source: 'global' },
    ]);
    await provider.loadAgents();

    const results = provider.searchAgents('');
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get('reviewer')!.source).toBe('vault');
    expect(byName.get('helper')!.source).toBe('global');
    // Built-ins (Explore/Bash/Browser) are automatic — not manually @-mentionable.
    expect(byName.has('Explore')).toBe(false);
  });

  it('excludes compat agents from @mentions (Cursor cannot delegate to them by name)', async () => {
    const provider = providerWith([
      { name: 'researcher', description: 'Compat. (from .claude/agents)', prompt: '', source: 'claude-compat' },
      { name: 'builder', description: 'Compat. (from .codex/agents)', prompt: '', source: 'codex-compat' },
      { name: 'reviewer', description: 'Vault.', prompt: '', source: 'vault' },
    ]);
    await provider.loadAgents();

    // Only the vault agent — Cursor loads .cursor/agents, not the compat roots.
    expect(provider.searchAgents('').map((r) => r.name)).toEqual(['reviewer']);
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
