// tests/unit/features/tools/ClaudianToolRegistry.test.ts
import { z } from 'zod';
import { ClaudianToolRegistry, TOOLS_DIR } from '@/features/tools/ClaudianToolRegistry';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const TOOL_SRC = `
module.exports.default = {
  manifest: {
    name: 'echo',
    description: 'echoes input',
    input: Z.object({ text: Z.string() }),
  },
  handler: async (args) => ({ content: [{ type: 'text', text: args.text }] }),
};
`;

function makeAdapter(files: Record<string, string>, folders: Record<string, string[]>) {
  return {
    exists: jest.fn(async (p: string) => p in files || p in folders),
    listFolders: jest.fn(async (dir: string) => folders[dir] ?? []),
    read: jest.fn(async (p: string) => files[p]),
  } as unknown as VaultFileAdapter;
}

describe('ClaudianToolRegistry', () => {
  it('loads, validates, and exposes a tool with a json schema', async () => {
    const files = { [`${TOOLS_DIR}/echo/tool.ts`]: TOOL_SRC };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/echo`] };
    const registry = new ClaudianToolRegistry(makeAdapter(files, folders), {
      transpile: (src) => src, // already CJS in the fixture
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    await registry.load();
    const tools = registry.list();

    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('echo');
    expect(tools[0].error).toBeUndefined();
    expect(tools[0].module?.manifest.name).toBe('echo');
    expect(tools[0].jsonSchema).toHaveProperty('type', 'object');
  });

  it('records an error for a tool whose default export lacks a manifest', async () => {
    const files = { [`${TOOLS_DIR}/broken/tool.ts`]: 'module.exports.default = {};' };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/broken`] };
    const registry = new ClaudianToolRegistry(makeAdapter(files, folders), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });

    await registry.load();

    expect(registry.list()[0].error).toMatch(/manifest/i);
  });

  it('returns empty when the tools dir is absent', async () => {
    const registry = new ClaudianToolRegistry(makeAdapter({}, {}), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });
});
