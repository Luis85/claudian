// TemplateNoteStore.list — mocked to control the async vault listing.
jest.mock('../../../../../src/features/tasks/templates/TemplateNoteStore', () => ({
  TemplateNoteStore: jest.fn().mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({ templates: [], warnings: [] }),
    save: jest.fn().mockResolvedValue('Agent Board/templates/new-template.md'),
    delete: jest.fn().mockResolvedValue(undefined),
  })),
}));

// WorkOrderTemplateEditorModal — the picker opens this; we just need it not to crash.
jest.mock('../../../../../src/features/tasks/ui/WorkOrderTemplateEditorModal', () => ({
  WorkOrderTemplateEditorModal: jest.fn().mockImplementation(() => ({
    open: jest.fn(),
  })),
}));

import { Notice, setIcon } from 'obsidian';

import { TemplateNoteStore } from '../../../../../src/features/tasks/templates/TemplateNoteStore';
import type { WorkOrderTemplate } from '../../../../../src/features/tasks/templates/templateTypes';
import type { TemplatePickResult } from '../../../../../src/features/tasks/ui/WorkOrderTemplatePickerModal';
import { chooseWorkOrderTemplate,WorkOrderTemplatePickerModal } from '../../../../../src/features/tasks/ui/WorkOrderTemplatePickerModal';

const mockApp: any = {};

function makePlugin(vaultFiles: Record<string, WorkOrderTemplate> = {}): any {
  return {
    settings: {
      agentBoardTemplateFolder: 'Agent Board/templates',
      agentBoardLoopFolder: 'Agent Board/loops',
      providerConfigs: {},
    },
    app: {
      vault: {
        getMarkdownFiles: () => [],
        read: jest.fn().mockResolvedValue(''),
      },
      fileManager: {
        trashFile: jest.fn().mockResolvedValue(undefined),
      },
    },
  };
}

function makeTemplate(overrides: Partial<WorkOrderTemplate> = {}): WorkOrderTemplate {
  return {
    path: 'Agent Board/templates/bug-fix.md',
    name: 'Bug Fix',
    description: 'Fix a reported bug.',
    icon: 'bug',
    body: '# {{title}}\n\n## Objective\n\nFix the bug.',
    ...overrides,
  };
}

// Flush microtasks for async refreshList.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// --- Recording DOM stub (same approach as LoopPickerModal.test.ts) ---

type ElOpts = { text?: string; cls?: string | string[]; attr?: Record<string, unknown>; href?: string };

interface RecordingEl {
  tag: string;
  classes: Set<string>;
  text: string;
  children: RecordingEl[];
  attrs: Record<string, string>;
  events: Record<string, Array<(evt?: unknown) => void>>;
  parent?: RecordingEl;
  createEl(tag: string, opts?: ElOpts): RecordingEl;
  createDiv(opts?: ElOpts | string): RecordingEl;
  createSpan(opts?: ElOpts | string): RecordingEl;
  addClass(cls: string): RecordingEl;
  removeClass(cls: string): RecordingEl;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  setAttribute(name: string, value: string): void;
  empty(): void;
  addEventListener(type: string, handler: (evt?: unknown) => void): void;
  emit(type: string, init?: Record<string, unknown>): void;
}

function makeRecordingEl(tag: string): RecordingEl {
  const normalizeOpts = (opts?: ElOpts | string): ElOpts =>
    typeof opts === 'string' ? { cls: opts } : (opts ?? {});

  const el: RecordingEl = {
    tag,
    classes: new Set<string>(),
    text: '',
    children: [],
    attrs: {},
    events: {},
    createEl(childTag: string, opts?: ElOpts) {
      const child = makeRecordingEl(childTag);
      if (opts?.text) child.text = opts.text;
      if (opts?.cls) {
        const tokens = Array.isArray(opts.cls) ? opts.cls : opts.cls.split(/\s+/);
        tokens.filter(Boolean).forEach((c) => child.classes.add(c));
      }
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          if (v !== null && v !== undefined) child.attrs[k] = String(v);
        }
      }
      if (opts?.href) child.attrs.href = opts.href;
      child.parent = this;
      this.children.push(child);
      return child;
    },
    createDiv(opts) {
      return this.createEl('div', normalizeOpts(opts));
    },
    createSpan(opts) {
      return this.createEl('span', normalizeOpts(opts));
    },
    addClass(cls: string) {
      this.classes.add(cls);
      return this;
    },
    removeClass(cls: string) {
      this.classes.delete(cls);
      return this;
    },
    setText(text: string) {
      this.text = text;
    },
    setAttr(name: string, value: string) {
      this.attrs[name] = value;
    },
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    empty() {
      this.children = [];
      this.text = '';
    },
    addEventListener(type: string, handler: (evt?: unknown) => void) {
      (this.events[type] ??= []).push(handler);
    },
    emit(type: string, init?: Record<string, unknown>) {
      (this.events[type] ?? []).forEach((h) =>
        h({ target: this, preventDefault: () => undefined, stopPropagation: () => undefined, ...init }),
      );
    },
  };
  return el;
}

function find(root: RecordingEl, cls: string): RecordingEl | undefined {
  if (root.classes.has(cls)) return root;
  for (const child of root.children) {
    const hit = find(child, cls);
    if (hit) return hit;
  }
  return undefined;
}

function findAll(root: RecordingEl, predicate: (el: RecordingEl) => boolean): RecordingEl[] {
  const hits: RecordingEl[] = [];
  const walk = (el: RecordingEl): void => {
    if (predicate(el)) hits.push(el);
    el.children.forEach(walk);
  };
  walk(root);
  return hits;
}

function installRecordingContent(modal: WorkOrderTemplatePickerModal): RecordingEl {
  const contentEl = makeRecordingEl('div');
  (modal as unknown as { contentEl: RecordingEl }).contentEl = contentEl;
  return contentEl;
}


beforeEach(() => {
  (Notice as jest.Mock).mockClear();
  (setIcon as jest.Mock).mockClear();
  (TemplateNoteStore as jest.Mock).mockClear();
  // Reset TemplateNoteStore mock to return empty list by default
  (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({ templates: [], warnings: [] }),
    save: jest.fn().mockResolvedValue('Agent Board/templates/new.md'),
    delete: jest.fn().mockResolvedValue(undefined),
  }));
});

describe('WorkOrderTemplatePickerModal — rendering (empty)', () => {
  it('sets a non-empty title on open', async () => {
    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    expect(modal.setTitle).toHaveBeenCalledWith(expect.any(String));
    const title = (modal.setTitle as jest.Mock).mock.calls[0][0] as string;
    expect(title.length).toBeGreaterThan(0);
  });

  it('renders an intro, list, and footer area', async () => {
    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    expect(find(contentEl, 'claudian-wo-templates-intro')).toBeDefined();
    expect(find(contentEl, 'claudian-wo-templates-list')).toBeDefined();
    expect(find(contentEl, 'claudian-wo-templates-footer')).toBeDefined();
  });

  it('renders a "blank" template row even when no templates exist', async () => {
    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const blankRow = find(listEl, 'claudian-wo-templates-row--blank');
    expect(blankRow).toBeDefined();
  });

  it('renders a "new template" button in the footer', async () => {
    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const footerEl = find(contentEl, 'claudian-wo-templates-footer')!;
    const buttons = findAll(footerEl, (el) => el.tag === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

describe('WorkOrderTemplatePickerModal — rendering (with templates)', () => {
  function setupWithTemplates(templates: WorkOrderTemplate[]): {
    modal: WorkOrderTemplatePickerModal;
    contentEl: RecordingEl;
    resolveResults: TemplatePickResult[];
  } {
    (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
      list: jest.fn().mockResolvedValue({ templates, warnings: [] }),
      save: jest.fn().mockResolvedValue('Agent Board/templates/saved.md'),
      delete: jest.fn().mockResolvedValue(undefined),
    }));

    const resolveResults: TemplatePickResult[] = [];
    const modal = new WorkOrderTemplatePickerModal(
      mockApp,
      makePlugin(),
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    return { modal, contentEl, resolveResults };
  }

  it('renders one row per template plus the blank row', async () => {
    const { modal, contentEl } = setupWithTemplates([
      makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' }),
      makeTemplate({ name: 'Feature', path: 'Agent Board/templates/feature.md' }),
    ]);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const rows = findAll(listEl, (el) => el.classes.has('claudian-wo-templates-row'));
    // 1 blank + 2 template rows
    expect(rows.length).toBe(3);
  });

  it('renders the template name in each template row', async () => {
    const { modal, contentEl } = setupWithTemplates([
      makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' }),
    ]);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const strongs = findAll(listEl, (el) => el.tag === 'strong');
    const texts = strongs.map((el) => el.text);
    expect(texts).toContain('Bug Fix');
  });

  it('renders a description div when the template has a description', async () => {
    const { modal, contentEl } = setupWithTemplates([
      makeTemplate({ name: 'Bug Fix', description: 'Fix a bug', path: 'Agent Board/templates/bug-fix.md' }),
    ]);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const descs = findAll(listEl, (el) => el.classes.has('claudian-wo-templates-desc'));
    expect(descs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders edit and delete buttons for each template row', async () => {
    const { modal, contentEl } = setupWithTemplates([
      makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' }),
    ]);
    modal.onOpen();
    await flushAsync();

    const actionsEl = find(contentEl, 'claudian-wo-templates-actions')!;
    expect(actionsEl).toBeDefined();
    const buttons = findAll(actionsEl, (el) => el.tag === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('WorkOrderTemplatePickerModal — choosing', () => {
  it('clicking the blank row main area resolves { cancelled: false } with no template', async () => {
    const resolveResults: TemplatePickResult[] = [];
    const modal = new WorkOrderTemplatePickerModal(
      mockApp,
      makePlugin(),
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const blankRow = find(listEl, 'claudian-wo-templates-row--blank')!;
    const blankMain = find(blankRow, 'claudian-wo-templates-main')!;
    blankMain.emit('click');

    expect(resolveResults).toHaveLength(1);
    expect(resolveResults[0].cancelled).toBe(false);
    expect(resolveResults[0].template).toBeUndefined();
    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('clicking a template row main area resolves { cancelled: false, template }', async () => {
    const template = makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' });
    (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
      list: jest.fn().mockResolvedValue({ templates: [template], warnings: [] }),
      save: jest.fn().mockResolvedValue('Agent Board/templates/saved.md'),
      delete: jest.fn().mockResolvedValue(undefined),
    }));

    const resolveResults: TemplatePickResult[] = [];
    const modal = new WorkOrderTemplatePickerModal(
      mockApp,
      makePlugin(),
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    // Find a non-blank row
    const templateRow = findAll(listEl, (el) =>
      el.classes.has('claudian-wo-templates-row') && !el.classes.has('claudian-wo-templates-row--blank'),
    )[0]!;
    const templateMain = find(templateRow, 'claudian-wo-templates-main')!;
    templateMain.emit('click');

    expect(resolveResults).toHaveLength(1);
    expect(resolveResults[0].cancelled).toBe(false);
    expect(resolveResults[0].template).toEqual(template);
  });

  it('does not resolve a second time if choose is called twice (chosen guard)', async () => {
    const resolveResults: TemplatePickResult[] = [];
    const modal = new WorkOrderTemplatePickerModal(
      mockApp,
      makePlugin(),
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const blankMain = find(find(listEl, 'claudian-wo-templates-row--blank')!, 'claudian-wo-templates-main')!;

    blankMain.emit('click');
    blankMain.emit('click'); // second click should be ignored

    expect(resolveResults).toHaveLength(1);
  });
});

describe('WorkOrderTemplatePickerModal — closing without choosing', () => {
  it('resolves { cancelled: true } via the deferred setTimeout when closed without choosing', () => {
    jest.useFakeTimers();

    return new Promise<void>((resolve) => {
      const modal = new WorkOrderTemplatePickerModal(
        mockApp,
        makePlugin(),
        (result) => {
          expect(result).toEqual({ cancelled: true });
          jest.useRealTimers();
          resolve();
        },
      );
      installRecordingContent(modal);
      modal.onOpen();
      modal.onClose();
      jest.runAllTimers();
    });
  });

  it('does not resolve cancelled if a choice was made before close', async () => {
    const resolveResults: TemplatePickResult[] = [];
    const modal = new WorkOrderTemplatePickerModal(
      mockApp,
      makePlugin(),
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    // Choose blank first
    const listEl = find(contentEl, 'claudian-wo-templates-list')!;
    const blankMain = find(find(listEl, 'claudian-wo-templates-row--blank')!, 'claudian-wo-templates-main')!;
    blankMain.emit('click');

    // Close — the setTimeout fires but chosen=true so no second resolve
    jest.useFakeTimers();
    modal.onClose();
    jest.runAllTimers();
    jest.useRealTimers();

    expect(resolveResults).toHaveLength(1);
    expect(resolveResults[0].cancelled).toBe(false);
  });
});

describe('WorkOrderTemplatePickerModal — delete', () => {
  it('clicking delete button calls TemplateNoteStore.delete and refreshes the list', async () => {
    const template = makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' });
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    const listFn = jest.fn().mockResolvedValue({ templates: [template], warnings: [] });

    (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
      list: listFn,
      save: jest.fn().mockResolvedValue('Agent Board/templates/saved.md'),
      delete: deleteFn,
    }));

    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const actionsEl = find(contentEl, 'claudian-wo-templates-actions')!;
    const buttons = findAll(actionsEl, (el) => el.tag === 'button');
    // Second button in actions is delete
    const deleteBtn = buttons[1]!;
    deleteBtn.emit('click');

    await flushAsync();

    expect(deleteFn).toHaveBeenCalledTimes(1);
    // After delete, list is called again (initial open + after delete = 2)
    expect(listFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a Notice when delete fails', async () => {
    const template = makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' });

    (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
      list: jest.fn().mockResolvedValue({ templates: [template], warnings: [] }),
      save: jest.fn().mockResolvedValue('Agent Board/templates/saved.md'),
      delete: jest.fn().mockRejectedValue(new Error('permission denied')),
    }));

    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const actionsEl = find(contentEl, 'claudian-wo-templates-actions')!;
    const buttons = findAll(actionsEl, (el) => el.tag === 'button');
    const deleteBtn = buttons[1]!;
    deleteBtn.emit('click');

    await flushAsync();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect((Notice as jest.Mock).mock.calls[0][0]).toContain('permission denied');
  });
});

describe('WorkOrderTemplatePickerModal — edit', () => {
  it('clicking edit button opens WorkOrderTemplateEditorModal', async () => {
    const { WorkOrderTemplateEditorModal } = jest.requireMock(
      '../../../../../src/features/tasks/ui/WorkOrderTemplateEditorModal',
    ) as { WorkOrderTemplateEditorModal: jest.Mock };

    const template = makeTemplate({ name: 'Bug Fix', path: 'Agent Board/templates/bug-fix.md' });
    (TemplateNoteStore as jest.Mock).mockImplementation(() => ({
      list: jest.fn().mockResolvedValue({ templates: [template], warnings: [] }),
      save: jest.fn().mockResolvedValue('Agent Board/templates/saved.md'),
      delete: jest.fn().mockResolvedValue(undefined),
    }));

    WorkOrderTemplateEditorModal.mockClear();

    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const actionsEl = find(contentEl, 'claudian-wo-templates-actions')!;
    const buttons = findAll(actionsEl, (el) => el.tag === 'button');
    // First button in actions is edit
    const editBtn = buttons[0]!;
    editBtn.emit('click');

    expect(WorkOrderTemplateEditorModal).toHaveBeenCalledTimes(1);
    const instance = WorkOrderTemplateEditorModal.mock.results[0].value;
    expect(instance.open).toHaveBeenCalled();
  });
});

describe('WorkOrderTemplatePickerModal — new template button', () => {
  it('clicking the new template footer button opens WorkOrderTemplateEditorModal with null existing', async () => {
    const { WorkOrderTemplateEditorModal } = jest.requireMock(
      '../../../../../src/features/tasks/ui/WorkOrderTemplateEditorModal',
    ) as { WorkOrderTemplateEditorModal: jest.Mock };

    WorkOrderTemplateEditorModal.mockClear();

    const modal = new WorkOrderTemplatePickerModal(mockApp, makePlugin(), jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const footerEl = find(contentEl, 'claudian-wo-templates-footer')!;
    const footerButtons = findAll(footerEl, (el) => el.tag === 'button');
    footerButtons[0]!.emit('click');

    expect(WorkOrderTemplateEditorModal).toHaveBeenCalledTimes(1);
    // First arg after app and plugin is `existing` = null for new template
    const callArgs = WorkOrderTemplateEditorModal.mock.calls[0];
    expect(callArgs[2]).toBeNull();
    const instance = WorkOrderTemplateEditorModal.mock.results[0].value;
    expect(instance.open).toHaveBeenCalled();
  });
});

describe('chooseWorkOrderTemplate helper', () => {
  it('returns a Promise', () => {
    const plugin = makePlugin();
    const result = chooseWorkOrderTemplate(plugin);
    expect(result).toBeInstanceOf(Promise);
  });
});
