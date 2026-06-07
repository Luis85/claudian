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
  // `textContent` mirrors `text` so the editable title (a `contenteditable`
  // element whose value the modal reads via `.textContent`) is observable and
  // settable from tests exactly as it is in the real DOM.
  textContent: string;
  value: string;
  attrs: Record<string, string>;
  events: Record<string, Array<(evt?: unknown) => void>>;
  children: RecordingEl[];
  parent?: RecordingEl;
  createEl(tag: string, opts?: ElOpts): RecordingEl;
  createDiv(opts?: ElOpts | string): RecordingEl;
  createSpan(opts?: ElOpts | string): RecordingEl;
  // SVG children (progress ring) are recorded like any other element so the
  // ring's track/arc circles and their geometry attrs are assertable.
  createSvg(tag: string, opts?: ElOpts): RecordingEl;
  addClass(cls: string): RecordingEl;
  removeClass(cls: string): RecordingEl;
  toggleClass(cls: string, on: boolean): RecordingEl;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  setAttribute(name: string, value: string): void;
  empty(): void;
  // Detaches this node from its parent (mirrors HTMLElement.remove) so removed
  // collapsible bodies disappear from the recorded tree.
  remove(): void;
  // The editable title calls `.focus()` (no-op here) and `.blur()` (fires the
  // registered blur listeners) to commit / revert; mirror that contract.
  focus(): void;
  blur(): void;
  addEventListener(type: string, handler: (evt?: unknown) => void): void;
  // Test helper: fire a captured DOM event (e.g. a <select> 'change'). `init`
  // merges onto the synthetic event so keyboard handlers can observe `key`
  // (Enter commits / Esc reverts the editable title).
  emit(type: string, init?: Record<string, unknown>): void;
}

function makeRecordingEl(tag: string): RecordingEl {
  const normalizeOpts = (opts?: ElOpts | string): ElOpts =>
    typeof opts === 'string' ? { cls: opts } : (opts ?? {});

  const el: RecordingEl = {
    tag,
    classes: new Set<string>(),
    text: '',
    textContent: '',
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
    toggleClass(cls: string, on: boolean) {
      if (on) this.classes.add(cls);
      else this.classes.delete(cls);
      return this;
    },
    setText(text: string) {
      this.text = text;
      this.textContent = text;
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
      this.textContent = '';
    },
    remove() {
      const siblings = this.parent?.children;
      if (siblings) {
        const idx = siblings.indexOf(this);
        if (idx >= 0) siblings.splice(idx, 1);
      }
    },
    focus() {
      /* no-op: focus has no observable effect in the recording stub */
    },
    blur() {
      this.emit('blur');
    },
    addEventListener(type: string, handler: (evt?: unknown) => void) {
      (this.events[type] ??= []).push(handler);
    },
    emit(type: string, init?: Record<string, unknown>) {
      (this.events[type] ?? []).forEach((h) =>
        h({ target: this, preventDefault: () => undefined, ...init }),
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

function makeTask(id: string, status: TaskStatus, handoff = '', ledger = ''): TaskSpec {
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
      ledger,
      handoff,
    },
    body: '',
    raw: '',
  };
}

// A canonical handoff region in the renderHandoffMarkdown shape (## Heading\nbody).
const CANONICAL_HANDOFF = [
  '## Summary',
  'Implemented the activity block.',
  '',
  '## Verification',
  'All gates pass.',
  '',
  '## Risks',
  'Migration risk on reload.',
  '',
  '## Next Action',
  'Review and merge.',
].join('\n');

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

describe('WorkOrderDetailModal — Activity block (Agent handoff)', () => {
  function openMain(task: TaskSpec): RecordingEl {
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    const main = find(root, 'claudian-work-order-modal-main');
    expect(main).toBeDefined();
    return main!;
  }

  // The four handoff collapsible cards, in render order.
  function handoffCards(main: RecordingEl): RecordingEl[] {
    return findAll(main, (el) => el.classes.has('claudian-work-order-modal-collapse'));
  }

  // The keyboard-operable header button of a collapsible card.
  function cardButton(card: RecordingEl): RecordingEl {
    return find(card, 'claudian-work-order-modal-collapse-head')!;
  }

  it('renders the Agent handoff section header (clipboard-check) on review', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const section = findSection(main, 'Agent handoff');
    expect(section).toBeDefined();
    const icon = find(section!, 'claudian-work-order-modal-section-icon');
    expect(icon!.attrs['data-icon']).toBe('clipboard-check');
  });

  it('renders the Agent handoff section on needs_fix when handoff content is present', () => {
    const main = openMain(makeTask('t', 'needs_fix', CANONICAL_HANDOFF));
    expect(findSection(main, 'Agent handoff')).toBeDefined();
  });

  it('does not render the Agent handoff section on needs_fix when handoff is empty', () => {
    const main = openMain(makeTask('t', 'needs_fix', ''));
    expect(findSection(main, 'Agent handoff')).toBeUndefined();
  });

  it('does not render the Agent handoff section on inbox status', () => {
    const main = openMain(makeTask('t', 'inbox', CANONICAL_HANDOFF));
    expect(findSection(main, 'Agent handoff')).toBeUndefined();
  });

  it('renders four collapsible cards in the Summary → Verification → Risks → Next action order', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const cards = handoffCards(main);
    expect(cards).toHaveLength(4);
    const titles = cards.map(
      (card) => find(card, 'claudian-work-order-modal-collapse-title')!.text,
    );
    expect(titles).toEqual(['Summary', 'Verification', 'Risks', 'Next action']);
  });

  it('defaults Summary and Next action open; Verification and Risks closed (aria-expanded)', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const [summary, verification, risks, nextAction] = handoffCards(main);
    expect(cardButton(summary).attrs['aria-expanded']).toBe('true');
    expect(cardButton(verification).attrs['aria-expanded']).toBe('false');
    expect(cardButton(risks).attrs['aria-expanded']).toBe('false');
    expect(cardButton(nextAction).attrs['aria-expanded']).toBe('true');

    // Open cards carry the open modifier and render a body; closed cards do not.
    expect(summary.classes.has('is-open')).toBe(true);
    expect(find(summary, 'claudian-work-order-modal-collapse-body')).toBeDefined();
    expect(verification.classes.has('is-open')).toBe(false);
    expect(find(verification, 'claudian-work-order-modal-collapse-body')).toBeUndefined();
  });

  it('uses a real <button> header with a rotating chevron and a colored section icon', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const [summary] = handoffCards(main);
    const button = cardButton(summary);
    expect(button.tag).toBe('button');
    // Chevron glyph (rotates via CSS on expand) + a per-section colored icon.
    const chevron = find(summary, 'claudian-work-order-modal-collapse-chevron');
    expect(chevron!.attrs['data-icon']).toBe('chevron-right');
    expect(chevron!.attrs['aria-hidden']).toBe('true');
    const sectionIcon = find(summary, 'claudian-work-order-modal-collapse-icon');
    expect(sectionIcon).toBeDefined();
    expect(sectionIcon!.attrs['aria-hidden']).toBe('true');
  });

  it('keys each card icon color off a per-section modifier class', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const [summary, verification, risks, nextAction] = handoffCards(main);
    expect(summary.classes.has('claudian-work-order-modal-collapse--summary')).toBe(true);
    expect(verification.classes.has('claudian-work-order-modal-collapse--verification')).toBe(true);
    expect(risks.classes.has('claudian-work-order-modal-collapse--risks')).toBe(true);
    expect(nextAction.classes.has('claudian-work-order-modal-collapse--next')).toBe(true);
  });

  it('renders each section body through MarkdownRenderer (inline links stay live)', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    // Default-open cards render their body immediately.
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === 'Implemented the activity block.')).toBe(true);
    expect(calls.some((c) => c[1] === 'Review and merge.')).toBe(true);

    // Expanding a closed card renders its body through MarkdownRenderer too.
    const [, verification] = handoffCards(main);
    cardButton(verification).emit('click');
    const after = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(after.some((c) => c[1] === 'All gates pass.')).toBe(true);
  });

  it('toggles aria-expanded and the open modifier on click', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    const [, verification] = handoffCards(main);
    const button = cardButton(verification);
    expect(button.attrs['aria-expanded']).toBe('false');
    button.emit('click');
    expect(button.attrs['aria-expanded']).toBe('true');
    expect(verification.classes.has('is-open')).toBe(true);
    expect(find(verification, 'claudian-work-order-modal-collapse-body')).toBeDefined();
    button.emit('click');
    expect(button.attrs['aria-expanded']).toBe('false');
    expect(verification.classes.has('is-open')).toBe(false);
  });

  it('falls back to the full handoff markdown when it parses into no known section', () => {
    const raw = 'Totally freeform handoff with no structured headings at all.';
    const main = openMain(makeTask('t', 'review', raw));
    // No structured cards — but the raw content is still rendered (no content loss).
    expect(handoffCards(main)).toHaveLength(0);
    const fallback = find(main, 'claudian-work-order-modal-handoff-fallback');
    expect(fallback).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === raw)).toBe(true);
  });
});

describe('WorkOrderDetailModal — Activity block (needs_handoff salvage)', () => {
  function openMain(task: TaskSpec): RecordingEl {
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    return find(root, 'claudian-work-order-modal-main')!;
  }

  it('renders the warning callout only for needs_handoff', () => {
    const main = openMain(makeTask('t', 'needs_handoff', '', '- 2026-06-04T00:00:00Z [running] step'));
    expect(find(main, 'claudian-work-order-modal-salvage-callout')).toBeDefined();
  });

  it('does not render the salvage callout for review', () => {
    const main = openMain(makeTask('t', 'review', CANONICAL_HANDOFF));
    expect(find(main, 'claudian-work-order-modal-salvage-callout')).toBeUndefined();
  });

  it('renders a collapsible Transcript tail (keyboard button + aria-expanded) from the ledger', () => {
    const main = openMain(
      makeTask('t', 'needs_handoff', '', '- 2026-06-04T00:00:00Z [running] doing the work'),
    );
    const tail = find(main, 'claudian-work-order-modal-collapse');
    expect(tail).toBeDefined();
    const button = find(tail!, 'claudian-work-order-modal-collapse-head');
    expect(button!.tag).toBe('button');
    expect(button!.attrs['aria-expanded']).toBeDefined();
    // Monospace trace surface sourced from the ledger region.
    const traceBody = find(main, 'claudian-work-order-modal-tail-body');
    expect(traceBody).toBeDefined();
    expect(traceBody!.text).toContain('doing the work');
  });

  it('shows an empty-state in the transcript tail when no ledger trace exists', () => {
    const main = openMain(makeTask('t', 'needs_handoff', '', ''));
    const traceBody = find(main, 'claudian-work-order-modal-tail-body');
    expect(traceBody).toBeDefined();
    expect(traceBody!.text.length).toBeGreaterThan(0);
  });
});

describe('WorkOrderDetailModal — Activity block (failed Run ledger)', () => {
  const LEDGER = [
    '- 2026-06-04T00:00:00Z [running] started the run',
    '- 2026-06-04T00:05:00Z [failed] hit an error',
  ].join('\n');

  function openMain(task: TaskSpec): RecordingEl {
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    return find(root, 'claudian-work-order-modal-main')!;
  }

  it('renders the Run ledger section header (scroll-text) only for failed', () => {
    const main = openMain(makeTask('t', 'failed', '', LEDGER));
    const section = findSection(main, 'Run ledger');
    expect(section).toBeDefined();
    const icon = find(section!, 'claudian-work-order-modal-section-icon');
    expect(icon!.attrs['data-icon']).toBe('scroll-text');
  });

  it('does not render the Run ledger when the ledger is empty', () => {
    const main = openMain(makeTask('t', 'failed', '', ''));
    expect(findSection(main, 'Run ledger')).toBeUndefined();
  });

  it('renders one entry per parsed line with monospace time + message', () => {
    const main = openMain(makeTask('t', 'failed', '', LEDGER));
    const entries = findAll(main, (el) => el.classes.has('claudian-work-order-modal-ledger-entry'));
    expect(entries).toHaveLength(2);
    const times = entries.map((e) => find(e, 'claudian-work-order-modal-ledger-time')!.text);
    expect(times).toEqual(['2026-06-04T00:00:00Z', '2026-06-04T00:05:00Z']);
    const messages = entries.map((e) => find(e, 'claudian-work-order-modal-ledger-msg')!.text);
    expect(messages).toEqual(['started the run', 'hit an error']);
  });

  it('colors each dot off the entry status modifier (status → color contract)', () => {
    const main = openMain(makeTask('t', 'failed', '', LEDGER));
    const entries = findAll(main, (el) => el.classes.has('claudian-work-order-modal-ledger-entry'));
    const firstDot = find(entries[0], 'claudian-work-order-modal-ledger-dot')!;
    const secondDot = find(entries[1], 'claudian-work-order-modal-ledger-dot')!;
    expect(firstDot.classes.has('claudian-work-order-modal-ledger-dot--running')).toBe(true);
    expect(secondDot.classes.has('claudian-work-order-modal-ledger-dot--failed')).toBe(true);
  });

  it('tolerates malformed lines (renders only the well-formed entries)', () => {
    const main = openMain(
      makeTask(
        't',
        'failed',
        '',
        ['garbage line without structure', '- 2026-06-04T00:00:00Z [done] ok'].join('\n'),
      ),
    );
    const entries = findAll(main, (el) => el.classes.has('claudian-work-order-modal-ledger-entry'));
    expect(entries).toHaveLength(1);
    expect(find(entries[0], 'claudian-work-order-modal-ledger-msg')!.text).toBe('ok');
  });
});

describe('WorkOrderDetailModal — Activity block (other statuses)', () => {
  function openMain(task: TaskSpec): RecordingEl {
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();
    return find(root, 'claudian-work-order-modal-main')!;
  }

  it('renders no activity block for running (even with a ledger present)', () => {
    const main = openMain(makeTask('t', 'running', '', '- 2026-06-04T00:00:00Z [running] x'));
    expect(findSection(main, 'Agent handoff')).toBeUndefined();
    expect(findSection(main, 'Run ledger')).toBeUndefined();
    expect(find(main, 'claudian-work-order-modal-salvage-callout')).toBeUndefined();
  });

  it('renders no activity block for done (even with a handoff present)', () => {
    const main = openMain(makeTask('t', 'done', CANONICAL_HANDOFF, 'x'));
    expect(findSection(main, 'Agent handoff')).toBeUndefined();
    expect(findSection(main, 'Run ledger')).toBeUndefined();
    expect(find(main, 'claudian-work-order-modal-salvage-callout')).toBeUndefined();
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
    // The label flows through MarkdownRenderer (inline markdown stays live).
    const firstHasText = find(first, 'claudian-work-order-modal-checklist-text');
    expect(firstHasText).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === 'First done')).toBe(true);

    // Unchecked rows are not marked checked.
    expect(second.classes.has('is-checked')).toBe(false);

    // Read-only checkbox semantics expose the checked state to assistive tech.
    expect(first.attrs['role']).toBe('checkbox');
    expect(first.attrs['aria-checked']).toBe('true');
    expect(first.attrs['aria-disabled']).toBe('true');
    expect(second.attrs['aria-checked']).toBe('false');
  });

  it('renders checklist item labels through MarkdownRenderer so inline links stay live', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [ ] Update [[Spec]] and [docs](https://x)';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    // Pure checklist keeps the custom card, but the label renders as markdown.
    expect(find(section, 'claudian-work-order-modal-checklist')).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === 'Update [[Spec]] and [docs](https://x)')).toBe(true);
  });

  it('renders nested task-list acceptance criteria as markdown (preserves hierarchy)', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [ ] Parent\n  - [ ] Child';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    // Nested lists must not be flattened into the custom card.
    expect(find(section, 'claudian-work-order-modal-checklist')).toBeUndefined();
    expect(find(section, 'claudian-work-order-modal-checklist-prose')).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === '- [ ] Parent\n  - [ ] Child')).toBe(true);
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

  it('renders non-checkbox acceptance criteria as markdown instead of dropping them', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- Includes all task metadata\n- Renders without checkboxes';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    // Prose / plain-bullet criteria (no task-list syntax) must not collapse to an em dash.
    expect(find(section, 'claudian-work-order-modal-checklist-empty')).toBeUndefined();
    expect(find(section, 'claudian-work-order-modal-checklist-prose')).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(
      calls.some((c) => c[1] === '- Includes all task metadata\n- Renders without checkboxes'),
    ).toBe(true);
  });

  it('renders mixed checkbox + prose acceptance criteria as full markdown (no dropped lines)', () => {
    const task = makeTask('t', 'inbox');
    task.sections.acceptanceCriteria = '- [ ] Implement API\n- Include retry behavior';
    const { main } = openMain(task);
    const section = findSection(main, 'Acceptance criteria')!;
    // Mixed content (checkbox + plain bullet) must not collapse to only the checkbox row.
    expect(find(section, 'claudian-work-order-modal-checklist')).toBeUndefined();
    expect(find(section, 'claudian-work-order-modal-checklist-prose')).toBeDefined();
    const calls = (MarkdownRenderer.render as jest.Mock).mock.calls as unknown[][];
    expect(calls.some((c) => c[1] === '- [ ] Implement API\n- Include retry behavior')).toBe(true);
  });
});

describe('WorkOrderDetailModal — header (title + meta)', () => {
  function openHeader(task: TaskSpec, callbacks = makeCallbacks()): {
    modal: WorkOrderDetailModal;
    root: RecordingEl;
    header: RecordingEl;
  } {
    const modal = new WorkOrderDetailModal(mockApp, task, callbacks);
    const root = installRecordingContent(modal);
    modal.onOpen();
    const header = find(root, 'claudian-work-order-modal-header');
    expect(header).toBeDefined();
    return { modal, root, header: header! };
  }

  const titleEl = (header: RecordingEl): RecordingEl | undefined =>
    find(header, 'claudian-work-order-modal-title');

  it('does not drive the native modal title (the header owns it)', () => {
    const task = makeTask('WO-7', 'inbox');
    const { modal } = openHeader(task);
    expect((modal as unknown as { setTitle: jest.Mock }).setTitle).not.toHaveBeenCalled();
  });

  it('renders the ID chip from frontmatter.id with a monospace class and a tooltip', () => {
    const { header } = openHeader(makeTask('WO-204', 'inbox'));
    const chip = find(header, 'claudian-work-order-modal-id-chip');
    expect(chip).toBeDefined();
    expect(chip!.text).toBe('WO-204');
    expect(chip!.classes.has('claudian-work-order-modal-mono')).toBe(true);
    // Tooltip surfaces the full id (truncation-safe) via title + aria-label.
    expect(chip!.attrs['title']).toBe('WO-204');
    expect(chip!.attrs['aria-label']).toBe('WO-204');
  });

  it('renders the title text from frontmatter.title', () => {
    const { header } = openHeader(makeTask('WO-1', 'inbox'));
    expect(titleEl(header)!.text).toBe('Task WO-1');
  });

  it('renders a 2px accent gradient line on the header', () => {
    const { header } = openHeader(makeTask('WO-1', 'inbox'));
    expect(find(header, 'claudian-work-order-modal-header-accent')).toBeDefined();
  });

  it('exposes the dialog accessible name via aria-labelledby on the title', () => {
    const { modal, header } = openHeader(makeTask('WO-1', 'inbox'));
    expect(titleEl(header)!.attrs['id']).toBe('claudian-work-order-modal-title');
    const setAttribute = (modal as unknown as { modalEl: { setAttribute: jest.Mock } }).modalEl
      .setAttribute;
    expect(setAttribute).toHaveBeenCalledWith('aria-labelledby', 'claudian-work-order-modal-title');
  });

  it('marks the static (non-editable) title as a heading', () => {
    const { header } = openHeader(makeTask('WO-1', 'review'));
    const title = titleEl(header)!;
    expect(title.attrs['role']).toBe('heading');
    expect(title.attrs['aria-level']).toBe('2');
    // Non-editable: no contenteditable affordance.
    expect(title.attrs['contenteditable']).toBeUndefined();
  });

  // ---- Editable states (inbox / ready / needs_fix) ----

  it.each(['inbox', 'ready', 'needs_fix'] as const)(
    'renders an editable plaintext-only title with the rename hint in %s',
    (status) => {
      const { header } = openHeader(makeTask('WO-1', status));
      const title = titleEl(header)!;
      expect(title.classes.has('is-editable')).toBe(true);
      // Hard requirement: a contenteditable title must clamp to plaintext-only.
      expect(title.attrs['contenteditable']).toBe('plaintext-only');
      // Keyboard-focusable.
      expect(title.attrs['tabindex']).toBe('0');
      // The rename hint is present only in editable states.
      const hint = find(header, 'claudian-work-order-modal-title-hint');
      expect(hint).toBeDefined();
      expect(hint!.text.length).toBeGreaterThan(0);
    },
  );

  it('saves a changed, non-empty title on blur via onSaveFields', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = 'Renamed work order';
    title.emit('blur');

    expect(onSaveFields).toHaveBeenCalledWith(task, { title: 'Renamed work order' });
  });

  it('trims whitespace from the saved title', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = '  Trimmed title  ';
    title.emit('blur');

    expect(onSaveFields).toHaveBeenCalledWith(task, { title: 'Trimmed title' });
  });

  it('does not save when the title is unchanged on blur', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    // Blur without editing (value still equals the original).
    title.emit('blur');
    expect(onSaveFields).not.toHaveBeenCalled();
  });

  it('does not save when the title is emptied on blur', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = '   ';
    title.emit('blur');
    expect(onSaveFields).not.toHaveBeenCalled();
    // The rejected empty edit reverts the display to the committed title so the
    // header never lingers in a blank unsaved state.
    expect(title.textContent).toBe('Task WO-1');
  });

  it('does not save twice when blurred again after a committed rename', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = 'First rename';
    title.emit('blur');
    title.emit('blur');
    expect(onSaveFields).toHaveBeenCalledTimes(1);
  });

  it('commits on Enter (prevents default newline and blurs to save)', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = 'Committed via Enter';
    let defaultPrevented = false;
    title.emit('keydown', { key: 'Enter', preventDefault: () => (defaultPrevented = true) });

    expect(defaultPrevented).toBe(true);
    expect(onSaveFields).toHaveBeenCalledWith(task, { title: 'Committed via Enter' });
  });

  it('does not commit on Enter while an IME composition is active', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = 'composing 日本';
    let defaultPrevented = false;
    title.emit('keydown', {
      key: 'Enter',
      isComposing: true,
      preventDefault: () => (defaultPrevented = true),
    });

    // The IME owns this Enter (candidate confirm) — no preventDefault, no save.
    expect(defaultPrevented).toBe(false);
    expect(onSaveFields).not.toHaveBeenCalled();
  });

  it('reverts on Escape (restores the original and does not save)', () => {
    const onSaveFields = jest.fn();
    const task = makeTask('WO-1', 'inbox');
    const { header } = openHeader(task, { ...makeCallbacks(), onSaveFields });
    const title = titleEl(header)!;

    title.textContent = 'Discarded edit';
    title.emit('keydown', { key: 'Escape' });

    // Original text restored; the subsequent blur must not save.
    expect(title.textContent).toBe('Task WO-1');
    expect(onSaveFields).not.toHaveBeenCalled();
  });

  // ---- Non-editable states ----

  it.each(['running', 'review', 'done', 'needs_handoff', 'failed', 'canceled'] as const)(
    'renders a plain, non-editable title with no rename hint in %s',
    (status) => {
      const { header } = openHeader(makeTask('WO-1', status, 'Handoff text.', 'x'));
      const title = titleEl(header)!;
      expect(title.attrs['contenteditable']).toBeUndefined();
      expect(title.classes.has('is-editable')).toBe(false);
      expect(find(header, 'claudian-work-order-modal-title-hint')).toBeUndefined();
    },
  );

  it('does not call onSaveFields from a non-editable title', () => {
    const onSaveFields = jest.fn();
    const { header } = openHeader(makeTask('WO-1', 'review', 'Handoff.'), {
      ...makeCallbacks(),
      onSaveFields,
    });
    const title = titleEl(header)!;
    title.textContent = 'attempted edit';
    title.emit('blur');
    expect(onSaveFields).not.toHaveBeenCalled();
  });

  // ---- Status-aware meta caption ----

  it('renders a pulsing live dot + a started caption for running', () => {
    const task = makeTask('WO-1', 'running');
    task.frontmatter.started = new Date(Date.now() - 5 * 60_000).toISOString();
    const { header } = openHeader(task);
    expect(find(header, 'claudian-work-order-modal-header-live')).toBeDefined();
    expect(find(header, 'claudian-work-order-modal-live-dot')).toBeDefined();
  });

  it('renders a finished caption for done', () => {
    const task = makeTask('WO-1', 'done');
    task.frontmatter.finished = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const { header } = openHeader(task);
    expect(find(header, 'claudian-work-order-modal-header-sub')).toBeDefined();
  });

  // ---- Close button ----

  it('renders a keyboard-focusable close button with an accessible name that closes the modal', () => {
    const task = makeTask('WO-1', 'inbox');
    const { modal, header } = openHeader(task);
    const close = find(header, 'claudian-work-order-modal-close');
    expect(close).toBeDefined();
    expect(close!.tag).toBe('button');
    expect(close!.attrs['aria-label']!.length).toBeGreaterThan(0);

    close!.emit('click');
    expect((modal as unknown as { close: jest.Mock }).close).toHaveBeenCalled();
  });
});
