import { Setting } from 'obsidian';

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
interface RecordingEl {
  tag: string;
  classes: Set<string>;
  text: string;
  children: RecordingEl[];
  createEl(tag: string, opts?: { text?: string; cls?: string }): RecordingEl;
  createDiv(opts?: { text?: string; cls?: string } | string): RecordingEl;
  createSpan(opts?: { text?: string; cls?: string } | string): RecordingEl;
  addClass(cls: string): RecordingEl;
  removeClass(cls: string): RecordingEl;
  setText(text: string): void;
  empty(): void;
  addEventListener(): void;
}

function makeRecordingEl(tag: string): RecordingEl {
  const normalizeOpts = (
    opts?: { text?: string; cls?: string } | string,
  ): { text?: string; cls?: string } => (typeof opts === 'string' ? { cls: opts } : (opts ?? {}));

  const el: RecordingEl = {
    tag,
    classes: new Set<string>(),
    text: '',
    children: [],
    createEl(childTag: string, opts?: { text?: string; cls?: string }) {
      const child = makeRecordingEl(childTag);
      if (opts?.text) child.text = opts.text;
      if (opts?.cls) opts.cls.split(/\s+/).filter(Boolean).forEach((c) => child.classes.add(c));
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
    empty() {
      this.children = [];
      this.text = '';
    },
    addEventListener() {
      /* noop */
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

function collectHeadingsIn(root: RecordingEl): string[] {
  const headings: string[] = [];
  const walk = (el: RecordingEl): void => {
    if (el.tag === 'h4' && el.text) headings.push(el.text);
    el.children.forEach(walk);
  };
  walk(root);
  return headings;
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

  it('renders markdown headings into the main column, not the footer', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const main = find(root, 'claudian-work-order-modal-main');
    const footer = find(root, 'claudian-work-order-modal-footer');
    expect(collectHeadingsIn(main!)).toEqual(expect.arrayContaining(['Objective']));
    expect(collectHeadingsIn(footer!)).toHaveLength(0);
  });

  it('renders editor settings and status meta into the sidebar region', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const root = installRecordingContent(modal);
    modal.onOpen();

    const sidebar = find(root, 'claudian-work-order-modal-sidebar');
    expect(sidebar).toBeDefined();
    // Status meta chip lives in the sidebar.
    expect(find(sidebar!, 'claudian-work-order-modal-meta')).toBeDefined();
    // Provider/Model/Priority editors render through Setting into the sidebar.
    const sidebarSettings = settingInstances().filter((s) => s.containerEl === sidebar);
    expect(sidebarSettings.length).toBeGreaterThanOrEqual(3);
  });

  it('drops the duplicate Title Setting row from the editors', () => {
    const task = makeTask('t', 'inbox');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    installRecordingContent(modal);
    modal.onOpen();

    const names = settingInstances().flatMap((s) => (s.setName as jest.Mock).mock.calls.map((c) => c[0]));
    expect(names).not.toContain('Title');
    // The editor dropdowns survive the Title removal.
    expect(names).toEqual(expect.arrayContaining(['Provider', 'Model', 'Priority']));
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
