import type { App, Vault } from 'obsidian';

import { installPresetTemplates } from '../../../../../src/features/tasks/templates/installPresetTemplates';
import { PRESET_TEMPLATES } from '../../../../../src/features/tasks/templates/presetTemplates';

interface FakePluginParts {
  vault: Vault;
  app: App;
  templateFolder: string;
  created: Array<{ path: string; content: string }>;
  folders: string[];
  existingPaths: Set<string>;
}

function makeFakePlugin(existingPaths: string[] = []): FakePluginParts & { plugin: unknown } {
  const existing = new Set(existingPaths);
  const created: Array<{ path: string; content: string }> = [];
  const folders: string[] = [];

  const vault = {
    getAbstractFileByPath: jest.fn((path: string) => (existing.has(path) ? { path } : null)),
    createFolder: jest.fn(async (path: string) => { folders.push(path); existing.add(path); }),
    create: jest.fn(async (path: string, content: string) => {
      created.push({ path, content });
      existing.add(path);
      return { path };
    }),
  } as unknown as Vault;

  const app = { vault } as unknown as App;
  const templateFolder = 'Agent Board/templates';
  const plugin = {
    app,
    settings: { agentBoardTemplateFolder: templateFolder },
  };

  return { plugin, vault, app, templateFolder, created, folders, existingPaths: existing };
}

describe('installPresetTemplates', () => {
  it('creates every preset when the folder is empty', async () => {
    const parts = makeFakePlugin();
    const result = await installPresetTemplates(parts.plugin as Parameters<typeof installPresetTemplates>[0]);

    expect(result.installed).toBe(PRESET_TEMPLATES.length);
    expect(result.skipped).toBe(0);
    expect(parts.created).toHaveLength(PRESET_TEMPLATES.length);
    expect(parts.folders).toEqual(['Agent Board/templates']);
    for (const { path, content } of parts.created) {
      expect(path.startsWith('Agent Board/templates/')).toBe(true);
      expect(content).toContain('type: specorator-work-order-template');
    }
  });

  it('skips presets whose target filename already exists', async () => {
    const parts = makeFakePlugin([
      'Agent Board/templates',
      'Agent Board/templates/bug-fix.md',
    ]);
    const result = await installPresetTemplates(parts.plugin as Parameters<typeof installPresetTemplates>[0]);

    expect(result.skipped).toBe(1);
    expect(result.installed).toBe(PRESET_TEMPLATES.length - 1);
    expect(parts.created.find((c) => c.path === 'Agent Board/templates/bug-fix.md')).toBeUndefined();
  });

  it('does not call createFolder when the folder already exists', async () => {
    const parts = makeFakePlugin(['Agent Board/templates']);
    await installPresetTemplates(parts.plugin as Parameters<typeof installPresetTemplates>[0]);
    expect(parts.folders).toEqual([]);
  });
});
