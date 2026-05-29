import type { Vault } from 'obsidian';

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
