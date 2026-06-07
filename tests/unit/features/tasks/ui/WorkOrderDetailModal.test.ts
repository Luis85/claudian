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

function getSettingNames(): string[] {
  return settingInstances()
    .map((s) => (s.setName as jest.Mock).mock.calls.at(-1)?.[0])
    .filter((name): name is string => typeof name === 'string');
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


describe('WorkOrderDetailModal � read-only callbacks', () => {
  it('hides running-only action buttons when optional callbacks are absent', () => {
    const modal = new WorkOrderDetailModal(mockApp, makeTask('readonly-running', 'running'), {
      onOpenNote: jest.fn(),
      getProviderOptions: () => [],
      getModelOptions: () => [],
    });
    modal.onOpen();

    expect(getButtonTexts()).toEqual(['Edit']);
  });

  it('renders Stop when the optional stop callback is present', () => {
    const modal = new WorkOrderDetailModal(mockApp, makeTask('stoppable-running', 'running'), {
      onOpenNote: jest.fn(),
      onStop: jest.fn(),
      getProviderOptions: () => [],
      getModelOptions: () => [],
    });
    modal.onOpen();

    expect(getButtonTexts()).toContain('Stop');
  });


  it('keeps running fallback modals read-only when stop callback is absent', () => {
    const modal = new WorkOrderDetailModal(mockApp, makeTask('readonly-running', 'running'), {
      onOpenNote: jest.fn(),
      getProviderOptions: () => [],
      getModelOptions: () => [],
    });
    modal.onOpen();

    expect(getSettingNames()).not.toContain('Title');
  });

  it('renders review actions only when their callbacks are present', () => {
    const modal = new WorkOrderDetailModal(mockApp, makeTask('accept-only', 'review'), {
      onOpenNote: jest.fn(),
      onAccept: jest.fn(),
      getProviderOptions: () => [],
      getModelOptions: () => [],
    });
    modal.onOpen();

    expect(getButtonTexts()).toContain('Accept');
    expect(getButtonTexts()).not.toContain('Rework');
  });
});
