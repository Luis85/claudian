import {
  buildTemplateChoices,
  buildTemplateVars,
  findUnknownPlaceholders,
  renderWorkOrderBody,
  resolvePriority,
  resolveProviderModel,
} from '../../../../../src/features/tasks/templates/templateResolution';
import type { WorkOrderTemplate } from '../../../../../src/features/tasks/templates/templateTypes';
import type { TaskPriority } from '../../../../../src/features/tasks/model/taskTypes';

const tpl = (over: Partial<WorkOrderTemplate> = {}): WorkOrderTemplate => ({
  path: 'Agent Board/templates/t.md',
  name: 'T',
  body: '# {{title}}',
  ...over,
});

describe('findUnknownPlaceholders', () => {
  it('returns only placeholders outside the allowed set', () => {
    expect(findUnknownPlaceholders('{{title}} {{date}} {{source}}')).toEqual([]);
    expect(findUnknownPlaceholders('{{title}} {{nope}} {{ also_bad }}')).toEqual(['nope', 'also_bad']);
  });
});

describe('renderWorkOrderBody', () => {
  it('substitutes title, date, and source', () => {
    const { body, errors } = renderWorkOrderBody(
      tpl({ body: '# {{title}}\n{{date}}\n{{source}}' }),
      { title: 'Fix bug', date: '2026-05-29', source: '[[notes/a]]' },
    );
    expect(errors).toEqual([]);
    expect(body).toBe('# Fix bug\n2026-05-29\n[[notes/a]]');
  });

  it('leaves an empty source when none is provided', () => {
    const { body } = renderWorkOrderBody(tpl({ body: 'src:{{source}}' }), { title: 'x', date: 'd', source: '' });
    expect(body).toBe('src:');
  });

  it('reports unknown placeholders and does not substitute', () => {
    const { body, errors } = renderWorkOrderBody(tpl({ body: '{{title}} {{nope}}' }), { title: 'x', date: 'd', source: '' });
    expect(errors).toEqual(['Unknown placeholder {{nope}}']);
    expect(body).toContain('{{nope}}');
  });
});

describe('resolveProviderModel', () => {
  const validators = (providers: string[], owned: Record<string, string[]>) => ({
    isValidProvider: (id: string) => providers.includes(id),
    ownsModel: (id: string, model: string) => (owned[id] ?? []).includes(model),
  });

  it('uses template provider and model when both are valid', () => {
    const r = resolveProviderModel(
      { provider: 'claude', model: 'sonnet' },
      { provider: 'codex', model: 'gpt' },
      validators(['claude', 'codex'], { claude: ['sonnet'] }),
    );
    expect(r).toEqual({ provider: 'claude', model: 'sonnet', warnings: [] });
  });

  it('falls back to the default provider and warns when the template provider is disabled', () => {
    const r = resolveProviderModel(
      { provider: 'ghost' },
      { provider: 'codex', model: 'gpt' },
      validators(['codex'], { codex: ['gpt'] }),
    );
    expect(r.provider).toBe('codex');
    expect(r.model).toBe('gpt');
    expect(r.warnings[0]).toContain('ghost');
  });

  it('falls back to the default model and warns when the template model is invalid', () => {
    const r = resolveProviderModel(
      { provider: 'codex', model: 'bad' },
      { provider: 'codex', model: 'gpt' },
      validators(['codex'], { codex: ['gpt'] }),
    );
    expect(r.model).toBe('gpt');
    expect(r.warnings[0]).toContain('not valid for');
  });

  it('returns an empty model when provider differs from default and template gives none', () => {
    const r = resolveProviderModel(
      { provider: 'claude' },
      { provider: 'codex', model: 'gpt' },
      validators(['claude', 'codex'], {}),
    );
    expect(r).toEqual({ provider: 'claude', model: '', warnings: [] });
  });
});

describe('resolvePriority', () => {
  it('keeps every valid priority and defaults missing or invalid to normal', () => {
    expect(resolvePriority({ priority: 'low' })).toBe('low');
    expect(resolvePriority({ priority: 'high' })).toBe('high');
    expect(resolvePriority({ priority: 'urgent' })).toBe('urgent');
    expect(resolvePriority({ priority: 'bogus' as TaskPriority })).toBe('normal');
    expect(resolvePriority(undefined)).toBe('normal');
  });
});

describe('buildTemplateVars', () => {
  it('links a source note and strips the extension', () => {
    expect(buildTemplateVars({ title: 'T', date: 'd', sourcePath: 'notes/a.md' }).source).toBe('[[notes/a]]');
  });

  it('uses a code span for a folder source and empty string for none', () => {
    expect(buildTemplateVars({ title: 'T', date: 'd', sourceFolderPath: 'Area/x' }).source).toBe('`Area/x`');
    expect(buildTemplateVars({ title: 'T', date: 'd' }).source).toBe('');
  });
});

describe('buildTemplateChoices', () => {
  it('puts Blank first, then templates', () => {
    const choices = buildTemplateChoices([tpl({ name: 'A' })]);
    expect(choices[0]).toEqual({ kind: 'blank' });
    expect(choices[1]).toMatchObject({ kind: 'template', template: { name: 'A' } });
  });

  it('returns only Blank for an empty template list', () => {
    expect(buildTemplateChoices([])).toEqual([{ kind: 'blank' }]);
  });
});
