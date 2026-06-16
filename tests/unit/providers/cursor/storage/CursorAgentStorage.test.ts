import {
  createCursorAgentPersistenceKey,
  CursorAgentStorage,
  loadCursorAgentsWithBuiltins,
  parseCursorAgentMarkdown,
  parseCursorAgentPersistenceKey,
  serializeCursorAgentMarkdown,
} from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

const BASIC_MARKDOWN = `---
description: "Reviews code for correctness."
---
Review code like an owner.
`;

const FULL_MARKDOWN = `---
name: reviewer
description: "Reviews code for correctness."
model: "composer-2"
readonly: true
is_background: true
custom_key: "custom-value"
---
Review deeply and call out regressions.
`;

describe('parseCursorAgentMarkdown', () => {
  it('derives the name from the file path when frontmatter omits it', () => {
    const result = parseCursorAgentMarkdown(BASIC_MARKDOWN, '.cursor/agents/review.md', 'vault');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('review');
    expect(result!.description).toBe('Reviews code for correctness.');
    expect(result!.prompt).toBe('Review code like an owner.');
    expect(result!.source).toBe('vault');
    expect(result!.persistenceKey).toBe(
      createCursorAgentPersistenceKey({ source: 'vault', filePath: '.cursor/agents/review.md' }),
    );
  });

  it('parses model, readonly, is_background, and unknown frontmatter', () => {
    const result = parseCursorAgentMarkdown(FULL_MARKDOWN, '.cursor/agents/reviewer.md', 'vault');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('reviewer');
    expect(result!.model).toBe('composer-2');
    expect(result!.readonly).toBe(true);
    expect(result!.isBackground).toBe(true);
    expect(result!.extraFrontmatter).toEqual({ custom_key: 'custom-value' });
  });

  it('returns null when description is missing', () => {
    expect(parseCursorAgentMarkdown('---\nname: x\n---\nbody', '.cursor/agents/x.md', 'vault')).toBeNull();
  });

  it('labels claude-compat agents and notes their origin in the description', () => {
    const result = parseCursorAgentMarkdown(BASIC_MARKDOWN, '.claude/agents/review.md', 'claude-compat');

    expect(result!.source).toBe('claude-compat');
    expect(result!.description).toBe('Reviews code for correctness. (from .claude/agents)');
  });

  it('treats model: inherit as unset', () => {
    const result = parseCursorAgentMarkdown(`---
description: "Inherits the chat model."
model: inherit
---
Prompt.
`, '.cursor/agents/inheriting.md', 'vault');

    expect(result!.model).toBeUndefined();
  });
});

describe('serializeCursorAgentMarkdown', () => {
  it('round-trips a full definition', () => {
    const agent: CursorAgentDefinition = {
      name: 'reviewer',
      description: 'Reviews code for correctness.',
      prompt: 'Review deeply and call out regressions.',
      source: 'vault',
      model: 'composer-2',
      readonly: true,
      isBackground: true,
      extraFrontmatter: { custom_key: 'custom-value' },
    };

    const parsed = parseCursorAgentMarkdown(
      serializeCursorAgentMarkdown(agent),
      '.cursor/agents/reviewer.md',
      'vault',
    );

    expect(parsed).toMatchObject({
      name: 'reviewer',
      model: 'composer-2',
      readonly: true,
      isBackground: true,
      extraFrontmatter: { custom_key: 'custom-value' },
    });
  });

  it('omits optional keys that are unset', () => {
    const serialized = serializeCursorAgentMarkdown({
      name: 'minimal',
      description: 'Minimal agent.',
      prompt: 'Do the thing.',
      source: 'vault',
    });

    expect(serialized).not.toContain('model:');
    expect(serialized).not.toContain('readonly:');
    expect(serialized).not.toContain('is_background:');
  });

  it('keeps a scalar-looking description loadable after a round-trip', () => {
    const serialized = serializeCursorAgentMarkdown({
      name: 'flagger',
      description: 'true',
      prompt: 'Body.',
      source: 'vault',
    });

    // Unquoted `description: true` would parse as a boolean and be dropped.
    const parsed = parseCursorAgentMarkdown(serialized, '.cursor/agents/flagger.md', 'vault');
    expect(parsed).not.toBeNull();
    expect(parsed!.description).toBe('true');
  });

  it('strips the compat-origin suffix only for claude-compat agents', () => {
    const userText = 'Reviews code. (from .claude/agents)';
    // An editable agent that genuinely typed the suffix keeps it verbatim.
    const vault = parseCursorAgentMarkdown(
      serializeCursorAgentMarkdown({ name: 'reviewer', description: userText, prompt: 'p', source: 'vault' }),
      '.cursor/agents/reviewer.md', 'vault',
    );
    expect(vault!.description).toBe(userText);
    // A claude-compat agent's appended suffix is stripped back out on serialize.
    const compat = parseCursorAgentMarkdown(
      serializeCursorAgentMarkdown({ name: 'reviewer', description: userText, prompt: 'p', source: 'claude-compat' }),
      '.cursor/agents/reviewer.md', 'vault',
    );
    expect(compat!.description).toBe('Reviews code.');
  });
});

describe('cursor agent persistence keys', () => {
  it('round-trips source and path', () => {
    const key = createCursorAgentPersistenceKey({ source: 'global', filePath: '.cursor/agents/helper.md' });

    expect(parseCursorAgentPersistenceKey(key)).toEqual({
      source: 'global',
      filePath: '.cursor/agents/helper.md',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseCursorAgentPersistenceKey('not-a-key')).toBeNull();
    expect(parseCursorAgentPersistenceKey('cursor-agent:bogus-source:x.md')).toBeNull();
    expect(parseCursorAgentPersistenceKey(undefined)).toBeNull();
  });
});

const AGENT_MD = (name: string, description: string) => `---
name: ${name}
description: "${description}"
---
Prompt body for ${name}.
`;

function createVaultAdapter(files: Record<string, string> = {}) {
  return {
    exists: jest.fn(async (p: string) => Object.keys(files).some((k) => k === p || k.startsWith(`${p}/`))),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`not found: ${p}`);
      return files[p];
    }),
    write: jest.fn(async (p: string, content: string) => { files[p] = content; }),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
    listFiles: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes('/'))),
    ensureFolder: jest.fn(),
  };
}

function createHomeAdapter(files: Record<string, string> = {}) {
  return {
    exists: jest.fn(async (p: string) => p in files),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`not found: ${p}`);
      return files[p];
    }),
    write: jest.fn(async (p: string, content: string) => { files[p] = content; }),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
    listFiles: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes('/'))),
    ensureFolder: jest.fn(),
  };
}

// Simulates a case-insensitive filesystem (Windows, default macOS): paths that
// differ only by case resolve to the same on-disk entry.
function createCaseInsensitiveVaultAdapter(files: Record<string, string> = {}) {
  const resolveKey = (p: string): string =>
    Object.keys(files).find((k) => k.toLowerCase() === p.toLowerCase()) ?? p;
  return {
    exists: jest.fn(async (p: string) =>
      Object.keys(files).some((k) => {
        const lk = k.toLowerCase();
        const lp = p.toLowerCase();
        return lk === lp || lk.startsWith(`${lp}/`);
      })),
    read: jest.fn(async (p: string) => {
      const key = resolveKey(p);
      if (!(key in files)) throw new Error(`not found: ${p}`);
      return files[key];
    }),
    write: jest.fn(async (p: string, content: string) => { files[resolveKey(p)] = content; }),
    delete: jest.fn(async (p: string) => { delete files[resolveKey(p)]; }),
    listFiles: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => {
        const lk = k.toLowerCase();
        const lf = folder.toLowerCase();
        return lk.startsWith(`${lf}/`) && !lk.slice(lf.length + 1).includes('/');
      })),
    ensureFolder: jest.fn(),
  };
}

describe('CursorAgentStorage', () => {
  it('scans the vault, the claude compat root, and global, with vault winning name conflicts', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/reviewer.md': AGENT_MD('reviewer', 'Vault reviewer.'),
      '.claude/agents/reviewer.md': AGENT_MD('reviewer', 'Claude compat reviewer.'),
      '.claude/agents/researcher.md': AGENT_MD('researcher', 'Claude compat researcher.'),
      // .codex/agents holds Codex's TOML agents, not Cursor markdown — not a compat root.
      '.codex/agents/builder.md': AGENT_MD('builder', 'Codex compat builder.'),
    });
    const home = createHomeAdapter({
      '.cursor/agents/helper.md': AGENT_MD('helper', 'Global helper.'),
    });
    const storage = new CursorAgentStorage(vault, home);

    const agents = await storage.loadAll();
    const byName = new Map(agents.map((a) => [a.name, a]));

    expect(byName.get('reviewer')!.source).toBe('vault');
    expect(byName.get('reviewer')!.description).toBe('Vault reviewer.');
    expect(byName.get('researcher')!.source).toBe('claude-compat');
    expect(byName.get('helper')!.source).toBe('global');
    // .codex/agents is not scanned — Codex agents are TOML, so the root is omitted.
    expect(byName.has('builder')).toBe(false);
  });

  it('does not discover agents nested below the vault root (flat scan only)', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/top.md': AGENT_MD('top', 'Top-level.'),
      '.cursor/agents/team/nested.md': AGENT_MD('nested', 'In a subfolder.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());

    const agents = await storage.loadAll();

    expect(agents.map((a) => a.name)).toEqual(['top']);
  });

  it('skips malformed files instead of failing the scan', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/broken.md': 'no frontmatter here',
      '.cursor/agents/good.md': AGENT_MD('good', 'Works.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());

    const agents = await storage.loadAll();

    expect(agents.map((a) => a.name)).toEqual(['good']);
  });

  it('saves vault agents under .cursor/agents and global agents under the home root', async () => {
    const vault = createVaultAdapter();
    const home = createHomeAdapter();
    const storage = new CursorAgentStorage(vault, home);

    await storage.save({ name: 'v', description: 'Vault.', prompt: 'p', source: 'vault' });
    await storage.save({ name: 'g', description: 'Global.', prompt: 'p', source: 'global' });

    // Content round-trip correctness is covered by the Task 4 serialize tests;
    // the routing (which adapter, which path) is the contract under test here.
    expect(vault.write).toHaveBeenCalledWith('.cursor/agents/v.md', expect.any(String));
    expect(home.write).toHaveBeenCalledWith('.cursor/agents/g.md', expect.any(String));
  });

  it('deletes the previous file on rename', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/old.md': AGENT_MD('old', 'Old.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    await storage.save({ ...previous, name: 'renamed' }, previous);

    expect(vault.write).toHaveBeenCalledWith('.cursor/agents/renamed.md', expect.any(String));
    expect(vault.delete).toHaveBeenCalledWith('.cursor/agents/old.md');
  });

  it('preserves the agent on a case-only rename on a case-insensitive filesystem', async () => {
    const files = { '.cursor/agents/Foo.md': AGENT_MD('Foo', 'Reviews.') };
    const vault = createCaseInsensitiveVaultAdapter(files);
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    await storage.save({ ...previous, name: 'foo' }, previous);

    // Foo.md and foo.md alias the same file here, so a naive write-then-delete
    // would wipe the agent. It must still load after the rename.
    const after = await storage.loadAll();
    expect(after.map((a) => a.name)).toEqual(['foo']);
  });

  it('leaves no stale file on a case-only rename on a case-sensitive filesystem', async () => {
    const files = { '.cursor/agents/Foo.md': AGENT_MD('Foo', 'Reviews.') };
    const vault = createVaultAdapter(files);
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    await storage.save({ ...previous, name: 'foo' }, previous);

    expect(Object.keys(files)).toEqual(['.cursor/agents/foo.md']);
  });

  it('flags a source move onto a hidden same-name agent', async () => {
    // A vault and global agent share a name; loadAll() hides the global one.
    const vault = createVaultAdapter({ '.cursor/agents/shared.md': AGENT_MD('shared', 'Vault shared.') });
    const home = createHomeAdapter({ '.cursor/agents/shared.md': AGENT_MD('shared', 'Global shared.') });
    const storage = new CursorAgentStorage(vault, home);
    const visible = (await storage.loadAll()).find((a) => a.source === 'vault')!;

    const movedToGlobal = { ...visible, source: 'global' as const, persistenceKey: undefined };
    expect(await storage.wouldOverwriteDifferentAgent(movedToGlobal, visible)).toBe(true);
  });

  it('allows a source move when the destination is free', async () => {
    const vault = createVaultAdapter({ '.cursor/agents/solo.md': AGENT_MD('solo', 'Vault solo.') });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    const movedToGlobal = { ...previous, source: 'global' as const, persistenceKey: undefined };
    expect(await storage.wouldOverwriteDifferentAgent(movedToGlobal, previous)).toBe(false);
  });

  it('does not flag an in-place edit or case-only rename of the same file', async () => {
    const vault = createCaseInsensitiveVaultAdapter({ '.cursor/agents/Foo.md': AGENT_MD('Foo', 'Reviews.') });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    expect(await storage.wouldOverwriteDifferentAgent(previous, previous)).toBe(false);
    expect(await storage.wouldOverwriteDifferentAgent({ ...previous, name: 'foo' }, previous)).toBe(false);
  });

  it('refuses to save or delete read-only sources', async () => {
    const storage = new CursorAgentStorage(createVaultAdapter(), createHomeAdapter());
    const compat = { name: 'c', description: 'C.', prompt: '', source: 'claude-compat' as const };
    const builtin = { name: 'Explore', description: 'B.', prompt: '', source: 'builtin' as const };

    await expect(storage.save(compat)).rejects.toThrow(/read-only/);
    await expect(storage.delete(builtin)).rejects.toThrow(/read-only/);
  });
});

describe('loadCursorAgentsWithBuiltins', () => {
  it('appends builtins that are not shadowed by file agents', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/explore.md': AGENT_MD('Explore', 'Custom explore override.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());

    const agents = await loadCursorAgentsWithBuiltins(storage);
    const names = agents.map((a) => `${a.name}:${a.source}`);

    expect(names).toContain('Explore:vault');
    expect(names).not.toContain('Explore:builtin');
    expect(names).toContain('Bash:builtin');
    expect(names).toContain('Browser:builtin');
  });
});
