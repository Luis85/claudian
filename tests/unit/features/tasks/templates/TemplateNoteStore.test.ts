import type { App, Vault } from 'obsidian';
import { TFile } from 'obsidian';

import { TemplateNoteStore } from '../../../../../src/features/tasks/templates/TemplateNoteStore';

const TEMPLATE = `---
type: claudian-work-order-template
schema_version: 1
name: Bug fix
description: Fix a defect.
provider: claude
model: sonnet
priority: high
---
# {{title}}

## Objective
Fix it.
`;

const NO_NAME = `---
type: claudian-work-order-template
schema_version: 1
---
# {{title}}
`;

const WRONG_TYPE = `---
type: claudian-work-order
schema_version: 1
---
body
`;

describe('TemplateNoteStore.parse', () => {
  const store = new TemplateNoteStore();

  it('reads name, description, provider, model, priority, and body', () => {
    const t = store.parse('Agent Board/templates/bug.md', TEMPLATE);
    expect(t).toMatchObject({
      name: 'Bug fix',
      description: 'Fix a defect.',
      provider: 'claude',
      model: 'sonnet',
      priority: 'high',
    });
    expect(t.body).toContain('# {{title}}');
  });

  it('falls back to the filename when name is missing', () => {
    expect(store.parse('Agent Board/templates/my-template.md', NO_NAME).name).toBe('my-template');
  });

  it('drops an invalid priority to undefined', () => {
    const t = store.parse('x.md', TEMPLATE.replace('priority: high', 'priority: bogus'));
    expect(t.priority).toBeUndefined();
  });

  it('rejects a non-template type', () => {
    expect(() => store.parse('x.md', WRONG_TYPE)).toThrow('Invalid template type');
  });

  it('rejects an unsupported schema_version', () => {
    const bad = TEMPLATE.replace('schema_version: 1', 'schema_version: 2');
    expect(() => store.parse('x.md', bad)).toThrow('Unsupported template schema_version');
  });
});

describe('TemplateNoteStore icon parse', () => {
  it('reads icon from frontmatter', () => {
    const content = TEMPLATE.replace('name: Bug fix', 'name: Bug fix\nicon: bug');
    const t = new TemplateNoteStore().parse('x.md', content);
    expect(t.icon).toBe('bug');
  });
});

describe('TemplateNoteStore.build', () => {
  const store = new TemplateNoteStore();

  it('round-trips all fields through parse', () => {
    const md = store.build({
      name: 'Bug fix',
      description: 'Fix a defect.',
      icon: 'bug',
      provider: 'claude',
      model: 'sonnet',
      priority: 'high',
      body: '# {{title}}\n\n## Objective\nFix it.',
    });
    const parsed = store.parse('x.md', md);
    expect(parsed).toMatchObject({
      name: 'Bug fix',
      description: 'Fix a defect.',
      icon: 'bug',
      provider: 'claude',
      model: 'sonnet',
      priority: 'high',
    });
    expect(parsed.body).toContain('# {{title}}');
    expect(parsed.body).toContain('## Objective');
  });

  it('omits optional fields when not provided', () => {
    const md = store.build({ name: 'Plain', body: '# {{title}}' });
    const parsed = store.parse('x.md', md);
    expect(parsed.name).toBe('Plain');
    expect(parsed.description).toBeUndefined();
    expect(parsed.icon).toBeUndefined();
    expect(parsed.provider).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
  });
});

describe('TemplateNoteStore.getFilePathForName', () => {
  const store = new TemplateNoteStore();

  it('slugifies the name under the folder', () => {
    expect(store.getFilePathForName('Agent Board/templates', 'Bug Fix!')).toBe('Agent Board/templates/bug-fix.md');
  });

  it('falls back to template when name is empty', () => {
    expect(store.getFilePathForName('Agent Board/templates', '   ')).toBe('Agent Board/templates/template.md');
  });

  it('strips leading and trailing slashes from the folder', () => {
    expect(store.getFilePathForName('/Agent Board/templates/', 'Bug')).toBe('Agent Board/templates/bug.md');
  });
});

describe('TemplateNoteStore.save', () => {
  it('creates a new note when originalPath is not provided', async () => {
    const created: { path: string; content: string }[] = [];
    const folderCreated: string[] = [];
    const vault = {
      getAbstractFileByPath: jest.fn(() => null),
      createFolder: jest.fn(async (path: string) => { folderCreated.push(path); }),
      create: jest.fn(async (path: string, content: string) => {
        created.push({ path, content });
        return { path };
      }),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new TemplateNoteStore().save(vault, 'Agent Board/templates', {
      name: 'Bug',
      body: '# {{title}}',
    });

    expect(path).toBe('Agent Board/templates/bug.md');
    expect(created).toHaveLength(1);
    expect(created[0].path).toBe('Agent Board/templates/bug.md');
    expect(created[0].content).toContain('claudian-work-order-template');
    expect(folderCreated).toEqual(['Agent Board/templates']);
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it('modifies the existing note when originalPath is provided and exists', async () => {
    const file = Object.assign(new TFile(), { path: 'Agent Board/templates/old.md' });
    const vault = {
      getAbstractFileByPath: jest.fn(() => file),
      createFolder: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new TemplateNoteStore().save(
      vault,
      'Agent Board/templates',
      { name: 'Bug', body: '# {{title}}' },
      'Agent Board/templates/old.md',
    );

    expect(path).toBe('Agent Board/templates/old.md');
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(vault.create).not.toHaveBeenCalled();
  });

  it('creates when originalPath is provided but the file is missing', async () => {
    const vault = {
      getAbstractFileByPath: jest.fn(() => null),
      createFolder: jest.fn(),
      create: jest.fn(async (path: string) => ({ path })),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new TemplateNoteStore().save(
      vault,
      'Agent Board/templates',
      { name: 'Bug', body: '# {{title}}' },
      'Agent Board/templates/old.md',
    );

    expect(path).toBe('Agent Board/templates/bug.md');
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.modify).not.toHaveBeenCalled();
  });
});

describe('TemplateNoteStore.delete', () => {
  it('trashes the file when it exists', async () => {
    const file = { path: 'Agent Board/templates/old.md' };
    const trashFile = jest.fn();
    const app = {
      vault: { getAbstractFileByPath: jest.fn(() => file) },
      fileManager: { trashFile },
    } as unknown as App;
    await new TemplateNoteStore().delete(app, 'Agent Board/templates/old.md');
    expect(trashFile).toHaveBeenCalledWith(file);
  });

  it('is a no-op when the file is missing', async () => {
    const trashFile = jest.fn();
    const app = {
      vault: { getAbstractFileByPath: jest.fn(() => null) },
      fileManager: { trashFile },
    } as unknown as App;
    await new TemplateNoteStore().delete(app, 'Agent Board/templates/missing.md');
    expect(trashFile).not.toHaveBeenCalled();
  });
});

describe('TemplateNoteStore.list', () => {
  it('returns valid templates sorted by name and warns on bad notes', async () => {
    const byPath: Record<string, string> = {
      'Agent Board/templates/b.md': TEMPLATE.replace('name: Bug fix', 'name: Zebra'),
      'Agent Board/templates/a.md': TEMPLATE.replace('name: Bug fix', 'name: Apple'),
      'Agent Board/templates/bad.md': WRONG_TYPE,
      'Other/x.md': TEMPLATE,
    };
    const vault = {
      getMarkdownFiles: () => Object.keys(byPath).map((path) => ({ path })),
      read: async (file: { path: string }) => byPath[file.path],
    } as unknown as Vault;

    const { templates, warnings } = await new TemplateNoteStore().list(vault, 'Agent Board/templates');
    expect(templates.map((t) => t.name)).toEqual(['Apple', 'Zebra']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad.md');
  });
});
