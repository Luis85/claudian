// Provider registrations are imported for their side effect so
// ProviderRegistry.projectRosterAgent resolves each provider's serializer.
import '@/providers';

import { projectRosterAgentsToProviders } from '@/app/rosterAgentProjection';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { createRosterAgent } from '@/features/agents/roster/rosterCapabilities';

function makeAdapter(files: Record<string, string>) {
  return {
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
  } as unknown as VaultFileAdapter;
}

describe('roster agent projection', () => {
  it('writes each provider its own native file path + format', () => {
    const agent = { ...createRosterAgent('Code Reviewer', 1), prompt: 'Review deeply.' };

    expect(ProviderRegistry.projectRosterAgent('claude', agent, 'code-reviewer')?.path)
      .toBe('.claude/agents/code-reviewer.md');
    expect(ProviderRegistry.projectRosterAgent('codex', agent, 'code-reviewer')?.path)
      .toBe('.codex/agents/code-reviewer.toml');
    expect(ProviderRegistry.projectRosterAgent('cursor', agent, 'code-reviewer')?.path)
      .toBe('.cursor/agents/code-reviewer.md');
    expect(ProviderRegistry.projectRosterAgent('opencode', agent, 'code-reviewer')?.path)
      .toBe('.opencode/agent/code-reviewer.md');

    // Codex uses TOML developer_instructions; Opencode marks it a subagent.
    expect(ProviderRegistry.projectRosterAgent('codex', agent, 'code-reviewer')?.content)
      .toContain('developer_instructions');
    expect(ProviderRegistry.projectRosterAgent('opencode', agent, 'code-reviewer')?.content)
      .toContain('mode: subagent');
  });

  it('projects all agents into all given providers and reports counts', async () => {
    const files: Record<string, string> = {};
    const adapter = makeAdapter(files);
    const agents = [
      { ...createRosterAgent('Researcher', 1), prompt: 'Investigate.' },
      { ...createRosterAgent('Debugger', 2), prompt: 'Find the cause.' },
    ];

    const result = await projectRosterAgentsToProviders(agents, ['cursor', 'claude'], adapter);

    expect(result.written).toBe(4); // 2 agents × 2 providers
    expect(result.providers).toEqual(['cursor', 'claude']);
    expect(files['.cursor/agents/researcher.md']).toContain('Investigate.');
    expect(files['.claude/agents/debugger.md']).toContain('Find the cause.');
  });
});
