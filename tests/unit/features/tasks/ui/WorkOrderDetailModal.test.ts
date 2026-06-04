import { Setting } from 'obsidian';

import type { TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';
import {
  WorkOrderDetailModal,
  type WorkOrderDetailModalCallbacks,
} from '../../../../../src/features/tasks/ui/WorkOrderDetailModal';

// The mock Setting tracks all instances in a static array not present in Obsidian's type declarations.
type MockSetting = InstanceType<typeof Setting> & { components: { kind: string; props: { buttonText: string; clickHandler: () => void | Promise<void> } }[] };
const settingInstances = (): MockSetting[] =>
  (Setting as unknown as { instances: MockSetting[] }).instances;

const mockApp: any = {};

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
  const headings: string[] = [];
  const spy = (modal as unknown as { contentEl: { createEl: jest.Mock } }).contentEl.createEl;
  spy.mockImplementation((tag: string, opts?: { text?: string }) => {
    if (tag === 'h4' && opts?.text) {
      headings.push(opts.text);
    }
    return { addEventListener: jest.fn(), addClass: jest.fn() };
  });
  return headings;
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

describe('WorkOrderDetailModal — Handoff visibility', () => {
  it('renders Handoff heading on review when handoff content is present', () => {
    const task = makeTask('t', 'review', 'Prior handoff text.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const headings = collectHeadings(modal);
    modal.onOpen();
    expect(headings).toContain('Handoff');
  });

  it('renders Handoff heading on needs_fix when handoff content is present', () => {
    const task = makeTask('t', 'needs_fix', 'Prior handoff text.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const headings = collectHeadings(modal);
    modal.onOpen();
    expect(headings).toContain('Handoff');
  });

  it('does not render Handoff heading on needs_fix when handoff is empty', () => {
    const task = makeTask('t', 'needs_fix', '');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const headings = collectHeadings(modal);
    modal.onOpen();
    expect(headings).not.toContain('Handoff');
  });

  it('does not render Handoff heading on inbox status', () => {
    const task = makeTask('t', 'inbox', 'Some handoff.');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    const headings = collectHeadings(modal);
    modal.onOpen();
    expect(headings).not.toContain('Handoff');
  });
});

describe('WorkOrderDetailModal — Reopen button', () => {
  it('renders Reopen button for done status', () => {
    const task = makeTask('t', 'done');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    modal.onOpen();
    expect(getButtonTexts()).toContain('Reopen');
  });

  it('does not render Reopen button for failed status', () => {
    const task = makeTask('t', 'failed');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    modal.onOpen();
    expect(getButtonTexts()).not.toContain('Reopen');
  });

  it('does not render Reopen button for canceled status', () => {
    const task = makeTask('t', 'canceled');
    const modal = new WorkOrderDetailModal(mockApp, task, makeCallbacks());
    modal.onOpen();
    expect(getButtonTexts()).not.toContain('Reopen');
  });

  it('calls onReopen and closes when Reopen button is clicked', () => {
    const task = makeTask('t', 'done');
    const callbacks = makeCallbacks();
    const modal = new WorkOrderDetailModal(mockApp, task, callbacks);
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
