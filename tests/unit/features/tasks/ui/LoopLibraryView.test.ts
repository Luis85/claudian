/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';
import { LoopLibraryView, VIEW_TYPE_LOOP_LIBRARY } from '../../../../../src/features/tasks/ui/LoopLibraryView';

const openMock = jest.fn();
jest.mock('../../../../../src/features/tasks/ui/LoopEditorModal', () => ({
  LoopEditorModal: jest.fn().mockImplementation(() => ({ open: openMock })),
}));

const confirmMock = jest.fn();
jest.mock('../../../../../src/shared/modals/ConfirmModal', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

const deleteMock = jest.fn();
jest.spyOn(LoopNoteStore.prototype, 'delete').mockImplementation(async (...args) => deleteMock(...args));

const installStarterMock = jest.fn();
jest.mock('../../../../../src/features/tasks/loops/installPresetLoops', () => ({
  installPresetLoopsWithNotice: (...args: unknown[]) => installStarterMock(...args),
}));

const store = new LoopNoteStore();
const LOOP_A = store.build({
  name: 'Alpha Loop',
  description: 'Runs the alpha playbook.',
  useWhen: 'When testing alpha.',
  approach: 'Run tests.',
  steps: '1. Test.',
  verify: 'Green.',
  notes: '',
});
const LOOP_B = store.build({
  name: 'Beta Loop',
  useWhen: '',
  approach: 'Ship it.',
  steps: '',
  verify: '',
  notes: '',
});

function makeVault(files: Record<string, string>) {
  return {
    getMarkdownFiles: () => Object.keys(files).map((path) => ({ path })),
    read: async (file: { path: string }) => files[file.path],
  };
}

function makePlugin(files: Record<string, string>) {
  return {
    app: { vault: makeVault(files) },
    settings: { agentBoardLoopFolder: 'Agent Board/loops' },
    logger: { scope: () => ({ error: jest.fn() }) },
  } as any;
}

function makeView(plugin: any): { view: LoopLibraryView; contentEl: HTMLElement } {
  const view = new LoopLibraryView({} as any, plugin);
  const contentEl = document.createElement('div');
  (view as unknown as { contentEl: HTMLElement }).contentEl = contentEl;
  return { view, contentEl };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  openMock.mockClear();
  confirmMock.mockReset();
  deleteMock.mockReset();
  installStarterMock.mockReset();
  installStarterMock.mockResolvedValue(undefined);
});

describe('LoopLibraryView', () => {
  it('exposes the stable view type and metadata', () => {
    const { view } = makeView(makePlugin({}));
    expect(VIEW_TYPE_LOOP_LIBRARY).toBe('specorator-loop-library');
    expect(view.getViewType()).toBe(VIEW_TYPE_LOOP_LIBRARY);
    expect(view.getIcon()).toBe('repeat');
    expect(view.getDisplayText()).toBe('Loop library');
  });

  it('renders the shell, nav strip, and a New loop action', async () => {
    const { view, contentEl } = makeView(makePlugin({}));
    await view.onOpen();
    await flush();

    expect(contentEl.classList.contains('specorator-library')).toBe(true);
    expect(contentEl.querySelector('.specorator-library-nav')).not.toBeNull();
    const navItems = contentEl.querySelectorAll('.specorator-library-nav-item');
    expect(navItems.length).toBe(4);
    const headerButtons = Array.from(
      contentEl.querySelectorAll('.specorator-library-header-actions button'),
    ).map((b) => b.textContent);
    expect(headerButtons).toEqual(['New loop', 'Install starter loops']);
    const newBtn = contentEl.querySelector('.specorator-library-header-actions .mod-cta');
    expect(newBtn?.textContent).toBe('New loop');
  });

  it('clicking Install starter loops installs the preset loops and re-renders', async () => {
    const { view, contentEl } = makeView(makePlugin({}));
    await view.onOpen();
    await flush();

    const installBtn = Array.from(contentEl.querySelectorAll('.specorator-library-header-actions button'))
      .find((b) => b.textContent === 'Install starter loops') as HTMLButtonElement;
    expect(installBtn).toBeDefined();
    installBtn.click();
    await flush();

    expect(installStarterMock).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no loops', async () => {
    const { view, contentEl } = makeView(makePlugin({}));
    await view.onOpen();
    await flush();

    const empty = contentEl.querySelector('.specorator-library-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No loops yet.');
    expect(contentEl.querySelectorAll('.specorator-library-card').length).toBe(0);
  });

  it('renders one card per loop with name, description, and use-when', async () => {
    const { view, contentEl } = makeView(makePlugin({
      'Agent Board/loops/alpha-loop.md': LOOP_A,
      'Agent Board/loops/beta-loop.md': LOOP_B,
    }));
    await view.onOpen();
    await flush();

    const cards = contentEl.querySelectorAll('.specorator-library-card');
    expect(cards.length).toBe(2);

    const names = Array.from(contentEl.querySelectorAll('.specorator-library-card-name')).map((n) => n.textContent);
    expect(names).toContain('Alpha Loop');
    expect(names).toContain('Beta Loop');

    const descs = Array.from(contentEl.querySelectorAll('.specorator-library-card-desc')).map((d) => d.textContent);
    expect(descs).toContain('Runs the alpha playbook.');
    expect(descs.some((d) => d?.startsWith('Use when:'))).toBe(true);
  });

  it('wires Edit and Delete buttons on each card', async () => {
    const { view, contentEl } = makeView(makePlugin({
      'Agent Board/loops/alpha-loop.md': LOOP_A,
    }));
    await view.onOpen();
    await flush();

    const card = contentEl.querySelector('.specorator-library-card')!;
    const buttons = Array.from(card.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Edit', 'Delete']);
    expect(card.querySelector('.specorator-library-card-delete')).not.toBeNull();
  });

  it('clicking Edit opens the loop editor modal', async () => {
    const { view, contentEl } = makeView(makePlugin({
      'Agent Board/loops/alpha-loop.md': LOOP_A,
    }));
    await view.onOpen();
    await flush();

    const editBtn = Array.from(contentEl.querySelectorAll('.specorator-library-card button'))
      .find((b) => b.textContent === 'Edit') as HTMLButtonElement;
    editBtn.click();
    expect(openMock).toHaveBeenCalled();
  });

  it('clicking New loop opens the editor', async () => {
    const { view, contentEl } = makeView(makePlugin({}));
    await view.onOpen();
    await flush();

    const newBtn = contentEl.querySelector('.specorator-library-header-actions .mod-cta') as HTMLButtonElement;
    newBtn.click();
    expect(openMock).toHaveBeenCalled();
  });

  it('Delete confirms before removing and skips deletion when declined', async () => {
    confirmMock.mockResolvedValue(false);
    const { view, contentEl } = makeView(makePlugin({
      'Agent Board/loops/alpha-loop.md': LOOP_A,
    }));
    await view.onOpen();
    await flush();

    const deleteBtn = contentEl.querySelector('.specorator-library-card-delete') as HTMLButtonElement;
    deleteBtn.click();
    await flush();

    expect(confirmMock).toHaveBeenCalledWith(expect.anything(), 'Delete the loop "Alpha Loop"?', 'Delete');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('Delete removes the loop when confirmed', async () => {
    confirmMock.mockResolvedValue(true);
    const plugin = makePlugin({
      'Agent Board/loops/alpha-loop.md': LOOP_A,
    });
    const { view, contentEl } = makeView(plugin);
    await view.onOpen();
    await flush();

    const deleteBtn = contentEl.querySelector('.specorator-library-card-delete') as HTMLButtonElement;
    deleteBtn.click();
    await flush();

    expect(deleteMock).toHaveBeenCalledWith(plugin.app, 'Agent Board/loops/alpha-loop.md');
  });
});
