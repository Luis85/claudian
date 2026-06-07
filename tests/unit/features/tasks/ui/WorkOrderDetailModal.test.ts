import { MarkdownRenderer, Setting } from 'obsidian';

import type { TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';
import {
  WorkOrderDetailModal,
  type WorkOrderDetailModalCallbacks,
} from '../../../../../src/features/tasks/ui/WorkOrderDetailModal';

// The mock Setting tracks all instances in a static array not present in Obsidian's type declarations.
// It also exposes the public `containerEl` it was constructed with so tests can assert which shell
// region (sidebar / footer) a Setting rendered into; Obsidian's own `.d.ts` keeps that field non-public.
type MockSetting = InstanceType<typeof Setting> & {
  containerEl: unknown;
  components: { kind: string; props: { buttonText: string; clickHandler: () => void | Promise<void> } }[];
};
const settingInstances = (): MockSetting[] =>
  (Setting as unknown as { instances: MockSetting[] }).instances;

const mockApp: any = {};

// A recording DOM stub that mirrors the subset of the Obsidian element API the
// modal uses (`createDiv`/`createSpan`/`createEl`/`addClass`/`setText`/`empty`/
// `addEventListener`). Unlike the bare obsidian mock, it retains the created
// children so tests can assert the new sticky-shell container tree (header /
// body / main / sidebar / footer) and locate headings rendered into nested
// regions rather than directly on `contentEl`.
type ElOpts = {
  text?: string;
  cls?: string;
  attr?: Record<string, string | number | boolean | null>;
  href?: string;
};

interface RecordingEl {
  tag: string;
  classes: Set<string>;
  text: string;
  value: string;
  attrs: Record<string, string>;
  events: Record<string, Array<(evt?: unknown) => void>>;
  children: RecordingEl[];
  createEl(tag: string, opts?: ElOpts): RecordingEl;
  createDiv(opts?: ElOpts | string): RecordingEl;
  createSpan(opts?: ElOpts | string): RecordingEl;
  // SVG children (progress ring) are recorded like any other element so the
  // ring's track/arc circles and their geometry attrs are assertable.
  createSvg(tag: string, opts?: ElOpts): RecordingEl;
  addClass(cls: string): RecordingEl;
  removeClass(cls: string): RecordingEl;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  setAttribute(name: string, value: string): void;
  empty(): void;
  addEventListener(type: string, handler: (evt?: unknown) => void): void;
  // Test helper: fire a captured DOM event (e.g. a <select> 'change').
  emit(type: string): void;
}

function makeRecordingEl(tag: string): RecordingEl {
  const normalizeOpts = (opts?: ElOpts | string): ElOpts =>
    typeof opts === 'string' ? { cls: opts } : (opts ?? {});

  const el: RecordingEl = {
    tag,
    classes: new Set<string>(),
    text: '',
    value: '',
    attrs: {},
    events: {},
    children: [],
    createEl(childTag: string, opts?: ElOpts) {
      const child = makeRecordingEl(childTag);
      if (opts?.text) child.text = opts.text;
      if (opts?.cls) opts.cls.split(/\s+/).filter(Boolean).forEach((c) => child.classes.add(c));
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          if (v !== null && v !== undefined) child.attrs[k] = String(v);
        }
      }
      if (opts?.href) child.attrs.href = opts.href;
      this.children.push(child);
      return child;
    },
    createDiv(opts) {
      return this.createEl('div', normalizeOpts(opts));
    },
    createSpan(opts) {
      return this.createEl('span', normalizeOpts(opts));
    },
    createSvg(svgTag: string, opts?: ElOpts) {
      return this.createEl(svgTag, opts);
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
    emit(type: string) {
      (this.events[type] ?? []).forEach((h) => h({ target: this, preventDefault: () => undefined }));
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

// Ordered list of the sidebar property rows by their stable `data-prop` key.
function propRowKeys(root: RecordingEl): string[] {
  return findAll(root, (el) => 'data-prop' in el.attrs).map((el) => el.attrs['data-prop']);
}

function findRow(root: RecordingEl, key: string): RecordingEl | undefined {
  return findAll(root, (el) => el.attrs['data-prop'] === key)[0];
}

function firstSelect(root: RecordingEl): RecordingEl | undefined {
  return findAll(root, (el) => el.tag === 'select')[0];
}

function collectHeadingsIn(root: RecordingEl): string[] {
  const headings: string[] = [];
  const walk = (el: RecordingEl): void => {
    if (el.tag === 'h4' && el.text) headings.push(el.text);
    el.children.forEach(walk);
  };
  walk(root);
  return headings;
}

// Text of every section-header label rendered under the shared section-header
// pattern (uppercased visually via CSS; the recorded text stays natural-case).
function sectionLabels(root: RecordingEl): string[] {
  return findAll(root, (el) => el.classes.has('claudian-work-order-modal-section-label'))
    .map((el) => el.text)
    .filter(Boolean);
}

// The section element (icon + label + optional right slot) whose label matches.
function findSection(root: RecordingEl, label: string): RecordingEl | undefined {
  return findAll(root, (el) => el.classes.has('claudian-work-order-modal-section')).find((section) =>
    sectionLabels(section).includes(label),
  );
}

// Swap the modal's bare obsidian-mock `contentEl` for the recording stub so the
// shell structure and headings are observable. Returns the recording root.
function installRecordingContent(modal: WorkOrderDetailModal): RecordingEl {
  const contentEl = makeRecordingEl('div');
  (modal as unknown as { contentEl: RecordingEl }).contentEl = contentEl;
  return contentEl;
}

function makeTask(id: string, status: TaskStatus, handoff = ''): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: `Task ${id}`,
      status,
      priority: '2 - normal',
      created: '2026-06-04T00:00:00Z',
      updated: '2026-06-04T00:00:00Z',
      attempts: 0,
    },
    sections: {
      objective: 'Do something.',
      acceptanceCriteria: '- [ ] Done.',
      context: '',
      constraints: '',
      ledger: '',
      handoff,
    },
    body: '',
    raw: '',
  };
}

function makeCallbacks(): WorkOrderDetailModalCallbacks {
  return {
    onOpenNote: jest.fn(),
    onRun: jest.fn(),
    onStop: jest.fn(),
    onAccept: jest.fn(),
    onRework: jest.fn(),
    onMarkReady: jest.fn(),
    onArchive: jest.fn(),
    onReopen: jest.fn(),
    onSaveFields: jest.fn(),
    getProviderOptions: () => [],
    getModelOptions: () => [],
  };
}

function collectHeadings(modal: WorkOrderDetailModal): string[] {
  const root = installRecordingContent(modal);
  modal.onOpen();
  return collectHeadingsIn(root);
}

function getButtonTexts(): string[] {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'button')
    .map((c) => c.props.buttonText);
}

beforeEach(() => {
  (Setting as unknown as { instances: unknown[] }).instances = [];
  (MarkdownRenderer.render as jest.Mock).mockClear();
});

describe('WorkOrderDetailModal — sticky-shell frame', () => {
  it('renders header, scrollable body, and footer containers off contentEl', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const header = find(root, 'claudian-work-order-modal-header');
    const body = find(root, 'claudian-work-order-modal-body');
    const footer = find(root, 'claudian-work-order-modal-footer');

    expect(header).toBeDefined();
    expect(body).toBeDefined();
    expect(footer).toBeDefined();

    // All three regions are direct children of contentEl (the flex column).
    const directChildClasses = root.children.map((c) => [...c.classes]);
    expect(directChildClasses).toContainEqual(
      expect.arrayContaining(['claudian-work-order-modal-header']),
    );
    expect(directChildClasses).toContainEqual(
      expect.arrayContaining(['claudian-work-order-modal-body']),
    );
    expect(directChildClasses).toContainEqual(
      expect.arrayContaining(['claudian-work-order-modal-footer']),
    );
  });

  it('tags contentEl as the modal content shell', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    expect(root.classes.has('claudian-work-order-modal-content')).toBe(true);
  });

  it('adds the root class to modalEl', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();
    const addClass = (modal as unknown as { modalEl: { addClass: jest.Mock } }).modalEl.addClass;
    expect(addClass).toHaveBeenCalledWith('claudian-work-order-modal');
  });

  it('renders the two-pane body with main and sidebar regions', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const body = find(root, 'claudian-work-order-modal-body');
    expect(body).toBeDefined();
    expect(find(body!, 'claudian-work-order-modal-main')).toBeDefined();
    expect(find(body!, 'claudian-work-order-modal-sidebar')).toBeDefined();
  });

  it('renders section content into the main column, not the footer', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const main = find(root, 'claudian-work-order-modal-main');
    const footer = find(root, 'claudian-work-order-modal-footer');
    // The Objective section header (uppercased via CSS, stored natural-case)
    // renders into the main column; the footer never receives section content.
    const labels = sectionLabels(main!);
    expect(labels).toEqual(expect.arrayContaining(['Objective']));
    expect(sectionLabels(footer!)).toHaveLength(0);
    expect(collectHeadingsIn(footer!)).toHaveLength(0);
  });

  it('renders the properties sidebar with the property rows into the sidebar region', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const sidebar = find(root, 'claudian-work-order-modal-sidebar');
    expect(sidebar).toBeDefined();
    // The properties panel (header + rows) lives in the sidebar.
    expect(find(sidebar!, 'claudian-work-order-modal-properties')).toBeDefined();
    // Status / Provider / Model / Priority rows are present in the sidebar.
    expect(findRow(sidebar!, 'status')).toBeDefined();
    expect(findRow(sidebar!, 'provider')).toBeDefined();
    expect(findRow(sidebar!, 'model')).toBeDefined();
    expect(findRow(sidebar!, 'priority')).toBeDefined();
  });

  it('does not introduce a Title Setting row in the sidebar', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();

    const names = settingInstances().flatMap((s) => (s.setName as jest.Mock).mock.calls.map((c) => c[0]));
    expect(names).not.toContain('Title');
  });

  it('routes action buttons into the footer Setting', () => {
    const task = makeTask('t', 'review', 'Handoff text.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const footer = find(root, 'claudian-work-order-modal-footer');
    const footerSettings = settingInstances().filter((s) => s.containerEl === footer);
    const footerButtons = footerSettings
      .flatMap((s) => s.components)
      .filter((c) => c.kind === 'button')
      .map((c) => c.props.buttonText);
    expect(footerButtons).toEqual(expect.arrayContaining(['Accept', 'Rework']));
  });
});

describe('WorkOrderDetailModal — properties sidebar', () => {
  function richCallbacks(
    overrides: Partial<WorkOrderDetailModalCallbacks> = {},
  ): WorkOrderDetailModalCallbacks {
    return {
      ...makeCallbacks(),
      getProviderOptions: () => [
        { value: 'claude', label: 'claude' },
        { value: 'codex', label: 'codex' },
      ],
      getModelOptions: (providerId) =>
        providerId === 'codex'
          ? [{ value: 'gpt-5', label: 'gpt-5' }]
          : [{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }],
      ...overrides,
    };
  }

  function openWith(
    task: TaskSpec,
    callbacks: WorkOrderDetailModalCallbacks,
  ): { root: RecordingEl; sidebar: RecordingEl } {
    const modal = new WorkOrderDetailModal(mockApp, task, callbacks);
    const root = installRecordingContent(modal);
    modal.onOpen();
    const sidebar = find(root, 'claudian-work-order-modal-sidebar');
    expect(sidebar).toBeDefined();
    return { root, sidebar: sidebar! };
  }

  it('renders a Properties header in the sidebar', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    const head = find(sidebar, 'claudian-work-order-modal-properties-head');
    expect(head).toBeDefined();
    expect(head!.text).toBe('Properties');
  });

  it('renders editable rows in the spec order (no Conversation without a link)', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    expect(propRowKeys(sidebar)).toEqual([
      'status',
      'agent',
      'provider',
      'model',
      'priority',
      'created',
      'updated',
      'attempts',
    ]);
  });

  it('colors the Status pill with the status-specific class', () => {
    const { sidebar } = openWith(makeTask('t', 'needs_approval'), richCallbacks());
    const statusRow = findRow(sidebar, 'status')!;
    const pill = find(statusRow, 'claudian-work-order-modal-status-pill');
    expect(pill).toBeDefined();
    expect(pill!.classes.has('claudian-work-order-modal-status-pill--needs_approval')).toBe(true);
  });

  it('renders the Agent placeholder row with no avatar', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    const agentRow = findRow(sidebar, 'agent');
    expect(agentRow).toBeDefined();
    // Placeholder only — no chip/select and no avatar surface yet.
    expect(find(agentRow!, 'claudian-work-order-modal-chip')).toBeUndefined();
    expect(find(agentRow!, 'claudian-work-order-modal-avatar')).toBeUndefined();
  });

  it('renders Provider/Model/Priority as editable value chips in editable states', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    for (const key of ['provider', 'model', 'priority']) {
      const row = findRow(sidebar, key)!;
      expect(find(row, 'claudian-work-order-modal-chip')).toBeDefined();
      expect(firstSelect(row)).toBeDefined();
    }
  });

  it('renders read-only Provider/Model and priority bars in the running state', () => {
    const task = makeTask('t', 'running');
    task.frontmatter.provider = 'codex';
    task.frontmatter.model = 'gpt-5';
    task.frontmatter.priority = '1 - high';
    const { sidebar } = openWith(task, richCallbacks());

    // No chips/selects when read-only.
    expect(find(sidebar, 'claudian-work-order-modal-chip')).toBeUndefined();
    expect(firstSelect(sidebar)).toBeUndefined();

    // Provider renders as monospace plain text.
    const providerRow = findRow(sidebar, 'provider')!;
    expect(find(providerRow, 'claudian-work-order-modal-mono')).toBeDefined();

    // Priority renders ascending bars colored per the priority contract.
    const priorityRow = findRow(sidebar, 'priority')!;
    const bars = find(priorityRow, 'claudian-work-order-modal-priority-bars');
    expect(bars).toBeDefined();
    const priorityWrap = find(priorityRow, 'claudian-work-order-modal-priority');
    expect(priorityWrap!.classes.has('claudian-work-order-modal-priority--1')).toBe(true);
  });

  it('persists a Provider change and resets Model to provider default', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('t', 'inbox');
    task.frontmatter.provider = 'claude';
    task.frontmatter.model = 'opus';
    const { sidebar } = openWith(task, richCallbacks({ onSaveFields }));

    const providerSelect = firstSelect(findRow(sidebar, 'provider')!)!;
    providerSelect.value = 'codex';
    providerSelect.emit('change');

    expect(onSaveFields).toHaveBeenCalledWith(task, { provider: 'codex', model: '' });

    // Model chip repopulated for the new provider and reset to provider default.
    const modelSelect = firstSelect(findRow(sidebar, 'model')!)!;
    expect(modelSelect.value).toBe('');
    const modelChipLabel = find(findRow(sidebar, 'model')!, 'claudian-work-order-modal-chip-label');
    expect(modelChipLabel).toBeDefined();
  });

  it('persists a Model change through onSaveFields', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('t', 'inbox');
    task.frontmatter.provider = 'codex';
    const { sidebar } = openWith(task, richCallbacks({ onSaveFields }));

    const modelSelect = firstSelect(findRow(sidebar, 'model')!)!;
    modelSelect.value = 'gpt-5';
    modelSelect.emit('change');
    expect(onSaveFields).toHaveBeenCalledWith(task, { model: 'gpt-5' });
  });

  it('persists a Priority change through onSaveFields', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('t', 'inbox');
    const { sidebar } = openWith(task, richCallbacks({ onSaveFields }));

    const prioritySelect = firstSelect(findRow(sidebar, 'priority')!)!;
    prioritySelect.value = '0 - urgent';
    prioritySelect.emit('change');
    expect(onSaveFields).toHaveBeenCalledWith(task, { priority: '0 - urgent' });
  });

  it('updates the visible chip label after a selection (no stale value)', () => {
    const task = makeTask('t', 'inbox');
    task.frontmatter.priority = '2 - normal';
    const { sidebar } = openWith(task, richCallbacks({ onSaveFields: jest.fn() }));

    const priorityRow = findRow(sidebar, 'priority')!;
    const priorityLabel = find(priorityRow, 'claudian-work-order-modal-chip-label')!;
    expect(priorityLabel.text).toBe('2 - normal');

    const prioritySelect = firstSelect(priorityRow)!;
    prioritySelect.value = '0 - urgent';
    prioritySelect.emit('change');

    // The transparent <select> changed; the visible chip label must follow.
    expect(priorityLabel.text).toBe('0 - urgent');
  });

  it('marks Created/Updated/Attempts values with the tabular-nums class', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    for (const key of ['created', 'updated', 'attempts']) {
      const row = findRow(sidebar, key)!;
      expect(find(row, 'claudian-work-order-modal-prop-num')).toBeDefined();
    }
  });

  it('hides the Conversation row when conversation_id is absent', () => {
    const { sidebar } = openWith(makeTask('t', 'inbox'), richCallbacks());
    expect(findRow(sidebar, 'conversation')).toBeUndefined();
  });

  it('hides the Conversation row when canOpenConversation returns false', () => {
    const task = makeTask('t', 'inbox');
    task.frontmatter.conversation_id = 'conv-1';
    const { sidebar } = openWith(
      task,
      richCallbacks({ onOpenConversation: jest.fn(), canOpenConversation: () => false }),
    );
    expect(findRow(sidebar, 'conversation')).toBeUndefined();
  });

  it('shows the Conversation row and invokes onOpenConversation on click', () => {
    const onOpenConversation = jest.fn();
    const task = makeTask('t', 'inbox');
    task.frontmatter.conversation_id = 'conv-1';
    const { sidebar } = openWith(
      task,
      richCallbacks({ onOpenConversation, canOpenConversation: () => true }),
    );

    const convRow = findRow(sidebar, 'conversation');
    expect(convRow).toBeDefined();
    const link = find(convRow!, 'claudian-work-order-modal-prop-link');
    expect(link).toBeDefined();
    link!.emit('click');
    expect(onOpenConversation).toHaveBeenCalledWith(task);
  });
});

describe('WorkOrderDetailModal — Handoff visibility', () => {
  it('renders Handoff heading on review when handoff content is present', () => {
    const task = makeTask('t', 'review', 'Prior handoff text.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    expect(collectHeadings(modal)).toContain('Handoff');
  });

  it('renders Handoff heading on needs_fix when handoff content is present', () => {
    const task = makeTask('t', 'needs_fix', 'Prior handoff text.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    expect(collectHeadings(modal)).toContain('Handoff');
  });

  it('does not render Handoff heading on needs_fix when handoff is empty', () => {
    const task = makeTask('t', 'needs_fix', '');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    expect(collectHeadings(modal)).not.toContain('Handoff');
  });

  it('does not render Handoff heading on inbox status', () => {
    const task = makeTask('t', 'inbox', 'Some handoff.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    expect(collectHeadings(modal)).not.toContain('Handoff');
  });
});

describe('WorkOrderDetailModal — Reopen button', () => {
  it('renders Reopen button for done status', () => {
    const task = makeTask('t', 'done');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();
    expect(getButtonTexts()).toContain('Reopen');
  });

  it('does not render Reopen button for failed status', () => {
    const task = makeTask('t', 'failed');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();
    expect(getButtonTexts()).not.toContain('Reopen');
  });

  it('does not render Reopen button for canceled status', () => {
    const task = makeTask('t', 'canceled');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();
    expect(getButtonTexts()).not.toContain('Reopen');
  });

  it('calls onReopen and closes when Reopen button is clicked', () => {
    const task = makeTask('t', 'done');
    const callbacks = makeCallbacks();
    const modal = new WorkOrderDetailModal(mockApp, task, callbacks);
    installRecordingContent(modal);
    modal.onOpen();

    const reopenBtn = settingInstances()
      .flatMap((s) => s.components)
      .find((c) => c.kind === 'button' && c.props.buttonText === 'Reopen');

    expect(reopenBtn).toBeDefined();
    void reopenBtn!.props.clickHandler();

    expect(modal.close).toHaveBeenCalled();
    expect(callbacks.onReopen).toHaveBeenCalledWith(task);
  });
});

describe('WorkOrderDetailModal — Objective + Acceptance sections', () => {
  function openMain(task: TaskSpec): { root: RecordingEl; main: RecordingEl } {
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    const main = find(root, 'claudian-work-order-modal-main');
    expect(main).toBeDefined();
    return { root, main: main! };
  }

  // The acceptance-criteria SVG ring's progress arc (the second circle).
  function ringArc(section: RecordingEl): RecordingEl | undefined {
    const ring = find(section, 'claudian-work-order-modal-ring');
    if (!ring) return undefined;
    return findAll(ring, (el) => el.classes.has('claudian-work-order-modal-ring-arc'))[0];
  }

  it('renders the Objective section header with the target icon', () => {
    const { main } = openMain(makeTask('t', 'inbox'));
    const section = findSection(main, 'Objective');
    expect(section).toBeDefined();
    const icon = find(section!, 'claudian-work-order-modal-section-icon');
    expect(icon).toBeDefined();
    expect(icon!.attrs['data-icon']).toBe('target');
  });

  it('renders the Objective body through MarkdownRenderer (interactive links stay live)', () => {
    const task = makeTask('t', 'inbox');
    task.sections.objective = 'Ship [[the thing]] with `code`.';
    openMain(task);
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    const objectiveCall = calls.find((c) => c[1] === 'Ship [[the thing]] with `code`.');
    expect(objectiveCall).toBeDefined();
  });

  it('renders the Acceptance section header with the list-checks icon', () => {
    const { main } = openMain(makeTask('t', 'inbox'));
    const section = findSection(main, 'Acceptance criteria');
    expect(section).toBeDefined();
    const icon = find(section!, 'claudian-work-order-modal-section-icon');
    expect(icon).toBeDefined();
    expect(icon!.attrs['data-icon']).toBe('list-checks');
  });

  it('renders the progress ring with the parsed done/total count (1 of 3 checked)', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [x] One\n- [ ] Two\n- [ ] Three';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;

    // Count text reflects parseAcceptanceProgress.
    const count = find(section, 'claudian-work-order-modal-ring-count');
    expect(count).toBeDefined();
    expect(count!.text).toBe('1/3');

    // The ring renders an SVG with a track + a progress arc.
    const ring = find(section, 'claudian-work-order-modal-ring');
    expect(ring).toBeDefined();
    expect(ring!.tag).toBe('svg');
    expect(find(section, 'claudian-work-order-modal-ring-track')).toBeDefined();
    const arc = ringArc(section);
    expect(arc).toBeDefined();
    // 1/3 progress is partial: the dash offset is neither full nor empty.
    const circumference = 2 * Math.PI * 9;
    const offset = Number(arc!.attrs['stroke-dashoffset']);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(circumference);
    expect(offset).toBeCloseTo(circumference * (1 - 1 / 3), 3);
  });

  it('turns the ring green and zeroes the dash offset at 100%', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [x] One\n- [x] Two';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;

    const count = find(section, 'claudian-work-order-modal-ring-count')!;
    expect(count.text).toBe('2/2');
    // Complete state carries a dedicated class so CSS can flip stroke → green.
    const ring = find(section, 'claudian-work-order-modal-ring')!;
    expect(ring.classes.has('claudian-work-order-modal-ring--complete')).toBe(true);
    const arc = ringArc(section)!;
    expect(Number(arc.attrs['stroke-dashoffset'])).toBeCloseTo(0, 3);
  });

  it('drives the ring stroke off the status-color contract (running → yellow)', () => {
    const task = makeTask('t', 'running');
    task.sections.acceptanceCriteria = '- [ ] Pending';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    const ring = find(section, 'claudian-work-order-modal-ring')!;
    // Incomplete: the status modifier carries the accent color; not complete.
    expect(ring.classes.has('claudian-work-order-modal-ring--running')).toBe(true);
    expect(ring.classes.has('claudian-work-order-modal-ring--complete')).toBe(false);
  });

  it('renders a checklist card row per criterion with checked rows marked', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [x] First done\n- [ ] Second open\n- [ ] Third open';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;

    const card = find(section, 'claudian-work-order-modal-checklist');
    expect(card).toBeDefined();
    const rows = findAll(card!, (el) => el.classes.has('claudian-work-order-modal-checklist-item'));
    expect(rows).toHaveLength(3);

    // The first row is checked: carries the checked-state class, a check glyph
    // (the non-color cue), and surfaces its text.
    const [first, second] = rows;
    expect(first.classes.has('is-checked')).toBe(true);
    const checkIcon = find(first, 'claudian-work-order-modal-checklist-check');
    expect(checkIcon).toBeDefined();
    expect(checkIcon!.attrs['data-icon']).toBe('check');
    expect(findAll(first, (el) => el.text === 'First done').length).toBeGreaterThan(0);

    // Unchecked rows are not marked checked.
    expect(second.classes.has('is-checked')).toBe(false);
  });

  it('falls back to an em dash when there are no acceptance criteria', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    // No ring/count without criteria; an empty-state placeholder stands in.
    expect(find(section, 'claudian-work-order-modal-ring')).toBeUndefined();
    expect(find(section, 'claudian-work-order-modal-checklist-empty')).toBeDefined();
  });
});
