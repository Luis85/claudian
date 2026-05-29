# Work-Order Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick from pre-defined Markdown templates when creating an Agent Board work order, prefilling the body plus provider/model/priority.

**Architecture:** Templates are Markdown notes (`type: claudian-work-order-template`) in a dedicated folder. A pure resolution layer renders the body (strict `{{title}}/{{date}}/{{source}}` placeholders) and resolves provider/model/priority defaults. A fuzzy picker (with a built-in "Blank") runs at every creation surface, then the existing `createWorkOrderFromSeed` builds the note. The engine always appends the Run Ledger and Result / Handoff generated regions.

**Tech Stack:** TypeScript, Obsidian plugin API (`FuzzySuggestModal`, `Vault`), Jest unit tests.

---

## Spec

Source spec: `docs/superpowers/specs/2026-05-29-work-order-templates-design.md`

## Context for the implementer

Read these before starting:
- `src/features/tasks/commands/taskCommands.ts` — `WorkOrderSeed`, `createWorkOrderFromSeed`, `buildWorkOrderMarkdown`. All creation funnels through `createWorkOrderFromSeed`.
- `src/features/tasks/storage/TaskNoteStore.ts` — `parse` requires `type: claudian-work-order`; `appendLedger`/`writeHandoff` **throw** if the ledger/handoff markers are missing, so created notes must always include them.
- `src/utils/frontmatter.ts` — `parseFrontmatter(content)` → `{ frontmatter, body } | null`; `extractString(fm, key)` → trimmed string or `undefined`.
- `src/core/providers/ProviderRegistry.ts` — statics `getRegisteredProviderIds()`, `isEnabled(id, settings)`, `getChatUIConfig(id).ownsModel(model, settings)`.

Conventions (from project memory): no inline styles (toggle visibility with Obsidian's `HTMLElement.show()/.hide()`), sentence-case UI strings (the `Agent Board` product name keeps its casing with the existing eslint-disable comment), `window` timers only, no `console.*`.

File path note: tests live under `tests/unit/` mirroring `src/`. Run a single file with `npm run test -- <substring-of-path>`.

---

## Task 1: Settings field for the template folder

**Files:**
- Modify: `src/core/types/settings.ts:152-157`
- Modify: `src/app/settings/defaultSettings.ts:53-55`

- [ ] **Step 1: Add the setting field**

In `src/core/types/settings.ts`, the Agent Board block currently reads:

```ts
  // Agent Board
  agentBoardWorkOrderFolder: string;
  agentBoardDefaultProvider: string;
  agentBoardDefaultModel: string;
```

Add one line after `agentBoardWorkOrderFolder`:

```ts
  // Agent Board
  agentBoardWorkOrderFolder: string;
  agentBoardTemplateFolder: string;
  agentBoardDefaultProvider: string;
  agentBoardDefaultModel: string;
```

- [ ] **Step 2: Add the default value**

In `src/app/settings/defaultSettings.ts`, the Agent Board defaults read:

```ts
  agentBoardWorkOrderFolder: 'Agent Board/tasks',
  agentBoardDefaultProvider: 'codex',
  agentBoardDefaultModel: '',
```

Change to:

```ts
  agentBoardWorkOrderFolder: 'Agent Board/tasks',
  agentBoardTemplateFolder: 'Agent Board/templates',
  agentBoardDefaultProvider: 'codex',
  agentBoardDefaultModel: '',
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts
git commit -m "feat(tasks): add agent board template folder setting"
```

---

## Task 2: Template types

**Files:**
- Create: `src/features/tasks/templates/templateTypes.ts`

- [ ] **Step 1: Create the types file**

```ts
import type { TaskPriority } from '../model/taskTypes';

export interface WorkOrderTemplate {
  path: string;
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
  body: string;
}

export type TemplateChoice =
  | { kind: 'blank' }
  | { kind: 'template'; template: WorkOrderTemplate };

export interface TemplateVars {
  title: string;
  date: string;
  source: string;
}

export const ALLOWED_TEMPLATE_PLACEHOLDERS = ['title', 'date', 'source'] as const;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/templates/templateTypes.ts
git commit -m "feat(tasks): add work-order template types"
```

---

## Task 3: Template resolution (render + provider/model/priority + choices)

**Files:**
- Create: `src/features/tasks/templates/templateResolution.ts`
- Test: `tests/unit/features/tasks/templates/templateResolution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/templates/templateResolution.test.ts`:

```ts
import {
  buildTemplateChoices,
  buildTemplateVars,
  findUnknownPlaceholders,
  renderWorkOrderBody,
  resolvePriority,
  resolveProviderModel,
} from '../../../../../src/features/tasks/templates/templateResolution';
import type { WorkOrderTemplate } from '../../../../../src/features/tasks/templates/templateTypes';

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
    expect(r.warnings[0]).toContain('bad');
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
  it('keeps a valid priority and defaults missing or invalid to normal', () => {
    expect(resolvePriority({ priority: 'high' })).toBe('high');
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- templateResolution`
Expected: FAIL with "Cannot find module .../templateResolution".

- [ ] **Step 3: Implement the resolution module**

Create `src/features/tasks/templates/templateResolution.ts`:

```ts
import type { TaskPriority } from '../model/taskTypes';
import { ALLOWED_TEMPLATE_PLACEHOLDERS, type TemplateChoice, type TemplateVars, type WorkOrderTemplate } from './templateTypes';

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;
const VALID_PRIORITIES: ReadonlySet<TaskPriority> = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

export function findUnknownPlaceholders(body: string): string[] {
  const allowed = new Set<string>(ALLOWED_TEMPLATE_PLACEHOLDERS);
  const unknown: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (!allowed.has(name) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return unknown;
}

export function renderWorkOrderBody(
  template: WorkOrderTemplate,
  vars: TemplateVars,
): { body: string; errors: string[] } {
  const unknown = findUnknownPlaceholders(template.body);
  if (unknown.length > 0) {
    return { body: template.body, errors: unknown.map((name) => `Unknown placeholder {{${name}}}`) };
  }
  const body = template.body.replace(PLACEHOLDER_PATTERN, (_full, name: string) => {
    if (name === 'title') return vars.title;
    if (name === 'date') return vars.date;
    if (name === 'source') return vars.source;
    return '';
  });
  return { body, errors: [] };
}

export interface ProviderModelValidators {
  isValidProvider(providerId: string): boolean;
  ownsModel(providerId: string, model: string): boolean;
}

export function resolveProviderModel(
  template: Pick<WorkOrderTemplate, 'provider' | 'model'> | undefined,
  defaults: { provider: string; model: string },
  validators: ProviderModelValidators,
): { provider: string; model: string; warnings: string[] } {
  const warnings: string[] = [];

  let provider = defaults.provider;
  if (template?.provider) {
    if (validators.isValidProvider(template.provider)) {
      provider = template.provider;
    } else {
      warnings.push(`Template provider "${template.provider}" is not enabled; using the default provider.`);
    }
  }

  let model = provider === defaults.provider ? defaults.model : '';
  if (template?.model) {
    if (validators.ownsModel(provider, template.model)) {
      model = template.model;
    } else {
      warnings.push(`Template model "${template.model}" is not valid for ${provider}; using the default model.`);
    }
  }

  return { provider, model, warnings };
}

export function resolvePriority(template: Pick<WorkOrderTemplate, 'priority'> | undefined): TaskPriority {
  const priority = template?.priority;
  return priority && VALID_PRIORITIES.has(priority) ? priority : 'normal';
}

export function buildTemplateVars(args: {
  title: string;
  date: string;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
}): TemplateVars {
  let source = '';
  if (args.sourcePath) {
    source = `[[${args.sourcePath.replace(/\.md$/i, '')}]]`;
  } else if (args.sourceFolderPath) {
    source = `\`${args.sourceFolderPath}\``;
  }
  return { title: args.title, date: args.date, source };
}

export function buildTemplateChoices(templates: WorkOrderTemplate[]): TemplateChoice[] {
  return [{ kind: 'blank' }, ...templates.map((template): TemplateChoice => ({ kind: 'template', template }))];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- templateResolution`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/templates/templateResolution.ts tests/unit/features/tasks/templates/templateResolution.test.ts
git commit -m "feat(tasks): add template body/provider/model resolution"
```

---

## Task 4: Template note store (parse + list)

**Files:**
- Create: `src/features/tasks/templates/TemplateNoteStore.ts`
- Test: `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- TemplateNoteStore`
Expected: FAIL with "Cannot find module .../TemplateNoteStore".

- [ ] **Step 3: Implement the store**

Create `src/features/tasks/templates/TemplateNoteStore.ts`:

```ts
import type { Vault } from 'obsidian';

import { extractString, parseFrontmatter } from '../../../utils/frontmatter';
import type { TaskPriority } from '../model/taskTypes';
import type { WorkOrderTemplate } from './templateTypes';

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['low', 'normal', 'high', 'urgent']);

function fileBaseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

export class TemplateNoteStore {
  parse(path: string, content: string): WorkOrderTemplate {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      throw new Error('Missing YAML frontmatter');
    }
    if (parsed.frontmatter.type !== 'claudian-work-order-template') {
      throw new Error('Invalid template type');
    }
    if (parsed.frontmatter.schema_version !== 1) {
      throw new Error('Unsupported template schema_version');
    }

    const rawPriority = extractString(parsed.frontmatter, 'priority');
    const priority = rawPriority && VALID_PRIORITIES.has(rawPriority) ? (rawPriority as TaskPriority) : undefined;

    return {
      path,
      name: extractString(parsed.frontmatter, 'name') ?? fileBaseName(path),
      description: extractString(parsed.frontmatter, 'description'),
      provider: extractString(parsed.frontmatter, 'provider'),
      model: extractString(parsed.frontmatter, 'model'),
      priority,
      body: parsed.body.trim(),
    };
  }

  async list(vault: Vault, folder: string): Promise<{ templates: WorkOrderTemplate[]; warnings: string[] }> {
    const normalized = folder.replace(/^\/+|\/+$/g, '');
    const templates: WorkOrderTemplate[] = [];
    const warnings: string[] = [];
    const files = vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalized}/`));
    for (const file of files) {
      try {
        templates.push(this.parse(file.path, await vault.read(file)));
      } catch (error) {
        warnings.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    templates.sort((a, b) => a.name.localeCompare(b.name));
    return { templates, warnings };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- TemplateNoteStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/templates/TemplateNoteStore.ts tests/unit/features/tasks/templates/TemplateNoteStore.test.ts
git commit -m "feat(tasks): add template note store parse and list"
```

---

## Task 5: Work-order builders (priority param, template builder, scaffold)

**Files:**
- Modify: `src/features/tasks/commands/taskCommands.ts`
- Test: `tests/unit/features/tasks/commands/taskCommands.test.ts`

This task refactors `buildWorkOrderMarkdown` to share a frontmatter block and a generated-regions tail, adds a `priority` param, adds `buildWorkOrderFromTemplate`, adds the scaffold builder, and branches `createWorkOrderFromSeed` on a template option.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/features/tasks/commands/taskCommands.test.ts`. First add the new imports at the top (the file already imports `__taskCaptureTestUtils`, `__taskCommandTestUtils`, and `TaskNoteStore`):

```ts
import { TemplateNoteStore } from '../../../../../src/features/tasks/templates/TemplateNoteStore';
```

Then add these describe blocks at the end of the file:

```ts
describe('buildWorkOrderMarkdown priority + seam', () => {
  const { buildWorkOrderMarkdown } = __taskCommandTestUtils;
  const base = { id: 't', title: 'T', provider: 'codex', model: 'm', timestamp: '2026-05-29T10:00:00.000Z' };

  it('emits the requested priority, defaulting to normal', () => {
    expect(buildWorkOrderMarkdown(base)).toContain('priority: normal');
    expect(buildWorkOrderMarkdown({ ...base, priority: 'high' })).toContain('priority: high');
  });

  it('keeps the constraints-to-ledger seam intact', () => {
    expect(buildWorkOrderMarkdown(base)).toContain(
      '- Do not modify unrelated files.\n\n## Run Ledger\n\n<!-- claudian:run-ledger-start -->',
    );
  });
});

describe('buildWorkOrderFromTemplate', () => {
  const { buildWorkOrderFromTemplate } = __taskCommandTestUtils;

  it('wraps the rendered body in frontmatter and generated regions', () => {
    const md = buildWorkOrderFromTemplate({
      id: 'task-tpl',
      title: 'Templated',
      status: 'inbox',
      priority: 'high',
      timestamp: '2026-05-29T10:00:00.000Z',
      provider: 'claude',
      model: 'sonnet',
      conversationId: null,
      body: '# Templated\n\n## Objective\n\nDo the thing.',
    });

    expect(md).toContain('priority: high');
    expect(md).toContain('provider: claude');
    expect(md).toContain('## Objective\n\nDo the thing.');
    expect(md).toContain('## Run Ledger');
    expect(md).toContain('<!-- claudian:handoff-start -->');

    const { task } = new TaskNoteStore().parse('Agent Board/tasks/tpl.md', md);
    expect(task.frontmatter.status).toBe('inbox');
    expect(task.frontmatter.priority).toBe('high');
  });
});

describe('buildExampleTemplateMarkdown', () => {
  const { buildExampleTemplateMarkdown } = __taskCommandTestUtils;

  it('scaffolds a template note that the template store can parse', () => {
    const tpl = new TemplateNoteStore().parse('Agent Board/templates/example.md', buildExampleTemplateMarkdown());
    expect(tpl.name).toBe('Example template');
    expect(tpl.body).toContain('{{title}}');
    expect(tpl.body).toContain('{{source}}');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- taskCommands`
Expected: FAIL — `priority: high` not found, and `buildWorkOrderFromTemplate` / `buildExampleTemplateMarkdown` are `undefined`.

- [ ] **Step 3: Refactor builders and add new ones**

In `src/features/tasks/commands/taskCommands.ts`, update the imports at the top:

```ts
import { normalizePath, Notice, TFile, TFolder } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { TaskPriority, TaskStatus } from '../model/taskTypes';
import { HANDOFF_END, HANDOFF_START, RUN_LEDGER_END, RUN_LEDGER_START } from '../storage/TaskNoteStore';
import { buildTemplateVars, renderWorkOrderBody, resolvePriority, resolveProviderModel } from '../templates/templateResolution';
import type { WorkOrderTemplate } from '../templates/templateTypes';
```

Add `priority` to `BuildWorkOrderArgs`:

```ts
interface BuildWorkOrderArgs {
  id: string;
  title: string;
  provider: string;
  model: string;
  timestamp: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  objective?: string;
  contextMarkdown?: string;
  conversationId?: string | null;
}
```

Replace the existing `buildWorkOrderMarkdown` function (lines 33-99) with the shared helpers plus the rewritten builders:

```ts
interface FrontmatterArgs {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  timestamp: string;
  provider: string;
  model: string;
  conversationId?: string | null;
}

function workOrderFrontmatter(args: FrontmatterArgs): string {
  const conversationLine = args.conversationId
    ? `conversation_id: ${JSON.stringify(args.conversationId)}`
    : 'conversation_id:';
  return `---
type: claudian-work-order
schema_version: 1
id: ${args.id}
title: ${JSON.stringify(args.title)}
status: ${args.status}
priority: ${args.priority}
created: ${args.timestamp}
updated: ${args.timestamp}
provider: ${args.provider}
model: ${args.model}
run_id:
${conversationLine}
sidepanel_tab_id:
started:
finished:
attempts: 0
---`;
}

const GENERATED_REGIONS_TAIL = `## Run Ledger

${RUN_LEDGER_START}
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;

function buildWorkOrderMarkdown(args: BuildWorkOrderArgs): string {
  const status = args.status ?? 'ready';
  const priority = args.priority ?? 'normal';

  let contextBody = '_Add the links, files, and scope the agent needs._';
  if (args.contextMarkdown && args.contextMarkdown.trim()) {
    contextBody = args.contextMarkdown.trim();
  } else if (args.sourcePath) {
    contextBody = `Source note: [[${stripMarkdownExtension(args.sourcePath)}]]`;
  } else if (args.sourceFolderPath) {
    contextBody = `Source folder: \`${args.sourceFolderPath}\``;
  }

  const objectiveBody =
    args.objective && args.objective.trim() ? args.objective.trim() : '_What should the agent accomplish?_';

  return `${workOrderFrontmatter({
    id: args.id,
    title: args.title,
    status,
    priority,
    timestamp: args.timestamp,
    provider: args.provider,
    model: args.model,
    conversationId: args.conversationId,
  })}
# ${args.title}

## Objective

${objectiveBody}

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

${contextBody}

## Constraints

- Keep direct chat behavior intact.
- Do not modify unrelated files.

${GENERATED_REGIONS_TAIL}`;
}

function buildWorkOrderFromTemplate(args: FrontmatterArgs & { body: string }): string {
  return `${workOrderFrontmatter(args)}
${args.body.trim()}

${GENERATED_REGIONS_TAIL}`;
}

function buildExampleTemplateMarkdown(): string {
  return `---
type: claudian-work-order-template
schema_version: 1
name: Example template
description: Starting point for a custom work-order template.
priority: normal
---
# {{title}}

## Objective

_Describe what the agent should accomplish._

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

{{source}}

_Created {{date}}._

## Constraints

- Do not modify unrelated files.
`;
}
```

Add a date helper near `timestampId`:

```ts
function isoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
```

Add `template` to `CreateWorkOrderOptions`:

```ts
export interface CreateWorkOrderOptions {
  status?: TaskStatus;
  reveal?: 'note' | 'none';
  template?: WorkOrderTemplate;
}
```

Replace the body of `createWorkOrderFromSeed` (the provider/model guards through the `buildWorkOrderMarkdown` call, lines 153-186) with template-aware resolution. The new function body:

```ts
export async function createWorkOrderFromSeed(
  plugin: ClaudianPlugin,
  seed: WorkOrderSeed,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  const defaults = {
    provider: plugin.settings.agentBoardDefaultProvider,
    model: plugin.settings.agentBoardDefaultModel,
  };
  const template = options?.template;

  let provider = defaults.provider;
  let model = defaults.model;
  let priority: TaskPriority = 'normal';
  if (template) {
    const resolved = resolveProviderModel(template, defaults, {
      isValidProvider: (id) =>
        ProviderRegistry.getRegisteredProviderIds().includes(id as ProviderId) &&
        ProviderRegistry.isEnabled(id as ProviderId, settings),
      ownsModel: (id, candidate) =>
        ProviderRegistry.getRegisteredProviderIds().includes(id as ProviderId) &&
        ProviderRegistry.getChatUIConfig(id as ProviderId).ownsModel(candidate, settings),
    });
    provider = resolved.provider;
    model = resolved.model;
    priority = resolvePriority(template);
    for (const warning of resolved.warnings) {
      new Notice(warning);
    }
  }

  if (!provider) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default provider in settings first.');
    return null;
  }
  if (!model) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default model in settings first.');
    return null;
  }

  const folder = normalizePath(plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks');
  await ensureFolder(plugin, folder);

  const now = new Date();
  const title = seed.title || 'New work order';
  const slug = slugifyTitle(title) || 'work-order';
  const id = `task-${timestampId(now)}-${slug}`;
  const status = options?.status ?? seed.status ?? 'ready';

  let markdown: string;
  if (template) {
    const vars = buildTemplateVars({
      title,
      date: isoDate(now),
      sourcePath: seed.sourcePath ?? null,
      sourceFolderPath: seed.sourceFolderPath ?? null,
    });
    const rendered = renderWorkOrderBody(template, vars);
    if (rendered.errors.length > 0) {
      new Notice(`Template "${template.name}" has problems: ${rendered.errors.join('; ')}`);
      return null;
    }
    markdown = buildWorkOrderFromTemplate({
      id,
      title,
      status,
      priority,
      timestamp: now.toISOString(),
      provider,
      model,
      conversationId: seed.conversationId ?? null,
      body: rendered.body,
    });
  } else {
    markdown = buildWorkOrderMarkdown({
      id,
      title,
      provider,
      model,
      timestamp: now.toISOString(),
      status,
      sourcePath: seed.sourcePath ?? null,
      sourceFolderPath: seed.sourceFolderPath ?? null,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
      conversationId: seed.conversationId ?? null,
    });
  }

  const filePath = uniquePath(plugin, normalizePath(`${folder}/${id}.md`));
  const created = await plugin.app.vault.create(filePath, markdown);
  if (created instanceof TFile) {
    if ((options?.reveal ?? 'note') === 'note') {
      await plugin.app.workspace.getLeaf('tab').openFile(created);
    }
    return created;
  }
  return null;
}
```

Add the scaffold command function after `createWorkOrder` (keep `createWorkOrder` as-is; it forwards `options` to `createWorkOrderFromSeed`):

```ts
export async function createWorkOrderTemplate(plugin: ClaudianPlugin): Promise<TFile | null> {
  const folder = normalizePath(plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates');
  await ensureFolder(plugin, folder);
  const filePath = uniquePath(plugin, normalizePath(`${folder}/work-order-template.md`));
  const created = await plugin.app.vault.create(filePath, buildExampleTemplateMarkdown());
  if (created instanceof TFile) {
    await plugin.app.workspace.getLeaf('tab').openFile(created);
    return created;
  }
  return null;
}
```

Update the test-utils export at the bottom of the file:

```ts
export const __taskCommandTestUtils = {
  buildWorkOrderMarkdown,
  buildWorkOrderFromTemplate,
  buildExampleTemplateMarkdown,
  slugifyTitle,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- taskCommands`
Expected: PASS (existing assertions plus the three new describe blocks).

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/commands/taskCommands.ts tests/unit/features/tasks/commands/taskCommands.test.ts
git commit -m "feat(tasks): build work orders from templates and scaffold command"
```

---

## Task 6: Template picker modal

**Files:**
- Create: `src/features/tasks/ui/WorkOrderTemplateSuggest.ts`

This file holds the Obsidian modal and the `chooseWorkOrderTemplate` helper. The pure `buildTemplateChoices` already lives in `templateResolution.ts` (tested in Task 3), so this UI file needs no unit test; `npm run typecheck` and `npm run build` cover it.

- [ ] **Step 1: Create the modal + helper**

```ts
import type { App } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { buildTemplateChoices } from '../templates/templateResolution';
import { TemplateNoteStore } from '../templates/TemplateNoteStore';
import type { TemplateChoice, WorkOrderTemplate } from '../templates/templateTypes';

class WorkOrderTemplateSuggest extends FuzzySuggestModal<TemplateChoice> {
  private chosen = false;

  constructor(
    app: App,
    private readonly choices: TemplateChoice[],
    private readonly resolve: (choice: TemplateChoice | null) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a work-order template');
  }

  getItems(): TemplateChoice[] {
    return this.choices;
  }

  getItemText(choice: TemplateChoice): string {
    return choice.kind === 'blank' ? 'Blank' : choice.template.name;
  }

  onChooseItem(choice: TemplateChoice): void {
    this.chosen = true;
    this.resolve(choice);
  }

  onClose(): void {
    super.onClose();
    if (!this.chosen) {
      this.resolve(null);
    }
  }
}

export interface TemplatePickResult {
  cancelled: boolean;
  template?: WorkOrderTemplate;
}

export async function chooseWorkOrderTemplate(plugin: ClaudianPlugin): Promise<TemplatePickResult> {
  const folder = (plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates').replace(/^\/+|\/+$/g, '');
  const { templates } = await new TemplateNoteStore().list(plugin.app.vault, folder);
  if (templates.length === 0) {
    return { cancelled: false };
  }
  const choice = await new Promise<TemplateChoice | null>((resolve) => {
    new WorkOrderTemplateSuggest(plugin.app, buildTemplateChoices(templates), resolve).open();
  });
  if (!choice) {
    return { cancelled: true };
  }
  return { cancelled: false, template: choice.kind === 'template' ? choice.template : undefined };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/WorkOrderTemplateSuggest.ts
git commit -m "feat(tasks): add work-order template picker modal"
```

---

## Task 7: Interactive creation wrappers

**Files:**
- Create: `src/features/tasks/ui/createWorkOrderInteractive.ts`
- Modify: `src/features/tasks/commands/taskCommands.ts` (remove the now-superseded `createWorkOrderFromCurrentNote` / `createWorkOrderFromSelection`)

The interactive wrappers capture the source/selection first, then open the picker, then create. Capturing before the picker matters: opening the modal can clear the active editor selection.

- [ ] **Step 1: Create the interactive wrappers**

```ts
import { Notice, type TFile, type TFolder } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import {
  buildSelectionSeed,
  createWorkOrder,
  createWorkOrderFromSeed,
  type CreateWorkOrderOptions,
} from '../commands/taskCommands';
import { chooseWorkOrderTemplate } from './WorkOrderTemplateSuggest';

export async function createWorkOrderInteractive(
  plugin: ClaudianPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrder(plugin, source ?? null, { ...options, template: picked.template });
}

export async function createWorkOrderFromCurrentNoteInteractive(plugin: ClaudianPlugin): Promise<TFile | null> {
  const active = plugin.app.workspace.getActiveFile();
  if (!active) {
    new Notice('Open a note to create a work order from it.');
    return null;
  }
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrder(plugin, active, { template: picked.template });
}

export async function createWorkOrderFromSelectionInteractive(plugin: ClaudianPlugin): Promise<TFile | null> {
  const editor = plugin.app.workspace.activeEditor?.editor;
  const selection = editor?.getSelection() ?? '';
  if (!selection.trim()) {
    new Notice('Select text in a note to create a work order from it.');
    return null;
  }
  const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? null;
  const seed = buildSelectionSeed({ selectionText: selection, sourcePath });
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrderFromSeed(plugin, seed, { template: picked.template });
}
```

- [ ] **Step 2: Remove the superseded command functions**

In `src/features/tasks/commands/taskCommands.ts`, delete `createWorkOrderFromCurrentNote` (the `export async function createWorkOrderFromCurrentNote(...)` block) and `createWorkOrderFromSelection` (the `export async function createWorkOrderFromSelection(...)` block). Keep `buildSelectionSeed`, `createWorkOrder`, `createWorkOrderFromSeed`, the `truncate`/`blockquote` helpers (used by `buildSelectionSeed`), and both `__taskCommandTestUtils` / `__taskCaptureTestUtils` exports.

- [ ] **Step 3: Verify typecheck fails on the old imports**

Run: `npm run typecheck`
Expected: FAIL — `src/main.ts` still imports the deleted `createWorkOrderFromCurrentNote` / `createWorkOrderFromSelection`. This is fixed in Task 8. (If you are running tasks out of order, proceed to Task 8 before re-running typecheck.)

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/createWorkOrderInteractive.ts src/features/tasks/commands/taskCommands.ts
git commit -m "feat(tasks): add interactive work-order creation wrappers"
```

---

## Task 8: Wire main.ts command + menu entries to the picker

**Files:**
- Modify: `src/main.ts:43-47` (imports), `:137-159` (commands), `:191-225` (menus)

- [ ] **Step 1: Update the imports**

Replace the existing import block (lines 43-47):

```ts
import {
  createWorkOrder,
  createWorkOrderFromCurrentNote,
  createWorkOrderFromSelection,
} from './features/tasks/commands/taskCommands';
```

with:

```ts
import { createWorkOrderTemplate } from './features/tasks/commands/taskCommands';
import {
  createWorkOrderFromCurrentNoteInteractive,
  createWorkOrderFromSelectionInteractive,
  createWorkOrderInteractive,
} from './features/tasks/ui/createWorkOrderInteractive';
```

- [ ] **Step 2: Update the three create commands and add the scaffold command**

Replace the command blocks at lines 137-159 with:

```ts
    this.addCommand({
      id: 'create-work-order',
      name: 'Create work order',
      callback: () => {
        void createWorkOrderInteractive(this);
      },
    });

    this.addCommand({
      id: 'create-work-order-from-current-note',
      name: 'Create work order from current note',
      callback: () => {
        void createWorkOrderFromCurrentNoteInteractive(this);
      },
    });

    this.addCommand({
      id: 'create-work-order-from-selection',
      name: 'Create work order from selection',
      editorCallback: () => {
        void createWorkOrderFromSelectionInteractive(this);
      },
    });

    this.addCommand({
      id: 'create-work-order-template',
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "work-order" hyphenation is intentional.
      name: 'Create work-order template',
      callback: () => {
        void createWorkOrderTemplate(this);
      },
    });
```

- [ ] **Step 3: Update the file/folder/editor menu entries**

In the `file-menu` handler, both "Create work order" `onClick` bodies currently call `void createWorkOrder(this, file);`. Change both to:

```ts
                void createWorkOrderInteractive(this, file);
```

In the `editor-menu` handler, the "Create work order from selection" `onClick` currently calls `void createWorkOrderFromSelection(this);`. Change to:

```ts
              void createWorkOrderFromSelectionInteractive(this);
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(tasks): route work-order creation through the template picker"
```

---

## Task 9: Wire the board "Add work order" button to the picker

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts:9` (import), `:189-200` (`addWorkOrderFromBoard`)

- [ ] **Step 1: Update the import**

Line 9 currently reads:

```ts
import { createWorkOrder } from '../commands/taskCommands';
```

Replace with:

```ts
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
```

- [ ] **Step 2: Update `addWorkOrderFromBoard`**

The method currently calls `createWorkOrder(this.plugin, null, { status: 'inbox', reveal: 'none' })`. Change that one line to:

```ts
    const created = await createWorkOrderInteractive(this.plugin, null, { status: 'inbox', reveal: 'none' });
```

Leave the rest of the method (refresh, read, parse, `openDetail`) unchanged.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): pick a template when adding a work order from the board"
```

---

## Task 10: Settings UI for the template folder

**Files:**
- Modify: `src/features/settings/ui/AgentBoardSettingsSection.ts`

- [ ] **Step 1: Add the template-folder input and equal-folder warning**

In `renderAgentBoardSettingsSection`, immediately after the existing "Work order folder" `Setting` block (the one ending around line 27, before `const settings = ...`), insert:

```ts
  const normalizeFolder = (value: string): string => (value || '').replace(/^\/+|\/+$/g, '');

  const folderWarning = new Setting(container).setName('');
  const refreshFolderWarning = (): void => {
    const same =
      normalizeFolder(plugin.settings.agentBoardTemplateFolder) ===
      normalizeFolder(plugin.settings.agentBoardWorkOrderFolder);
    folderWarning.setDesc(
      same
        ? 'Warning: the template folder matches the work order folder, so templates will appear as invalid notes on the board.'
        : '',
    );
    if (same) {
      folderWarning.settingEl.show();
    } else {
      folderWarning.settingEl.hide();
    }
  };

  new Setting(container)
    .setName('Template folder')
    .setDesc('Folder where work-order templates live.')
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path, not prose.
        .setPlaceholder('Agent Board/templates')
        .setValue(plugin.settings.agentBoardTemplateFolder)
        .onChange(async (value) => {
          plugin.settings.agentBoardTemplateFolder = value.trim();
          await plugin.saveSettings();
          refreshFolderWarning();
        }),
    );

  refreshFolderWarning();
```

- [ ] **Step 2: Verify typecheck + lint pass**

Run: `npm run typecheck && npm run lint`
Expected: PASS (0 errors, 0 warnings).

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/ui/AgentBoardSettingsSection.ts
git commit -m "feat(settings): add agent board template folder control"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS — typecheck clean, lint 0/0, all Jest suites green, build succeeds.

- [ ] **Step 2: Manual smoke test in Obsidian**

1. Run command "Create work-order template" → an `Example template` note opens under `Agent Board/templates`.
2. Click "Add work order" on the board → picker lists `Blank` plus `Example template`.
3. Pick `Example template` → a new Inbox work order is created with the template body; `{{title}}`/`{{date}}`/`{{source}}` are resolved; the note has valid Run Ledger and Result / Handoff regions; the detail modal opens.
4. Add `{{bogus}}` to the template, retry creation → a Notice names `{{bogus}}` and no note is created.
5. Set a template `provider:` to a disabled provider → creating from it shows a fallback Notice and uses the default provider.
6. Delete all template notes → "Add work order" creates a Blank work order with no picker.
7. Confirm template notes never appear as cards or invalid notes on the board.
8. In settings, set the template folder equal to the work order folder → the warning row appears; set it back → it disappears.

- [ ] **Step 3: Commit any final fixups**

Only if Step 1 or 2 required code changes:

```bash
git add -A
git commit -m "fix(tasks): address work-order templates verification findings"
```

---

## Self-review notes

- **Spec coverage:** template store/folder (Tasks 1, 4), body + provider/model/priority prefill (Tasks 3, 5), strict placeholders (Task 3), picker with Blank + zero-template fallback (Tasks 6, 7, 8, 9), engine-owned generated regions (Task 5 `GENERATED_REGIONS_TAIL`), invalid provider/model fallback + Notice (Tasks 3, 5), scaffold command (Tasks 5, 8), equal-folder warning (Task 10), non-regression for the Blank path (Task 5 seam test). All spec acceptance criteria map to a task.
- **Type consistency:** `WorkOrderTemplate`, `TemplateChoice`, `TemplateVars`, `ProviderModelValidators`, `CreateWorkOrderOptions.template`, and `FrontmatterArgs` are defined once and reused. `buildTemplateChoices` lives only in `templateResolution.ts`; the modal imports it.
- **Boundaries:** `commands/` and `templates/` never import `ui/`; `ui/` imports `commands/` and `templates/` one-directionally (no cycles). `templates/` stays provider-agnostic except via injected validators; `createWorkOrderFromSeed` supplies `ProviderRegistry`-backed validators.
