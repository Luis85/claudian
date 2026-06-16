import type { HomeFileAdapter } from '@/core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { PluginContext } from '@/core/types/PluginContext';
import { createCursorWorkspaceServices } from '@/providers/cursor/app/CursorWorkspaceServices';

const AGENT_MD = `---
name: reviewer
description: "Reviews code."
---
Prompt.
`;

function createPlugin(): PluginContext {
  // Cursor is opt-in and disabled by default, so model-catalog warmup (which
  // would spawn the CLI) short-circuits before touching the resolver.
  return {
    settings: {},
    app: {},
    logger: { scope: () => ({ warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }) },
  } as unknown as PluginContext;
}

function createVaultAdapter(files: Record<string, string>): VaultFileAdapter {
  return {
    exists: jest.fn(async (p: string) => Object.keys(files).some((k) => k.startsWith(p))),
    read: jest.fn(async (p: string) => files[p]),
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
    delete: jest.fn(),
    listFiles: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes('/'))),
    ensureFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}

function createHomeAdapter(): HomeFileAdapter {
  return {
    exists: jest.fn(async () => false),
    read: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    listFiles: jest.fn(async () => []),
    ensureFolder: jest.fn(),
  } as unknown as HomeFileAdapter;
}

describe('createCursorWorkspaceServices', () => {
  it('registers a loaded agent mention provider and storage', async () => {
    const files: Record<string, string> = { '.cursor/agents/reviewer.md': AGENT_MD };
    const services = await createCursorWorkspaceServices(createPlugin(), createVaultAdapter(files), createHomeAdapter());

    const results = services.agentMentionProvider.searchAgents('reviewer');
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe('vault');
    expect(services.agentStorage).toBeDefined();
  });

  it('refreshAgentMentions picks up newly added agents', async () => {
    const files: Record<string, string> = {};
    const services = await createCursorWorkspaceServices(createPlugin(), createVaultAdapter(files), createHomeAdapter());
    expect(services.agentMentionProvider.searchAgents('late')).toHaveLength(0);

    files['.cursor/agents/late.md'] = `---\nname: late\ndescription: "Added later."\n---\nP.\n`;
    await services.refreshAgentMentions?.();

    expect(services.agentMentionProvider.searchAgents('late')).toHaveLength(1);
  });
});
