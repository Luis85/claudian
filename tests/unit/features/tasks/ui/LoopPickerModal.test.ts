import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';
import type { LoopPickResult } from '../../../../../src/features/tasks/ui/LoopPickerModal';
import { chooseLoop,LoopPickerModal } from '../../../../../src/features/tasks/ui/LoopPickerModal';

// Build loop note markdown using LoopNoteStore.build so the content is realistic.
const store = new LoopNoteStore();

const LOOP_A_CONTENT = store.build({
  name: 'Alpha Loop',
  useWhen: 'Testing purposes.',
  approach: 'Run tests.',
  steps: '1. Test.',
  verify: 'Green.',
  notes: '',
});

const LOOP_B_CONTENT = store.build({
  name: 'Beta Loop',
  useWhen: 'Shipping.',
  approach: 'Ship it.',
  steps: '',
  verify: 'Deployed.',
  notes: 'Be careful.',
});

function makeVault(files: Record<string, string>) {
  return {
    getMarkdownFiles: () => Object.keys(files).map((path) => ({ path })),
    read: async (file: { path: string }) => files[file.path],
  } as any;
}

function makePlugin(vault: any, loopFolder = 'Agent Board/loops') {
  return {
    app: { vault },
    settings: { agentBoardLoopFolder: loopFolder },
  } as any;
}

const mockApp: any = {
  // LoopPickerModal extends Modal; the mock Modal stores the app reference.
};

// Flush all pending microtasks (for async refreshList).
async function flushAsync(): Promise<void> {
  // Multiple rounds to drain promise chains.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Retrieve the listEl DOM node from the modal's contentEl chain.
// The modal renders: contentEl → .claudian-loops-body → .claudian-loops-list
// The Obsidian mock contentEl is a stub — createDiv/createEl return stubs.
// To test real DOM, we need the actual recorded structure from modalEl/contentEl.
// Since the mock uses jest.fn() stubs, we test behavior via the resolve callback
// and the modal's internal state (chosen, listEl). For DOM assertions we rely on
// the captured element references.

// A more detailed approach: intercept the createDiv/createEl chain so we can
// inspect what was rendered. We'll use a recording stub like WorkOrderDetailModal.test.ts.

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

function installRecordingContent(modal: LoopPickerModal): RecordingEl {
  const contentEl = makeRecordingEl('div');
  (modal as unknown as { contentEl: RecordingEl }).contentEl = contentEl;
  return contentEl;
}

describe('LoopPickerModal — rendering', () => {
  it('renders a "No loop" row and one row per loop after async refresh', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    const modal = new LoopPickerModal(mockApp, plugin, undefined, jest.fn());
    const contentEl = installRecordingContent(modal);

    modal.onOpen();
    await flushAsync();

    // listEl should be populated: none row + alpha-loop row
    const listEl = find(contentEl, 'claudian-loops-list');
    expect(listEl).toBeDefined();

    const rows = findAll(listEl!, (el) => el.classes.has('claudian-loops-row'));
    // At least 2 rows: none + 1 loop
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const noneRow = rows.find((r) => r.classes.has('claudian-loops-row--none'));
    expect(noneRow).toBeDefined();
  });

  it('marks the current loop row as is-active', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      'alpha-loop', // current
      jest.fn(),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list');
    expect(listEl).toBeDefined();

    const rows = findAll(listEl!, (el) => el.classes.has('claudian-loops-row'));
    // The alpha-loop row should be marked active; the none row should not be
    const noneRow = rows.find((r) => r.classes.has('claudian-loops-row--none'))!;
    const loopRow = rows.find((r) => !r.classes.has('claudian-loops-row--none'))!;

    expect(loopRow.classes.has('is-active')).toBe(true);
    expect(noneRow.classes.has('is-active')).toBe(false);
  });

  it('marks the none row is-active when current is undefined', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      undefined, // no current loop
      jest.fn(),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list');
    const rows = findAll(listEl!, (el) => el.classes.has('claudian-loops-row'));
    const noneRow = rows.find((r) => r.classes.has('claudian-loops-row--none'))!;
    expect(noneRow.classes.has('is-active')).toBe(true);
  });

  it('renders rows for multiple loops', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
      'Agent Board/loops/beta-loop.md': LOOP_B_CONTENT,
    });
    const plugin = makePlugin(vault);

    const modal = new LoopPickerModal(mockApp, plugin, undefined, jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list');
    const rows = findAll(listEl!, (el) => el.classes.has('claudian-loops-row'));
    // 1 none row + 2 loop rows
    expect(rows.length).toBe(3);
  });

  it('renders a footer button for adding a new loop', async () => {
    const vault = makeVault({});
    const plugin = makePlugin(vault);

    const modal = new LoopPickerModal(mockApp, plugin, undefined, jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const footerEl = find(contentEl, 'claudian-loops-footer');
    expect(footerEl).toBeDefined();

    const buttons = findAll(footerEl!, (el) => el.tag === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('uses the custom loop folder from plugin settings', async () => {
    const vault = makeVault({
      'Custom/loops-folder/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault, 'Custom/loops-folder');

    const modal = new LoopPickerModal(mockApp, plugin, undefined, jest.fn());
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list');
    const rows = findAll(listEl!, (el) => el.classes.has('claudian-loops-row'));
    expect(rows.length).toBe(2); // none + alpha-loop
  });
});

describe('LoopPickerModal — choosing a loop', () => {
  it('clicking the none-row main resolves { cancelled: false, loopId: "" }', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    let resolveResult: LoopPickResult | undefined;
    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      'alpha-loop',
      (result) => { resolveResult = result; },
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list')!;
    const noneRow = findAll(listEl, (el) => el.classes.has('claudian-loops-row--none'))[0];
    const noneMain = find(noneRow, 'claudian-loops-main')!;
    noneMain.emit('click');

    expect(resolveResult).toEqual({ cancelled: false, loopId: '' });
    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('clicking a loop-row main resolves { cancelled: false, loopId: <slug> }', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    let resolveResult: LoopPickResult | undefined;
    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      undefined,
      (result) => { resolveResult = result; },
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list')!;
    const loopRow = findAll(listEl, (el) =>
      el.classes.has('claudian-loops-row') && !el.classes.has('claudian-loops-row--none'),
    )[0];
    const loopMain = find(loopRow, 'claudian-loops-main')!;
    loopMain.emit('click');

    expect(resolveResult).toEqual({ cancelled: false, loopId: 'alpha-loop' });
    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('does not resolve a second time if choose is called twice (chosen guard)', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    const resolveResults: LoopPickResult[] = [];
    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      undefined,
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    const listEl = find(contentEl, 'claudian-loops-list')!;
    const loopMain = find(
      findAll(listEl, (el) =>
        el.classes.has('claudian-loops-row') && !el.classes.has('claudian-loops-row--none'),
      )[0],
      'claudian-loops-main',
    )!;

    loopMain.emit('click');
    loopMain.emit('click'); // second click should be ignored

    expect(resolveResults).toHaveLength(1);
  });
});

describe('LoopPickerModal — closing without choosing', () => {
  it('resolves { cancelled: true } via the deferred setTimeout path', async () => {
    const vault = makeVault({});
    const plugin = makePlugin(vault);

    jest.useFakeTimers();

    const result = await new Promise<LoopPickResult>((resolve) => {
      const modal = new LoopPickerModal(mockApp, plugin, undefined, resolve);
      installRecordingContent(modal);
      modal.onOpen();
      modal.onClose();
      jest.runAllTimers();
    });
    jest.useRealTimers();

    expect(result).toEqual({ cancelled: true });
  });

  it('does not resolve cancelled if a choice was made before close', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    const resolveResults: LoopPickResult[] = [];
    const modal = new LoopPickerModal(
      mockApp,
      plugin,
      undefined,
      (result) => resolveResults.push(result),
    );
    const contentEl = installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    // Choose a loop first
    const listEl = find(contentEl, 'claudian-loops-list')!;
    const noneMain = find(
      findAll(listEl, (el) => el.classes.has('claudian-loops-row--none'))[0],
      'claudian-loops-main',
    )!;
    noneMain.emit('click');

    // Then close — the setTimeout fires but chosen=true so no second resolve
    jest.useFakeTimers();
    modal.onClose();
    jest.runAllTimers();
    jest.useRealTimers();

    // Only the choice was resolved (not a cancellation)
    expect(resolveResults).toHaveLength(1);
    expect(resolveResults[0]).toEqual({ cancelled: false, loopId: '' });
  });
});

describe('LoopPickerModal — onOpen/onClose lifecycle', () => {
  it('onClose clears contentEl and listEl', async () => {
    const vault = makeVault({
      'Agent Board/loops/alpha-loop.md': LOOP_A_CONTENT,
    });
    const plugin = makePlugin(vault);

    jest.useFakeTimers();

    const modal = new LoopPickerModal(mockApp, plugin, undefined, jest.fn());
    installRecordingContent(modal);
    modal.onOpen();
    await flushAsync();

    // listEl should be set after open
    const listElBefore = (modal as unknown as { listEl: RecordingEl | null }).listEl;
    expect(listElBefore).toBeDefined();

    modal.onClose();
    jest.runAllTimers();
    jest.useRealTimers();

    // listEl should be cleared after close
    const listElAfter = (modal as unknown as { listEl: RecordingEl | null }).listEl;
    expect(listElAfter).toBeNull();
  });
});

describe('chooseLoop helper', () => {
  it('returns a Promise that resolves to a LoopPickResult', () => {
    const vault = makeVault({});
    const plugin = makePlugin(vault);

    // chooseLoop creates and opens a modal — it returns a Promise
    const result = chooseLoop(plugin, undefined);
    expect(result).toBeInstanceOf(Promise);
    // We cannot await it here without the modal being interacted with,
    // so just verify it's a Promise (smoke test).
  });
});
