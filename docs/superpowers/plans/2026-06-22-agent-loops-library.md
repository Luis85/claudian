# Agent Loops Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agent-loops library to the Agent Board — reusable playbooks (Use when / Approach / Steps / Verify / Notes) attachable to a work order or template and injected into the rendered task prompt at run time.

**Architecture:** A new `src/features/tasks/loops/` slice mirrors the existing `templates/` subsystem: a typed Markdown note (`type: claudian-loop`), a `LoopNoteStore` (parse/build/list/save/delete), bundled `presetLoops` + installer, and a `LoopCatalog` resolver. Work orders and templates gain an optional `loop` frontmatter slug. At run time `AgentBoardView`'s existing `renderPrompt` closure resolves the slug to a `LoopDefinition` and threads it into `renderTaskPrompt`, which appends a `## Loop: <name>` block. UI mirrors the template picker/editor modals plus a properties-panel chip and a settings install button.

**Tech Stack:** TypeScript, Obsidian plugin API (`Vault`, `Modal`, `Setting`), Jest (unit + integration projects), the project's i18n union-key system.

**Reference spec:** `docs/superpowers/specs/2026-06-22-agent-loops-library-design.md`

**Conventions to honor (from CLAUDE.md):** no `console.*`; no `innerHTML`/`outerHTML`/`insertAdjacentHTML` (build DOM with `createEl`/`createDiv`/`createSpan`/`setText`); comment *why*, not *what*; tests mirror `src/` under `tests/unit/`. After each task run the relevant `npm run test -- --selectProjects unit` slice; run the full `npm run typecheck && npm run lint && npm run test && npm run build` at the end.

---

## File Structure

**New files (`src/features/tasks/loops/`):**
- `loopTypes.ts` — `LoopDefinition`, `SaveLoopInput` interfaces.
- `LoopNoteStore.ts` — parse/build/list/save/delete for `claudian-loop` notes.
- `presetLoops.ts` — bundled curated loops (`SaveLoopInput[]`).
- `installPresetLoops.ts` — install presets into the loop folder with a Notice.
- `LoopCatalog.ts` — `listLoops()` / `resolveLoop(id)`.

**New UI files (`src/features/tasks/ui/`):**
- `LoopEditorModal.ts` — author/edit a loop note.
- `LoopPickerModal.ts` — browse/select/manage loops; `chooseLoop(plugin, current)`.

**Modified:**
- `src/core/types/settings.ts` — `+ agentBoardLoopFolder: string`.
- `src/app/settings/defaultSettings.ts` — `+ agentBoardLoopFolder: 'Agent Board/loops'`.
- `src/features/tasks/model/taskTypes.ts` — `TaskFrontmatter` `+ loop?: string`.
- `src/features/tasks/storage/TaskNoteStore.ts` — `WriteFieldsOptions` `+ loop?`; `writeFields` writes/clears it.
- `src/features/tasks/templates/templateTypes.ts` — `WorkOrderTemplate` `+ loop?`.
- `src/features/tasks/templates/TemplateNoteStore.ts` — `SaveTemplateInput` `+ loop?`; parse + build round-trip `loop`.
- `src/features/tasks/commands/taskCommands.ts` — `FrontmatterArgs` `+ loop?`; emit `loop:`; `WORK_ORDER_MARKDOWN_BUILDERS.fromTemplate` passes loop.
- `src/features/tasks/commands/workOrderResolution.ts` — `fromTemplate` builder arg `+ loop?`; pass `template.loop`.
- `src/features/tasks/prompt/TaskPromptRenderer.ts` — `renderTaskPrompt(task, lane?, loop?)` + loop block.
- `src/features/tasks/ui/AgentBoardView.ts` — resolve loop in `renderPrompt`; `LoopCatalog` instance.
- `src/features/tasks/ui/WorkOrderDetailModal.ts` — `WorkOrderFieldUpdate` `+ loop?`; callbacks supply loop options.
- `src/features/tasks/ui/workOrderPropertiesPanel.ts` — Loop chip row.
- `src/features/tasks/ui/WorkOrderTemplateEditorModal.ts` — Loop selector.
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — loop folder setting + install button.
- `src/i18n/types/tasks.ts` + `src/i18n/types/settings.ts` (or wherever the keys are typed) + `src/i18n/locales/*.json` — new keys.
- `CLAUDE.md` + `src/features/tasks/CLAUDE.md` — storage/doc updates.

---

## Task 1: Loop types + `LoopNoteStore` (parse/build/list)

**Files:**
- Create: `src/features/tasks/loops/loopTypes.ts`
- Create: `src/features/tasks/loops/LoopNoteStore.ts`
- Test: `tests/unit/features/tasks/loops/LoopNoteStore.test.ts`

- [ ] **Step 1: Create the types**

`src/features/tasks/loops/loopTypes.ts`:

```ts
export interface LoopDefinition {
  path: string;
  /** Slug derived from the filename; the value stored in `loop` frontmatter. */
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Selection guidance shown in the picker only — never injected at run time. */
  useWhen: string;
  approach: string;
  steps: string;
  verify: string;
  notes: string;
}

export interface SaveLoopInput {
  name: string;
  description?: string;
  icon?: string;
  useWhen: string;
  approach: string;
  steps: string;
  verify: string;
  notes: string;
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/features/tasks/loops/LoopNoteStore.test.ts`:

```ts
import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';

const store = new LoopNoteStore();

const VALID = `---
type: claudian-loop
schema_version: 1
name: "Reproduce then fix"
description: "Tight bug-fix loop."
icon: bug
---
## Use when

A defect is reproducible.

## Approach

Reproduce, isolate, fix narrowly, prove it.

## Steps

1. Reproduce.
2. Fix.

## Verify

The failing check passes.

## Notes

Do not refactor adjacent code.
`;

describe('LoopNoteStore.parse', () => {
  it('parses frontmatter and all body sections', () => {
    const loop = store.parse('Agent Board/loops/reproduce-then-fix.md', VALID);
    expect(loop.id).toBe('reproduce-then-fix');
    expect(loop.name).toBe('Reproduce then fix');
    expect(loop.description).toBe('Tight bug-fix loop.');
    expect(loop.icon).toBe('bug');
    expect(loop.useWhen).toBe('A defect is reproducible.');
    expect(loop.approach).toBe('Reproduce, isolate, fix narrowly, prove it.');
    expect(loop.steps).toBe('1. Reproduce.\n2. Fix.');
    expect(loop.verify).toBe('The failing check passes.');
    expect(loop.notes).toBe('Do not refactor adjacent code.');
  });

  it('rejects a wrong type', () => {
    const bad = VALID.replace('claudian-loop', 'something-else');
    expect(() => store.parse('x.md', bad)).toThrow('Invalid loop type');
  });

  it('rejects an unsupported schema_version', () => {
    const bad = VALID.replace('schema_version: 1', 'schema_version: 2');
    expect(() => store.parse('x.md', bad)).toThrow('Unsupported loop schema_version');
  });

  it('tolerates missing optional sections', () => {
    const minimal = `---
type: claudian-loop
schema_version: 1
name: "Only approach"
---
## Approach

Just do the thing.
`;
    const loop = store.parse('Agent Board/loops/only-approach.md', minimal);
    expect(loop.approach).toBe('Just do the thing.');
    expect(loop.useWhen).toBe('');
    expect(loop.steps).toBe('');
    expect(loop.verify).toBe('');
    expect(loop.notes).toBe('');
    expect(loop.description).toBeUndefined();
  });
});

describe('LoopNoteStore.build', () => {
  it('round-trips through parse', () => {
    const md = store.build({
      name: 'Reproduce then fix',
      description: 'Tight bug-fix loop.',
      icon: 'bug',
      useWhen: 'A defect is reproducible.',
      approach: 'Reproduce, isolate, fix narrowly, prove it.',
      steps: '1. Reproduce.\n2. Fix.',
      verify: 'The failing check passes.',
      notes: 'Do not refactor adjacent code.',
    });
    const loop = store.parse('Agent Board/loops/reproduce-then-fix.md', md);
    expect(loop.name).toBe('Reproduce then fix');
    expect(loop.approach).toBe('Reproduce, isolate, fix narrowly, prove it.');
    expect(loop.notes).toBe('Do not refactor adjacent code.');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern LoopNoteStore`
Expected: FAIL — cannot find module `LoopNoteStore`.

- [ ] **Step 4: Implement `LoopNoteStore`**

`src/features/tasks/loops/LoopNoteStore.ts` (mirrors `TemplateNoteStore`; section extraction mirrors `TaskNoteStore.extractSection`):

```ts
import type { App, Vault } from 'obsidian';
import { normalizePath, TFile } from 'obsidian';

import { extractString, parseFrontmatter } from '../../../utils/frontmatter';
import type { LoopDefinition, SaveLoopInput } from './loopTypes';

const SECTION_HEADINGS = Object.freeze({
  useWhen: 'Use when',
  approach: 'Approach',
  steps: 'Steps',
  verify: 'Verify',
  notes: 'Notes',
});

function fileBaseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractSection(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const headingPattern = /^##\s+(.+?)\s*$/;
  const sectionLines: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match) {
      if (inSection) break;
      inSection = match[1] === heading;
      continue;
    }
    if (inSection) sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

export class LoopNoteStore {
  parse(path: string, content: string): LoopDefinition {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      throw new Error('Missing YAML frontmatter');
    }
    if (parsed.frontmatter.type !== 'claudian-loop') {
      throw new Error('Invalid loop type');
    }
    if (parsed.frontmatter.schema_version !== 1) {
      throw new Error('Unsupported loop schema_version');
    }

    return {
      path,
      id: slugify(extractString(parsed.frontmatter, 'name') ?? fileBaseName(path)) || fileBaseName(path),
      name: extractString(parsed.frontmatter, 'name') ?? fileBaseName(path),
      description: extractString(parsed.frontmatter, 'description'),
      icon: extractString(parsed.frontmatter, 'icon'),
      useWhen: extractSection(parsed.body, SECTION_HEADINGS.useWhen),
      approach: extractSection(parsed.body, SECTION_HEADINGS.approach),
      steps: extractSection(parsed.body, SECTION_HEADINGS.steps),
      verify: extractSection(parsed.body, SECTION_HEADINGS.verify),
      notes: extractSection(parsed.body, SECTION_HEADINGS.notes),
    };
  }

  build(input: SaveLoopInput): string {
    const lines: string[] = [
      '---',
      'type: claudian-loop',
      'schema_version: 1',
      `name: ${JSON.stringify(input.name)}`,
    ];
    if (input.description) lines.push(`description: ${JSON.stringify(input.description)}`);
    if (input.icon) lines.push(`icon: ${JSON.stringify(input.icon)}`);
    lines.push('---', '');
    const section = (heading: string, value: string): void => {
      if (value.trim()) lines.push(`## ${heading}`, '', value.trim(), '');
    };
    section(SECTION_HEADINGS.useWhen, input.useWhen);
    section(SECTION_HEADINGS.approach, input.approach);
    section(SECTION_HEADINGS.steps, input.steps);
    section(SECTION_HEADINGS.verify, input.verify);
    section(SECTION_HEADINGS.notes, input.notes);
    return lines.join('\n');
  }

  async list(vault: Vault, folder: string): Promise<{ loops: LoopDefinition[]; warnings: string[] }> {
    const normalized = normalizeFolder(folder);
    const loops: LoopDefinition[] = [];
    const warnings: string[] = [];
    const files = vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalized}/`));
    for (const file of files) {
      try {
        loops.push(this.parse(file.path, await vault.read(file)));
      } catch (error) {
        warnings.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    loops.sort((a, b) => a.name.localeCompare(b.name));
    return { loops, warnings };
  }

  getFilePathForName(folder: string, name: string): string {
    const slug = slugify(name) || 'loop';
    return normalizePath(`${normalizeFolder(folder)}/${slug}.md`);
  }

  async save(vault: Vault, folder: string, input: SaveLoopInput, originalPath?: string): Promise<string> {
    const content = this.build(input);
    if (originalPath) {
      const existing = vault.getAbstractFileByPath(originalPath);
      if (existing instanceof TFile) {
        await vault.modify(existing, content);
        return originalPath;
      }
    }
    const normalized = normalizePath(normalizeFolder(folder));
    if (!vault.getAbstractFileByPath(normalized)) {
      await vault.createFolder(normalized);
    }
    const filePath = this.getFilePathForName(normalized, input.name);
    await vault.create(filePath, content);
    return filePath;
  }

  async delete(app: App, path: string): Promise<void> {
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      await app.fileManager.trashFile(file);
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern LoopNoteStore`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/loops/loopTypes.ts src/features/tasks/loops/LoopNoteStore.ts tests/unit/features/tasks/loops/LoopNoteStore.test.ts
git commit -m "feat(tasks): add loop definition types and LoopNoteStore"
```

---

## Task 2: Preset loops + installer

**Files:**
- Create: `src/features/tasks/loops/presetLoops.ts`
- Create: `src/features/tasks/loops/installPresetLoops.ts`
- Test: `tests/unit/features/tasks/loops/installPresetLoops.test.ts`

- [ ] **Step 1: Create the preset loops**

`src/features/tasks/loops/presetLoops.ts`:

```ts
import type { SaveLoopInput } from './loopTypes';

export const PRESET_LOOPS: SaveLoopInput[] = [
  {
    name: 'Reproduce → fix → verify',
    description: 'Tight bug-fix loop with a verify gate.',
    icon: 'bug',
    useWhen: 'A defect is reproducible and you need a disciplined, minimal fix.',
    approach: 'Reproduce the defect first, isolate the root cause, apply the smallest fix, then prove it with the same check that first failed.',
    steps: '1. Reproduce the defect with a failing check.\n2. Isolate the root cause; state it in one sentence.\n3. Apply the smallest fix that addresses the root cause.\n4. Re-run the check and the surrounding tests.',
    verify: 'The previously failing check now passes and no unrelated tests regress.',
    notes: 'Do not refactor adjacent code in the same loop. If the root cause is unclear after two passes, stop and report what you ruled out.',
  },
  {
    name: 'Characterize → refactor',
    description: 'Refactor safely behind a characterization test.',
    icon: 'wrench',
    useWhen: 'You must change the structure of code that lacks tests, without changing behavior.',
    approach: 'Pin current behavior with a characterization test, refactor in small steps, and keep the test green throughout.',
    steps: '1. Write a characterization test that captures current observable behavior.\n2. Confirm it passes against the unchanged code.\n3. Refactor in small, reversible steps.\n4. Re-run the test after each step.',
    verify: 'The characterization test stays green and no public API changes.',
    notes: 'Commit after each green step so any regression is bisectable.',
  },
  {
    name: 'Research spike',
    description: 'Time-boxed investigation, no production code.',
    icon: 'search',
    useWhen: 'A question must be answered before committing to an approach.',
    approach: 'State the question precisely, survey options against sources, and end with a written recommendation.',
    steps: '1. Restate the question in one sentence.\n2. Survey at least two viable options.\n3. Capture trade-offs with sources.\n4. Recommend one option and say why.',
    verify: 'A written summary exists with a clear recommendation and cited sources.',
    notes: 'No production code changes. Cite every claim.',
  },
  {
    name: 'Test backfill',
    description: 'Add tests for under-covered code without changing behavior.',
    icon: 'flask-conical',
    useWhen: 'A unit has too little coverage and you need a safety net before further change.',
    approach: 'List the coverage gaps, then write happy-path and edge-case tests against the existing behavior.',
    steps: '1. Identify the uncovered branches.\n2. Write happy-path tests first.\n3. Add edge-case and error-path tests.\n4. Run the suite and confirm all new tests pass.',
    verify: 'New tests pass and exercise the previously uncovered branches; no production behavior changed.',
    notes: 'Only touch production code if it is untestable as written, and say so explicitly.',
  },
];
```

- [ ] **Step 2: Write the failing test**

`tests/unit/features/tasks/loops/installPresetLoops.test.ts`:

```ts
import { installPresetLoops } from '../../../../../src/features/tasks/loops/installPresetLoops';
import { PRESET_LOOPS } from '../../../../../src/features/tasks/loops/presetLoops';

function makePlugin() {
  const created = new Map<string, string>();
  const folders = new Set<string>();
  const vault = {
    getAbstractFileByPath: (p: string) => (created.has(p) || folders.has(p) ? ({ path: p }) : null),
    createFolder: async (p: string) => { folders.add(p); },
    create: async (p: string, c: string) => { created.set(p, c); return { path: p }; },
  };
  return { plugin: { app: { vault }, settings: { agentBoardLoopFolder: 'Agent Board/loops' } } as never, created };
}

describe('installPresetLoops', () => {
  it('installs every preset on a clean vault', async () => {
    const { plugin, created } = makePlugin();
    const result = await installPresetLoops(plugin);
    expect(result.installed).toBe(PRESET_LOOPS.length);
    expect(result.skipped).toBe(0);
    expect(created.size).toBe(PRESET_LOOPS.length);
  });

  it('skips loops that already exist', async () => {
    const { plugin } = makePlugin();
    await installPresetLoops(plugin);
    const second = await installPresetLoops(plugin);
    expect(second.installed).toBe(0);
    expect(second.skipped).toBe(PRESET_LOOPS.length);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern installPresetLoops`
Expected: FAIL — cannot find module `installPresetLoops`.

- [ ] **Step 4: Implement the installer**

`src/features/tasks/loops/installPresetLoops.ts` (mirrors `installPresetTemplates`):

```ts
import { normalizePath, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { LoopNoteStore } from './LoopNoteStore';
import { PRESET_LOOPS } from './presetLoops';

export interface InstallPresetLoopsResult {
  installed: number;
  skipped: number;
  folder: string;
}

function normalizeFolder(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export async function installPresetLoops(plugin: ClaudianPlugin): Promise<InstallPresetLoopsResult> {
  const folder = normalizePath(normalizeFolder(plugin.settings.agentBoardLoopFolder || 'Agent Board/loops'));
  const store = new LoopNoteStore();
  const vault = plugin.app.vault;

  if (!vault.getAbstractFileByPath(folder)) {
    await vault.createFolder(folder);
  }

  let installed = 0;
  let skipped = 0;
  for (const preset of PRESET_LOOPS) {
    const path = store.getFilePathForName(folder, preset.name);
    if (vault.getAbstractFileByPath(path)) {
      skipped += 1;
      continue;
    }
    await vault.create(path, store.build(preset));
    installed += 1;
  }
  return { installed, skipped, folder };
}

export async function installPresetLoopsWithNotice(plugin: ClaudianPlugin): Promise<void> {
  const result = await installPresetLoops(plugin);
  const parts: string[] = [];
  if (result.installed > 0) parts.push(`installed ${result.installed}`);
  if (result.skipped > 0) parts.push(`skipped ${result.skipped} already present`);
  const summary = parts.join(', ');
  new Notice(summary
    ? t('settings.agentBoard.commonLoops', { loops: summary })
    : t('settings.agentBoard.commonLoopsEmpty'));
}
```

> Note: `t('settings.agentBoard.commonLoops')` / `commonLoopsEmpty` keys are added in Task 13. The import will typecheck once those union members exist; if running this task standalone before Task 13, temporarily reuse `commonTemplates`/`commonTemplatesEmpty` and switch in Task 13.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern installPresetLoops`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/loops/presetLoops.ts src/features/tasks/loops/installPresetLoops.ts tests/unit/features/tasks/loops/installPresetLoops.test.ts
git commit -m "feat(tasks): add preset loops and installer"
```

---

## Task 3: `LoopCatalog` (list + resolve)

**Files:**
- Create: `src/features/tasks/loops/LoopCatalog.ts`
- Test: `tests/unit/features/tasks/loops/LoopCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/features/tasks/loops/LoopCatalog.test.ts`:

```ts
import { LoopCatalog } from '../../../../../src/features/tasks/loops/LoopCatalog';
import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';

function vaultWith(files: Record<string, string>) {
  const store = new LoopNoteStore();
  return {
    getMarkdownFiles: () => Object.keys(files).map((path) => ({ path })),
    read: async (file: { path: string }) => files[file.path],
    _store: store,
  } as never;
}

const LOOP_A = new LoopNoteStore().build({
  name: 'Alpha loop', useWhen: 'a', approach: 'do a', steps: '', verify: '', notes: '',
});

describe('LoopCatalog', () => {
  it('resolves a known slug to its definition', async () => {
    const vault = vaultWith({ 'Agent Board/loops/alpha-loop.md': LOOP_A });
    const catalog = new LoopCatalog(vault, () => 'Agent Board/loops');
    const loop = await catalog.resolveLoop('alpha-loop');
    expect(loop?.name).toBe('Alpha loop');
  });

  it('resolves an unknown slug to null', async () => {
    const vault = vaultWith({ 'Agent Board/loops/alpha-loop.md': LOOP_A });
    const catalog = new LoopCatalog(vault, () => 'Agent Board/loops');
    expect(await catalog.resolveLoop('missing')).toBeNull();
    expect(await catalog.resolveLoop(undefined)).toBeNull();
    expect(await catalog.resolveLoop('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern LoopCatalog`
Expected: FAIL — cannot find module `LoopCatalog`.

- [ ] **Step 3: Implement `LoopCatalog`**

`src/features/tasks/loops/LoopCatalog.ts`:

```ts
import type { Vault } from 'obsidian';

import type { LoopDefinition } from './loopTypes';
import { LoopNoteStore } from './LoopNoteStore';

/**
 * Reads loop notes from the configured folder. `folder` is a getter so a live
 * settings change is picked up without re-instantiating the catalog.
 */
export class LoopCatalog {
  private readonly store = new LoopNoteStore();

  constructor(
    private readonly vault: Vault,
    private readonly folder: () => string,
  ) {}

  async listLoops(): Promise<LoopDefinition[]> {
    const { loops } = await this.store.list(this.vault, this.folder());
    return loops;
  }

  /** Resolve a stored slug to its definition; an unknown/empty slug yields null. */
  async resolveLoop(id: string | undefined | null): Promise<LoopDefinition | null> {
    if (!id) return null;
    const loops = await this.listLoops();
    return loops.find((loop) => loop.id === id) ?? null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern LoopCatalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/loops/LoopCatalog.ts tests/unit/features/tasks/loops/LoopCatalog.test.ts
git commit -m "feat(tasks): add LoopCatalog list/resolve"
```

---

## Task 4: Work-order `loop` frontmatter (model + writer)

**Files:**
- Modify: `src/features/tasks/model/taskTypes.ts`
- Modify: `src/features/tasks/storage/TaskNoteStore.ts:50-57` (WriteFieldsOptions) and `:166-185` (writeFields)
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts:13-20` (WorkOrderFieldUpdate)
- Test: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts` (add cases)

- [ ] **Step 1: Add `loop?` to the model**

In `src/features/tasks/model/taskTypes.ts`, inside `TaskFrontmatter` (after `model?: string;`):

```ts
  /** Optional attached loop slug; resolved through LoopCatalog at run time. */
  loop?: string;
```

> No change to `TaskNoteStore.parse` is needed — it spreads `...parsed.frontmatter`, so an existing `loop` key is already carried through. This step only makes it type-safe to read `task.frontmatter.loop`.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`:

```ts
describe('TaskNoteStore.writeFields loop', () => {
  const store = new TaskNoteStore();
  const base = `---
type: claudian-work-order
schema_version: 1
id: task-1
title: "T"
status: inbox
priority: 2 - normal
created: 2026-06-22
updated: 2026-06-22
attempts: 0
---
# T

## Objective

x
`;

  it('writes a loop slug', () => {
    const out = store.writeFields(base, { loop: 'reproduce-then-fix' }, '2026-06-23');
    expect(out).toContain('loop: reproduce-then-fix');
  });

  it('clears the loop when given an empty string', () => {
    const withLoop = store.writeFields(base, { loop: 'reproduce-then-fix' }, '2026-06-23');
    const cleared = store.writeFields(withLoop, { loop: '' }, '2026-06-24');
    expect(cleared).not.toContain('loop:');
  });
});
```

(If the test file imports `TaskNoteStore` differently, match the existing import at the top of that file.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern TaskNoteStore`
Expected: FAIL — `loop` not written (type error on `WriteFieldsOptions.loop`).

- [ ] **Step 4: Extend `WriteFieldsOptions` and `writeFields`**

In `src/features/tasks/storage/TaskNoteStore.ts`, add to `WriteFieldsOptions` (after `priority?: TaskPriority;`):

```ts
  /** Loop slug to attach; pass an empty string to detach. */
  loop?: string;
```

In `writeFields`, after the `if (fields.priority !== undefined) ...` line and before `frontmatter.updated = timestamp;`:

```ts
    if (fields.loop !== undefined) {
      if (fields.loop) frontmatter.loop = fields.loop;
      else delete frontmatter.loop;
    }
```

- [ ] **Step 5: Extend `WorkOrderFieldUpdate`**

In `src/features/tasks/ui/WorkOrderDetailModal.ts`, add to `WorkOrderFieldUpdate` (after `priority?: TaskPriority;`):

```ts
  /** Attached loop slug; empty string detaches. */
  loop?: string;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern TaskNoteStore`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/model/taskTypes.ts src/features/tasks/storage/TaskNoteStore.ts src/features/tasks/ui/WorkOrderDetailModal.ts tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "feat(tasks): persist optional loop slug on work-order frontmatter"
```

---

## Task 5: Template `loop` field + template→work-order flow

**Files:**
- Modify: `src/features/tasks/templates/templateTypes.ts`
- Modify: `src/features/tasks/templates/TemplateNoteStore.ts` (SaveTemplateInput, parse, build)
- Modify: `src/features/tasks/commands/taskCommands.ts` (FrontmatterArgs, workOrderFrontmatter, fromTemplate builder)
- Modify: `src/features/tasks/commands/workOrderResolution.ts` (fromTemplate arg)
- Test: `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`:

```ts
describe('TemplateNoteStore loop field', () => {
  const store = new TemplateNoteStore();

  it('round-trips a loop slug through build and parse', () => {
    const md = store.build({ name: 'T', loop: 'reproduce-then-fix', body: '# T' });
    expect(md).toContain('loop: "reproduce-then-fix"');
    const parsed = store.parse('Agent Board/templates/t.md', md);
    expect(parsed.loop).toBe('reproduce-then-fix');
  });

  it('omits loop when absent', () => {
    const md = store.build({ name: 'T', body: '# T' });
    expect(md).not.toContain('loop:');
    expect(store.parse('Agent Board/templates/t.md', md).loop).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern TemplateNoteStore`
Expected: FAIL — `loop` not on `SaveTemplateInput` / not parsed.

- [ ] **Step 3: Extend template types + store**

In `src/features/tasks/templates/templateTypes.ts`, add to `WorkOrderTemplate` (after `priority?: TaskPriority;`):

```ts
  loop?: string;
```

In `src/features/tasks/templates/TemplateNoteStore.ts`:

Add to `SaveTemplateInput` (after `priority?: TaskPriority;`):

```ts
  loop?: string;
```

In `parse(...)`, add to the returned object (after `priority,`):

```ts
      loop: extractString(parsed.frontmatter, 'loop'),
```

In `build(...)`, after the `if (input.priority) ...` line:

```ts
    if (input.loop) lines.push(`loop: ${JSON.stringify(input.loop)}`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern TemplateNoteStore`
Expected: PASS.

- [ ] **Step 5: Carry `template.loop` onto the created work order**

In `src/features/tasks/commands/workOrderResolution.ts`, extend the `WorkOrderMarkdownBuilders.fromTemplate` arg type (add after `body: string;`):

```ts
    loop?: string;
```

In `buildWorkOrderMarkdownForSeed`, in the `builders.fromTemplate({ ... })` call (after `body: rendered.body,`):

```ts
    loop: template.loop,
```

In `src/features/tasks/commands/taskCommands.ts`:

Add to `FrontmatterArgs` (after `conversationId?: string | null;`):

```ts
  loop?: string;
```

In `workOrderFrontmatter`, build the optional line. Replace the `return` template so a `loop:` line is appended only when present — insert before `sidepanel_tab_id:`:

```ts
function workOrderFrontmatter(args: FrontmatterArgs): string {
  const conversationLine = args.conversationId
    ? `conversation_id: ${JSON.stringify(args.conversationId)}`
    : 'conversation_id:';
  const loopLine = args.loop ? `\nloop: ${JSON.stringify(args.loop)}` : '';
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
${conversationLine}${loopLine}
sidepanel_tab_id:
started:
finished:
attempts: 0
---`;
}
```

`buildWorkOrderFromTemplate(args: FrontmatterArgs & { body: string })` already spreads `args` into `workOrderFrontmatter`, so `loop` flows through automatically once `FrontmatterArgs` carries it.

- [ ] **Step 6: Run the affected suites**

Run: `npm run test -- --selectProjects unit --testPathPattern "TemplateNoteStore|taskCommands"`
Expected: PASS. (If a `taskCommands` snapshot/string test asserts exact frontmatter, confirm it still matches — `loop` only appears when set.)

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/templates/templateTypes.ts src/features/tasks/templates/TemplateNoteStore.ts src/features/tasks/commands/taskCommands.ts src/features/tasks/commands/workOrderResolution.ts tests/unit/features/tasks/templates/TemplateNoteStore.test.ts
git commit -m "feat(tasks): carry template loop onto created work orders"
```

---

## Task 6: Prompt injection

**Files:**
- Modify: `src/features/tasks/prompt/TaskPromptRenderer.ts`
- Test: `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts` (reuse the test file's existing helper for building a `TaskSpec`; if none, construct one inline matching `TaskSpec`):

```ts
import type { LoopDefinition } from '../../../../../src/features/tasks/loops/loopTypes';

const LOOP: LoopDefinition = {
  path: 'Agent Board/loops/repro.md',
  id: 'repro',
  name: 'Repro loop',
  useWhen: 'SHOULD-NOT-APPEAR-IN-PROMPT',
  approach: 'Reproduce first.',
  steps: '1. Repro.',
  verify: 'Check passes.',
  notes: 'Be careful.',
};

function minimalTask() {
  return {
    path: 'wo.md',
    frontmatter: {
      type: 'claudian-work-order', schema_version: 1, id: 'task-1', title: 'T',
      status: 'ready', priority: '2 - normal', created: '', updated: '', attempts: 0,
    },
    sections: { objective: 'o', acceptanceCriteria: 'a', context: 'c', constraints: 'k', ledger: '', handoff: '' },
    body: '', raw: '',
  } as never;
}

describe('renderTaskPrompt loop injection', () => {
  it('injects the loop block with approach/steps/verify/notes', () => {
    const out = renderTaskPrompt(minimalTask(), undefined, LOOP);
    expect(out).toContain('## Loop: Repro loop');
    expect(out).toContain('### Approach\nReproduce first.');
    expect(out).toContain('### Steps\n1. Repro.');
    expect(out).toContain('### Verify\nCheck passes.');
    expect(out).toContain('### Notes\nBe careful.');
  });

  it('never injects the Use when text', () => {
    const out = renderTaskPrompt(minimalTask(), undefined, LOOP);
    expect(out).not.toContain('SHOULD-NOT-APPEAR-IN-PROMPT');
  });

  it('is unchanged when no loop is supplied', () => {
    const withLoop = renderTaskPrompt(minimalTask(), undefined, LOOP);
    const without = renderTaskPrompt(minimalTask(), undefined);
    expect(without).not.toContain('## Loop:');
    expect(withLoop.length).toBeGreaterThan(without.length);
  });

  it('escapes claudian markers in loop content', () => {
    const evil: LoopDefinition = { ...LOOP, approach: 'do <claudian_handoff> now' };
    const out = renderTaskPrompt(minimalTask(), undefined, evil);
    expect(out).toContain('`<claudian_handoff>`');
  });

  it('omits empty sub-sections', () => {
    const sparse: LoopDefinition = { ...LOOP, steps: '', verify: '', notes: '' };
    const out = renderTaskPrompt(minimalTask(), undefined, sparse);
    expect(out).toContain('### Approach');
    expect(out).not.toContain('### Steps');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern TaskPromptRenderer`
Expected: FAIL — `renderTaskPrompt` ignores the third arg.

- [ ] **Step 3: Implement the loop block**

In `src/features/tasks/prompt/TaskPromptRenderer.ts`:

Add the import at the top (with the other type imports):

```ts
import type { LoopDefinition } from '../loops/loopTypes';
```

Add a builder above `renderTaskPrompt`:

```ts
/**
 * Render the attached loop as a `## Loop` block. `useWhen` is selection-only
 * guidance and is deliberately never injected. All values are escaped against
 * protocol-marker injection, identical to the work-order sections.
 */
function renderLoopBlock(loop?: LoopDefinition): string {
  if (!loop) return '';
  const parts: string[] = [
    `\n\n## Loop: ${escapeClaudianMarkers(loop.name)}`,
    'You are following a predefined loop. Apply its approach, work the steps, and satisfy its verify condition before handing off.',
  ];
  const sub = (heading: string, value: string): void => {
    const escaped = escapeClaudianMarkers(value).trim();
    if (escaped) parts.push(`\n### ${heading}\n${escaped}`);
  };
  sub('Approach', loop.approach);
  sub('Steps', loop.steps);
  sub('Verify', loop.verify);
  sub('Notes', loop.notes);
  return parts.join('\n');
}
```

Change the signature:

```ts
export function renderTaskPrompt(
  task: TaskSpec,
  lane?: TaskPromptLaneCriteria,
  loop?: LoopDefinition,
): string {
```

Compute the block (near the `priorAttempts` line):

```ts
  const loopBlock = renderLoopBlock(loop);
```

Inject it into the returned template — change the Constraints line from:

```ts
${constraints}${dor}${dod}${reworkNotes}${priorAttempts}
```

to:

```ts
${constraints}${dor}${dod}${reworkNotes}${priorAttempts}${loopBlock}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern TaskPromptRenderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/prompt/TaskPromptRenderer.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
git commit -m "feat(tasks): inject attached loop into the task prompt"
```

---

## Task 7: Settings field — `agentBoardLoopFolder`

**Files:**
- Modify: `src/core/types/settings.ts:211` (interface)
- Modify: `src/app/settings/defaultSettings.ts:73`

- [ ] **Step 1: Add the interface field**

In `src/core/types/settings.ts`, directly after `agentBoardTemplateFolder: string;`:

```ts
  agentBoardLoopFolder: string;
```

- [ ] **Step 2: Add the default**

In `src/app/settings/defaultSettings.ts`, directly after `agentBoardTemplateFolder: 'Agent Board/templates',`:

```ts
  agentBoardLoopFolder: 'Agent Board/loops',
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no other consumer requires the field yet; UI tasks below use it).

- [ ] **Step 4: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts
git commit -m "feat(tasks): add agentBoardLoopFolder setting"
```

---

## Task 8: `AgentBoardView` — resolve loop into the prompt + supply loop options

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts` (renderPrompt closure; add `LoopCatalog`; loop options for the modal)

- [ ] **Step 1: Make the prompt renderer async-resolve the loop**

`renderPrompt` is currently synchronous (`TaskRunCoordinator.ts:125` calls `(this.deps.renderPrompt ?? renderTaskPrompt)(task)`). Confirm whether `renderPrompt` may return a Promise. Inspect `RunSessionDeps`/`TaskRunCoordinator` for the `renderPrompt` type:

Run: `npm run test -- --selectProjects unit --testPathPattern TaskRunCoordinator` first to capture the baseline, then read `src/features/tasks/execution/TaskRunCoordinator.ts` around the `renderPrompt` dep and `RunSession.ts` where the prompt is awaited.

- If `renderPrompt`'s result is already `await`ed downstream, change its type to `(task: TaskSpec) => string | Promise<string>` and make the closure `async`.
- If it is used synchronously, instead pre-resolve loops into a cache the closure can read synchronously. **Preferred simpler path:** make the dep async — `startTaskRun` is already `await`ed.

Apply (in `AgentBoardView.ts`, replacing the existing `renderPrompt` closure at ~line 124):

```ts
      renderPrompt: async (task) =>
        renderTaskPrompt(
          task,
          getLaneForStatus(this.config, task.frontmatter.status) ?? undefined,
          (await this.loopCatalog.resolveLoop(task.frontmatter.loop)) ?? undefined,
        ),
```

Add a `loopCatalog` field on `AgentBoardView` (near the other stores), initialized in the constructor/`onOpen` where `this.config` and settings are available:

```ts
  private readonly loopCatalog = new LoopCatalog(
    this.plugin.app.vault,
    () => this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops',
  );
```

Add the import:

```ts
import { LoopCatalog } from '../loops/LoopCatalog';
```

Update the `renderPrompt` dep type wherever it is declared (`TaskRunCoordinator` deps and `RunSession` deps) to `(task: TaskSpec) => string | Promise<string>`, and ensure the call site `await`s it:

In `TaskRunCoordinator.ts` change:

```ts
const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
```

to:

```ts
const prompt = await (this.deps.renderPrompt ?? renderTaskPrompt)(task);
```

(The enclosing method is already `async`.)

- [ ] **Step 2: Run the run-coordinator + board suites**

Run: `npm run test -- --selectProjects unit --testPathPattern "TaskRunCoordinator|AgentBoardView"`
Expected: PASS. Fix any test that constructs the coordinator with a synchronous `renderPrompt` mock — a sync function still satisfies `string | Promise<string>`, so existing mocks remain valid.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts src/features/tasks/execution/TaskRunCoordinator.ts src/features/tasks/execution/RunSession.ts
git commit -m "feat(tasks): resolve attached loop when rendering the task prompt"
```

---

## Task 9: `LoopEditorModal`

**Files:**
- Create: `src/features/tasks/ui/LoopEditorModal.ts`

> UI modal; covered by manual verification + typecheck/lint rather than a unit test (mirrors `WorkOrderTemplateEditorModal`, which has no unit test).

- [ ] **Step 1: Implement the editor modal**

`src/features/tasks/ui/LoopEditorModal.ts`:

```ts
import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import { addIconPickerRow, addNameAndDescriptionRows } from '../../../shared/settings/nameDescriptionRows';
import type { LoopDefinition, SaveLoopInput } from '../loops/loopTypes';

export interface LoopEditorPayload extends SaveLoopInput {
  originalPath?: string;
}

export class LoopEditorModal extends Modal {
  private iconPicker: LucideIconPicker | null = null;

  constructor(
    app: App,
    private readonly existing: LoopDefinition | null,
    private readonly onSave: (payload: LoopEditorPayload) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const isEdit = Boolean(this.existing);
    this.setTitle(isEdit ? t('tasks.loopEditor.titleEdit') : t('tasks.loopEditor.titleNew'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-loop-editor-modal');

    let name = this.existing?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let useWhen = this.existing?.useWhen ?? '';
    let approach = this.existing?.approach ?? '';
    let steps = this.existing?.steps ?? '';
    let verify = this.existing?.verify ?? '';
    let notes = this.existing?.notes ?? '';

    addNameAndDescriptionRows(this.contentEl, {
      name: {
        name: t('tasks.loopEditor.nameName'),
        desc: t('tasks.loopEditor.nameDesc'),
        value: name,
        onChange: (v) => { name = v; },
        disabled: isEdit,
      },
      description: {
        name: t('tasks.loopEditor.descriptionName'),
        desc: t('tasks.loopEditor.descriptionDesc'),
        value: description,
        onChange: (v) => { description = v; },
      },
    });

    this.iconPicker = addIconPickerRow(this.contentEl, {
      name: t('tasks.loopEditor.iconName'),
      desc: t('tasks.loopEditor.iconDesc'),
      value: icon,
      onChange: (v) => { icon = v; },
    });

    const area = (labelKey: string, descKey: string, value: string, set: (v: string) => void): void => {
      const setting = new Setting(this.contentEl)
        .setName(t(labelKey))
        .setDesc(t(descKey))
        .addTextArea((ta) => {
          ta.setValue(value).onChange(set);
          ta.inputEl.rows = 4;
          ta.inputEl.addClass('claudian-loop-section-input');
        });
      setting.settingEl.addClass('claudian-loop-section-setting');
    };

    area('tasks.loopEditor.useWhenName', 'tasks.loopEditor.useWhenDesc', useWhen, (v) => { useWhen = v; });
    area('tasks.loopEditor.approachName', 'tasks.loopEditor.approachDesc', approach, (v) => { approach = v; });
    area('tasks.loopEditor.stepsName', 'tasks.loopEditor.stepsDesc', steps, (v) => { steps = v; });
    area('tasks.loopEditor.verifyName', 'tasks.loopEditor.verifyDesc', verify, (v) => { verify = v; });
    area('tasks.loopEditor.notesName', 'tasks.loopEditor.notesDesc', notes, (v) => { notes = v; });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(t('tasks.loopEditor.save'))
          .setCta()
          .onClick(() => {
            void this.handleSave({ name, description, icon, useWhen, approach, steps, verify, notes });
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t('tasks.loopEditor.cancel')).onClick(() => this.close());
      });
  }

  onClose(): void {
    this.iconPicker?.destroy();
    this.iconPicker = null;
    this.contentEl.empty();
  }

  private async handleSave(form: SaveLoopInput): Promise<void> {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      new Notice(t('tasks.loop.nameRequired'));
      return;
    }
    if (!form.approach.trim() && !form.steps.trim()) {
      new Notice(t('tasks.loop.bodyRequired'));
      return;
    }

    const payload: LoopEditorPayload = {
      name: trimmedName,
      description: form.description.trim() || undefined,
      icon: form.icon.trim() || undefined,
      useWhen: form.useWhen.trim(),
      approach: form.approach.trim(),
      steps: form.steps.trim(),
      verify: form.verify.trim(),
      notes: form.notes.trim(),
      originalPath: this.existing?.path,
    };

    try {
      await this.onSave(payload);
      this.close();
    } catch (error) {
      new Notice(t('tasks.loop.saveFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/features/tasks/ui/LoopEditorModal.ts`
Expected: PASS. (i18n keys referenced here are added in Task 13; if running standalone, the `t()` union-type will flag unknown keys — proceed to Task 13 to satisfy them, or do Task 13 first.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/LoopEditorModal.ts
git commit -m "feat(tasks): add LoopEditorModal"
```

---

## Task 10: `LoopPickerModal` + `chooseLoop`

**Files:**
- Create: `src/features/tasks/ui/LoopPickerModal.ts`

- [ ] **Step 1: Implement the picker**

`src/features/tasks/ui/LoopPickerModal.ts` (mirrors `WorkOrderTemplatePickerModal`; returns the chosen slug or a clear/cancel):

```ts
import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { LoopNoteStore } from '../loops/LoopNoteStore';
import type { LoopDefinition } from '../loops/loopTypes';
import { LoopEditorModal } from './LoopEditorModal';

const NONE_ICON = 'circle-slash';
const DEFAULT_LOOP_ICON = 'repeat';

export interface LoopPickResult {
  cancelled: boolean;
  /** Chosen loop slug, or '' to explicitly detach ("No loop"). Undefined when cancelled. */
  loopId?: string;
}

export class LoopPickerModal extends Modal {
  private chosen = false;
  private listEl: HTMLElement | null = null;
  private loops: LoopDefinition[] = [];
  private readonly store = new LoopNoteStore();

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private readonly current: string | undefined,
    private readonly resolve: (result: LoopPickResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('tasks.loopPicker.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-loops-modal');

    const body = this.contentEl.createDiv({ cls: 'claudian-loops-body' });
    body.createEl('p', { text: t('tasks.loopPicker.lead') });
    this.listEl = body.createDiv({ cls: 'claudian-loops-list' });

    const footer = this.contentEl.createDiv({ cls: 'claudian-loops-footer' });
    footer.createEl('button', { cls: 'mod-cta', text: t('tasks.loopPicker.newLoop') })
      .addEventListener('click', () => this.openEditor(null));

    void this.refreshList();
  }

  onClose(): void {
    this.contentEl.empty();
    window.setTimeout(() => {
      if (!this.chosen) this.resolve({ cancelled: true });
    }, 0);
  }

  private folder(): string {
    return this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops';
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    this.listEl.empty();
    const { loops } = await this.store.list(this.plugin.app.vault, this.folder());
    this.loops = loops;
    this.renderNoneRow();
    for (const loop of loops) this.renderLoopRow(loop);
  }

  private renderNoneRow(): void {
    if (!this.listEl) return;
    const row = this.listEl.createDiv({ cls: 'claudian-loops-row claudian-loops-row--none' });
    const main = row.createDiv({ cls: 'claudian-loops-main' });
    const iconEl = main.createSpan({ cls: 'claudian-loops-icon' });
    setIcon(iconEl, NONE_ICON);
    const textCol = main.createDiv({ cls: 'claudian-loops-text' });
    textCol.createEl('strong', { text: t('tasks.loopPicker.noneTitle') });
    textCol.createDiv({ cls: 'claudian-loops-desc', text: t('tasks.loopPicker.noneDesc') });
    if (!this.current) row.addClass('is-active');
    main.addEventListener('click', () => this.choose({ cancelled: false, loopId: '' }));
  }

  private renderLoopRow(loop: LoopDefinition): void {
    if (!this.listEl) return;
    const row = this.listEl.createDiv({ cls: 'claudian-loops-row' });
    if (loop.id === this.current) row.addClass('is-active');
    const main = row.createDiv({ cls: 'claudian-loops-main' });
    const iconEl = main.createSpan({ cls: 'claudian-loops-icon' });
    setIcon(iconEl, loop.icon || DEFAULT_LOOP_ICON);
    const textCol = main.createDiv({ cls: 'claudian-loops-text' });
    textCol.createEl('strong', { text: loop.name });
    if (loop.description) {
      textCol.createDiv({ cls: 'claudian-loops-desc', text: loop.description });
    }
    if (loop.useWhen) {
      textCol.createDiv({ cls: 'claudian-loops-usewhen', text: `${t('tasks.loopPicker.useWhenLabel')} ${loop.useWhen}` });
    }
    main.addEventListener('click', () => this.choose({ cancelled: false, loopId: loop.id }));

    const actions = row.createDiv({ cls: 'claudian-loops-actions' });
    actions.createEl('button', { text: t('tasks.loopPicker.edit') }).addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditor(loop);
    });
    actions.createEl('button', { text: t('tasks.loopPicker.delete') }).addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deleteLoop(loop);
    });
  }

  private choose(result: LoopPickResult): void {
    if (this.chosen) return;
    this.chosen = true;
    this.resolve(result);
    this.close();
  }

  private openEditor(existing: LoopDefinition | null): void {
    new LoopEditorModal(this.app, existing, async (payload) => {
      await this.store.save(this.plugin.app.vault, this.folder(), payload, payload.originalPath);
      await this.refreshList();
    }).open();
  }

  private async deleteLoop(loop: LoopDefinition): Promise<void> {
    try {
      await this.store.delete(this.plugin.app, loop.path);
      await this.refreshList();
    } catch (error) {
      new Notice(t('tasks.loop.deleteFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export async function chooseLoop(plugin: ClaudianPlugin, current: string | undefined): Promise<LoopPickResult> {
  return new Promise<LoopPickResult>((resolve) => {
    new LoopPickerModal(plugin.app, plugin, current, resolve).open();
  });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/features/tasks/ui/LoopPickerModal.ts`
Expected: PASS once Task 13 i18n keys exist.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/LoopPickerModal.ts
git commit -m "feat(tasks): add LoopPickerModal and chooseLoop"
```

---

## Task 11: Loop chip in the work-order properties panel

**Files:**
- Modify: `src/features/tasks/ui/workOrderPropertiesPanel.ts`
- Modify: `src/features/tasks/ui/WorkOrderDetailModal.ts` (callbacks: add `onPickLoop` + `getLoopName`)
- Modify: `src/features/tasks/ui/AgentBoardView.ts` (wire the new callbacks)

The chip opens `LoopPickerModal` (rich list) rather than a native `<select>`, so the modal needs two new callbacks: one to launch the picker and persist, one to resolve the current slug to a display name.

- [ ] **Step 1: Extend the modal callback contract**

In `src/features/tasks/ui/WorkOrderDetailModal.ts`, add to `WorkOrderDetailModalCallbacks` (after `getModelOptions(providerId: string): WorkOrderOption[];`):

```ts
  /** Open the loop picker for this task and persist the choice. */
  onPickLoop?(task: TaskSpec): void;
  /** Resolve the task's attached loop slug to a display name (sync best-effort). */
  getLoopName?(loopId: string | undefined): string | undefined;
```

- [ ] **Step 2: Render the chip**

In `src/features/tasks/ui/workOrderPropertiesPanel.ts`, add a constant near `EDITABLE_AGENT_STATUSES`:

```ts
const EDITABLE_LOOP_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['inbox', 'ready', 'needs_fix']);
```

After the model property row block (around line 110), add:

```ts
  // Loop — optional attached playbook. Editable states open the loop picker;
  // other statuses render the loop name as static text.
  const loopValue = addPropertyRow(panel, 'loop', 'repeat', t('tasks.workOrderModal.fieldLoop')).value;
  renderLoopRow(loopValue, task, EDITABLE_LOOP_STATUSES.has(fm.status), callbacks);
```

Add the `renderLoopRow` helper near `renderAgentRow`:

```ts
function renderLoopRow(
  parent: HTMLElement,
  task: TaskSpec,
  editable: boolean,
  callbacks: WorkOrderDetailModalCallbacks,
): void {
  const loopName = callbacks.getLoopName?.(task.frontmatter.loop);
  const label = loopName ?? t('tasks.workOrderModal.loopNone');
  if (!editable) {
    parent.createSpan({ cls: 'claudian-work-order-modal-loop', text: label });
    return;
  }
  const chip = parent.createSpan({ cls: 'claudian-work-order-modal-chip claudian-work-order-modal-chip--loop' });
  chip.createSpan({ cls: 'claudian-work-order-modal-chip-value', text: label });
  const caret = chip.createSpan({ cls: 'claudian-work-order-modal-chip-caret' });
  setIcon(caret, 'chevron-down');
  chip.addEventListener('click', () => callbacks.onPickLoop?.(task));
}
```

- [ ] **Step 3: Wire the callbacks in `AgentBoardView`**

In the callbacks object passed to `WorkOrderDetailModal` (where `onSaveFields` etc. are defined, ~line 382), add:

```ts
      getLoopName: (loopId) => this.loopNameCache.get(loopId ?? '') ?? undefined,
      onPickLoop: (target) => void this.pickLoopForTask(target),
```

Add a small name cache + populate it on refresh (so `getLoopName` stays synchronous). Near `loopCatalog`:

```ts
  private loopNameCache = new Map<string, string>();
```

In the board `refresh()` (or `onOpen` after config load), refresh the cache:

```ts
    const loops = await this.loopCatalog.listLoops();
    this.loopNameCache = new Map(loops.map((loop) => [loop.id, loop.name]));
```

Add the picker handler method:

```ts
  private async pickLoopForTask(task: TaskSpec): Promise<void> {
    const result = await chooseLoop(this.plugin, task.frontmatter.loop);
    if (result.cancelled || result.loopId === undefined) return;
    await this.saveTaskFields(task, { loop: result.loopId });
    // Reopen is unnecessary — applyNoteChange triggers the board's modify handler.
  }
```

Add imports:

```ts
import { chooseLoop } from './LoopPickerModal';
```

- [ ] **Step 4: Typecheck + lint + board tests**

Run: `npm run typecheck && npm run lint -- src/features/tasks/ui/workOrderPropertiesPanel.ts src/features/tasks/ui/AgentBoardView.ts && npm run test -- --selectProjects unit --testPathPattern "workOrderPropertiesPanel|AgentBoardView"`
Expected: PASS. If a properties-panel test asserts the exact set of rendered rows, update it to include the Loop row.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/workOrderPropertiesPanel.ts src/features/tasks/ui/WorkOrderDetailModal.ts src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): add loop chip to the work-order properties panel"
```

---

## Task 12: Loop selector in the template editor

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderTemplateEditorModal.ts`

- [ ] **Step 1: Load loops and render a dropdown**

In `WorkOrderTemplateEditorModal.onOpen`, add `let loop = this.existing?.loop ?? '';` alongside the other `let` declarations.

After the priority `Setting` block (around line 128), add a loop dropdown. Because loop options must be read from the vault asynchronously, render the dropdown, then populate it:

```ts
    const loopSetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.loopName'))
      .setDesc(t('tasks.templateEditor.loopDesc'));
    const loopContainer = loopSetting.controlEl;
    const select = loopContainer.createEl('select', { cls: 'dropdown' });
    const noneOpt = select.createEl('option', { text: t('tasks.templateEditor.loopNone') });
    noneOpt.value = '';
    select.addEventListener('change', () => { loop = select.value; });
    void this.populateLoopOptions(select, loop);
```

Add the populate method to the class:

```ts
  private async populateLoopOptions(select: HTMLSelectElement, current: string): Promise<void> {
    const folder = this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops';
    const { loops } = await new LoopNoteStore().list(this.plugin.app.vault, folder);
    for (const loop of loops) {
      const opt = select.createEl('option', { text: loop.name });
      opt.value = loop.id;
      if (loop.id === current) opt.selected = true;
    }
  }
```

Add imports:

```ts
import { LoopNoteStore } from '../loops/LoopNoteStore';
```

- [ ] **Step 2: Include `loop` in the save payload**

In `onOpen`'s save button handler, change the `handleSave({ ... })` call to include `loop`:

```ts
            void this.handleSave({ name, description, icon, provider, model, priority, body, loop });
```

Extend the `handleSave` `form` parameter type with `loop: string;`, and add to the built `payload` (after `priority: form.priority || undefined,`):

```ts
      loop: form.loop.trim() || undefined,
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/features/tasks/ui/WorkOrderTemplateEditorModal.ts`
Expected: PASS (after Task 13 i18n keys exist).

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/WorkOrderTemplateEditorModal.ts
git commit -m "feat(tasks): add loop selector to the template editor"
```

---

## Task 13: Settings UI — loop folder + install button

**Files:**
- Modify: `src/features/settings/ui/AgentBoardSettingsSection.ts`

- [ ] **Step 1: Add the loop folder setting + install button**

In `src/features/settings/ui/AgentBoardSettingsSection.ts`, after the template-folder `Setting` and its install button block (around line 95), add:

```ts
  new Setting(container)
    .setName(t('settings.agentBoard.loopFolderName'))
    .setDesc(t('settings.agentBoard.loopFolderDesc'))
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path, not prose.
        .setPlaceholder('Agent Board/loops')
        .setValue(plugin.settings.agentBoardLoopFolder)
        .onChange(async (value) => {
          plugin.settings.agentBoardLoopFolder = value.trim();
          await plugin.saveSettings();
        }),
    );

  new Setting(container)
    .setName(t('settings.agentBoard.installLoopsName'))
    .setDesc(t('settings.agentBoard.installLoopsDesc'))
    .addButton((btn) => {
      btn.setButtonText('Install').onClick(async () => {
        btn.setDisabled(true);
        try {
          await installPresetLoopsWithNotice(plugin);
        } catch (error) {
          new Notice(t('settings.agentBoard.installFailed', { error: error instanceof Error ? error.message : String(error) }));
        } finally {
          btn.setDisabled(false);
        }
      });
    });
```

(Match the exact `container`/parent variable name and `Setting` construction style used by the existing template block in this file.)

Add the import:

```ts
import { installPresetLoopsWithNotice } from '../../tasks/loops/installPresetLoops';
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/features/settings/ui/AgentBoardSettingsSection.ts`
Expected: PASS after Task 14 i18n keys exist.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/ui/AgentBoardSettingsSection.ts
git commit -m "feat(settings): add loop folder setting and install button"
```

---

## Task 14: i18n keys (types + all locales)

**Files:**
- Modify: `src/i18n/types/tasks.ts` (add `tasks.loop*` union members)
- Modify: the settings i18n type file that declares `settings.agentBoard.commonTemplates` (add `commonLoops`, etc.)
- Modify: all 10 locale files `src/i18n/locales/*.json`

> The lookup falls back to English at runtime, but `translations` is typed `Record<Locale, typeof en>` — so every locale JSON must structurally contain the keys. Add real English to `en.json`; for the other 9 locales, add the same keys with the English string as the fallback value (translation can follow later).

- [ ] **Step 1: Add the new keys to `en.json`**

Under `tasks` add a `workOrderModal` extension and three new groups. The exact key set (values are the English source):

`tasks.workOrderModal.fieldLoop` = `"Loop"`
`tasks.workOrderModal.loopNone` = `"No loop"`

`tasks.loop.nameRequired` = `"A loop needs a name."`
`tasks.loop.bodyRequired` = `"A loop needs an approach or steps."`
`tasks.loop.saveFailed` = `"Could not save loop: {error}"`
`tasks.loop.deleteFailed` = `"Could not delete loop: {error}"`

`tasks.loopPicker.title` = `"Attach a loop"`
`tasks.loopPicker.lead` = `"Pick a loop to guide this work order, or choose No loop."`
`tasks.loopPicker.newLoop` = `"New loop"`
`tasks.loopPicker.noneTitle` = `"No loop"`
`tasks.loopPicker.noneDesc` = `"Run the work order without an attached loop."`
`tasks.loopPicker.useWhenLabel` = `"Use when:"`
`tasks.loopPicker.edit` = `"Edit"`
`tasks.loopPicker.delete` = `"Delete"`

`tasks.loopEditor.titleNew` = `"New loop"`
`tasks.loopEditor.titleEdit` = `"Edit loop"`
`tasks.loopEditor.nameName` = `"Name"`
`tasks.loopEditor.nameDesc` = `"A short, memorable loop name."`
`tasks.loopEditor.descriptionName` = `"Description"`
`tasks.loopEditor.descriptionDesc` = `"One line shown in the picker."`
`tasks.loopEditor.iconName` = `"Icon"`
`tasks.loopEditor.iconDesc` = `"Lucide icon for the loop."`
`tasks.loopEditor.useWhenName` = `"Use when"`
`tasks.loopEditor.useWhenDesc` = `"Selection guidance — not sent to the agent."`
`tasks.loopEditor.approachName` = `"Approach"`
`tasks.loopEditor.approachDesc` = `"The core playbook the agent follows."`
`tasks.loopEditor.stepsName` = `"Steps"`
`tasks.loopEditor.stepsDesc` = `"Ordered steps to work through."`
`tasks.loopEditor.verifyName` = `"Verify"`
`tasks.loopEditor.verifyDesc` = `"How the agent confirms success."`
`tasks.loopEditor.notesName` = `"Notes"`
`tasks.loopEditor.notesDesc` = `"Gotchas and guardrails."`
`tasks.loopEditor.save` = `"Save"`
`tasks.loopEditor.cancel` = `"Cancel"`

`tasks.templateEditor.loopName` = `"Default loop"`
`tasks.templateEditor.loopDesc` = `"Loop attached to every work order created from this template."`
`tasks.templateEditor.loopNone` = `"No loop"`

Under `settings.agentBoard`:

`settings.agentBoard.commonLoops` = `"Common loops: {loops}."`
`settings.agentBoard.commonLoopsEmpty` = `"Common loops: nothing to do."`
`settings.agentBoard.loopFolderName` = `"Loop folder"`
`settings.agentBoard.loopFolderDesc` = `"Folder where loop notes are stored."`
`settings.agentBoard.installLoopsName` = `"Install common loops"`
`settings.agentBoard.installLoopsDesc` = `"Add a starter set of loop notes to the loop folder."`

- [ ] **Step 2: Add the union members to the type files**

In `src/i18n/types/tasks.ts`, add each `tasks.loop*`, `tasks.loopPicker.*`, `tasks.loopEditor.*`, `tasks.workOrderModal.fieldLoop`, `tasks.workOrderModal.loopNone`, and `tasks.templateEditor.loop*` key to the `TasksTranslationKey` union. In the settings type file (the one containing `'settings.agentBoard.commonTemplates'`), add the six `settings.agentBoard.*` keys above.

- [ ] **Step 3: Mirror the keys into the other 9 locales**

Add the same keys with the English fallback values to: `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`. (Use the English string as the value; real translation is out of scope.)

- [ ] **Step 4: Verify completeness**

Run: `npm run typecheck`
Expected: PASS — no missing-key errors. If `typecheck` reports a locale missing a key, add it there.

If the repo has an i18n parity test:

Run: `npm run test -- --selectProjects unit --testPathPattern i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n
git commit -m "i18n: add loop library strings"
```

---

## Task 15: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (Storage table)
- Modify: `src/features/tasks/CLAUDE.md` (note the loops slice)

- [ ] **Step 1: Update the storage docs**

In `CLAUDE.md`, add a row to the Storage table:

```
| `.claudian` loop folder (`Agent Board/loops/*.md`) | Loop definitions (`type: claudian-loop`): reusable playbooks attachable to work orders / templates |
```

(Place it near the template rows; match the table's existing column phrasing.)

In `src/features/tasks/CLAUDE.md`, add a short bullet under the components/overview noting: *Loops (`loops/`) are `claudian-loop` Markdown notes — Use-when / Approach / Steps / Verify / Notes — resolved by `LoopCatalog` and injected into the task prompt via `renderTaskPrompt(task, lane, loop)`. A work order or template attaches one via the optional `loop` frontmatter slug.*

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS. Then:

Run: `npm run check:loc && npm run check:quality`
Expected: PASS (or, if the LOC/quality ratchet trips on the new files, follow `docs/build-ci/quality-gates.md` to update the baseline as those gates intend).

- [ ] **Step 3: Manual smoke (optional but recommended)**

In a dev vault: Settings → Agent Board → Install common loops; open a work order detail modal → Loop chip → pick a loop; run the work order and confirm the prompt (via logs/transcript) contains the `## Loop: <name>` block and not the Use-when text. Edit a template → set a default loop → create a work order from it → confirm `loop:` appears in its frontmatter.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/features/tasks/CLAUDE.md
git commit -m "docs: document the agent-loops library"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Loop schema (Use when / Approach / Steps / Verify / Notes + name/description/icon) → Task 1.
- Bundled presets + installer → Task 2.
- Catalog/resolver with graceful dangling-slug handling → Task 3.
- Single optional `loop` on work orders → Task 4; on templates + flow → Task 5.
- Run-time injection excluding Use-when, with marker escaping → Task 6, wired async in Task 8.
- Settings field/default → Task 7.
- Loop editor modal → Task 9; picker modal → Task 10; properties-panel chip → Task 11; template-editor selector → Task 12; settings install button → Task 13.
- i18n across 10 locales → Task 14.
- Docs → Task 15.

**Error handling:** unknown slug → `resolveLoop` null (Task 3 test); malformed note → `list` warning (Task 1 `list`); marker injection → escaped (Task 6 test); missing folder → installer/list create-or-empty (Task 2).

**Type consistency:** `LoopDefinition`/`SaveLoopInput` (Task 1) reused unchanged in Tasks 2, 3, 6, 9, 10, 12; `loop?: string` added consistently to `TaskFrontmatter`, `WriteFieldsOptions`, `WorkOrderFieldUpdate`, `WorkOrderTemplate`, `SaveTemplateInput`, `FrontmatterArgs`, and the `fromTemplate` builder arg; `renderTaskPrompt(task, lane?, loop?)` signature matches all call sites.

**Open risk flagged in Task 8:** the `renderPrompt` dep must become `string | Promise<string>` and be `await`ed in `TaskRunCoordinator`. Task 8 instructs verifying the current type and call site before changing it; existing synchronous mocks remain valid under the widened type.
