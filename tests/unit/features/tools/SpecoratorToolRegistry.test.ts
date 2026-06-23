// tests/unit/features/tools/SpecoratorToolRegistry.test.ts
import { z } from 'zod';

import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { SpecoratorToolRegistry, TOOLS_DIR } from '@/features/tools/SpecoratorToolRegistry';

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

describe('SpecoratorToolRegistry', () => {
  it('loads, validates, and exposes a tool with a json schema', async () => {
    const files = { [`${TOOLS_DIR}/echo/tool.ts`]: TOOL_SRC };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/echo`] };
    const registry = new SpecoratorToolRegistry(makeAdapter(files, folders), {
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
    const registry = new SpecoratorToolRegistry(makeAdapter(files, folders), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });

    await registry.load();

    expect(registry.list()[0].error).toMatch(/manifest/i);
  });

  it('rejects a manifest name with an unsafe character', async () => {
    const src = TOOL_SRC.replace("name: 'echo'", "name: 'echo.bad name'");
    const files = { [`${TOOLS_DIR}/echo/tool.ts`]: src };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/echo`] };
    const registry = new SpecoratorToolRegistry(makeAdapter(files, folders), {
      transpile: (s) => s,
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    await registry.load();

    expect(registry.list()[0].error).toMatch(/manifest\.name must match/);
  });

  it('flags the second tool that claims an already-used name', async () => {
    const files = {
      [`${TOOLS_DIR}/a/tool.ts`]: TOOL_SRC,
      [`${TOOLS_DIR}/b/tool.ts`]: TOOL_SRC, // same manifest.name 'echo'
    };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/a`, `${TOOLS_DIR}/b`] };
    const registry = new SpecoratorToolRegistry(makeAdapter(files, folders), {
      transpile: (s) => s,
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    await registry.load();
    const tools = registry.list();

    const a = tools.find((t) => t.id === 'a');
    const b = tools.find((t) => t.id === 'b');
    expect(a?.error).toBeUndefined();
    expect(b?.error).toMatch(/already used by 'a'/);
  });

  it('serializes overlapping loads so the final list is complete (no false dup)', async () => {
    // Two tools with the SAME manifest.name: a single load flags the second as a
    // dup. But if two loads interleave and the live map is cleared mid-flight,
    // the dup tracking gets confused and `a` (the legit one) can vanish or be
    // mis-flagged. Async reads force the two loads to genuinely overlap.
    const files: Record<string, string> = {
      [`${TOOLS_DIR}/a/tool.ts`]: TOOL_SRC,
      [`${TOOLS_DIR}/b/tool.ts`]: TOOL_SRC, // same manifest.name 'echo'
    };
    const folders: Record<string, string[]> = { [TOOLS_DIR]: [`${TOOLS_DIR}/a`, `${TOOLS_DIR}/b`] };
    const adapter = {
      exists: jest.fn(async (p: string) => p in files || p in folders),
      listFolders: jest.fn(async (dir: string) => folders[dir] ?? []),
      // Defer each read a macrotask so the two loads' bodies interleave.
      read: jest.fn(
        (p: string) => new Promise<string>((resolve) => setTimeout(() => resolve(files[p]), 0)),
      ),
    } as unknown as VaultFileAdapter;
    const registry = new SpecoratorToolRegistry(adapter, {
      transpile: (s) => s,
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    // Fire two loads without awaiting the first — mimics the modify watcher.
    const first = registry.load();
    const second = registry.load();
    await Promise.all([first, second]);

    const tools = registry.list();
    expect(tools.map((t) => t.id)).toEqual(['a', 'b']);
    // `a` keeps the name; only `b` is flagged the dup — exactly the single-load
    // result, regardless of overlap.
    expect(tools.find((t) => t.id === 'a')?.error).toBeUndefined();
    expect(tools.find((t) => t.id === 'b')?.error).toMatch(/already used by 'a'/);
  });

  it('keeps the previous complete set visible during an in-flight reload', async () => {
    const files: Record<string, string> = { [`${TOOLS_DIR}/echo/tool.ts`]: TOOL_SRC };
    const folders: Record<string, string[]> = { [TOOLS_DIR]: [`${TOOLS_DIR}/echo`] };
    // A read gate lets us hold the second load mid-flight and observe list().
    let releaseRead: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let gateArmed = false;
    const adapter = {
      exists: jest.fn(async (p: string) => p in files || p in folders),
      listFolders: jest.fn(async (dir: string) => folders[dir] ?? []),
      read: jest.fn(async (p: string) => {
        if (gateArmed) await gate;
        return files[p];
      }),
    } as unknown as VaultFileAdapter;
    const registry = new SpecoratorToolRegistry(adapter, {
      transpile: (s) => s,
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    await registry.load();
    expect(registry.list()).toHaveLength(1);

    // Second load is held inside read(); the swap hasn't happened yet, so the
    // previous complete set must still be visible (not an empty/cleared map).
    gateArmed = true;
    const reload = registry.load();
    await Promise.resolve();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].id).toBe('echo');

    releaseRead?.();
    await reload;
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].id).toBe('echo');
  });

  it('returns empty when the tools dir is absent', async () => {
    const registry = new SpecoratorToolRegistry(makeAdapter({}, {}), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });
});
