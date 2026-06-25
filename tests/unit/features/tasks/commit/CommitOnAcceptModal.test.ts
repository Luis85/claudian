/**
 * @jest-environment jsdom
 */
import { CommitOnAcceptModal } from '@/features/tasks/commit/CommitOnAcceptModal';

type ElementOpts = {
  cls?: string | string[];
  text?: string;
  type?: string;
  attr?: Record<string, string>;
};

function decorate<T extends HTMLElement>(el: T): T {
  const decorated = el as unknown as Record<string, unknown> & T;
  decorated.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  decorated.addClass = function (this: HTMLElement, ...names: string[]) {
    for (const name of names) this.classList.add(name);
  };
  decorated.removeClass = function (this: HTMLElement, ...names: string[]) {
    for (const name of names) this.classList.remove(name);
  };
  decorated.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
  };
  decorated.createDiv = function (
    this: HTMLElement,
    options?: string | ElementOpts,
  ) {
    return appendChild(this, document.createElement('div'), options);
  };
  decorated.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options?: ElementOpts,
  ) {
    return appendChild(this, document.createElement(tag), options);
  };
  decorated.createSpan = function (
    this: HTMLElement,
    options?: string | ElementOpts,
  ) {
    return appendChild(this, document.createElement('span'), options);
  };
  return decorated as T;
}

function appendChild<T extends HTMLElement>(
  parent: HTMLElement,
  child: T,
  options?: string | ElementOpts,
): T {
  if (typeof options === 'string') {
    child.className = options;
  } else if (options) {
    if (options.cls) {
      const cls = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
      child.className = cls;
    }
    if (options.text !== undefined) child.textContent = options.text;
    if (options.type && 'type' in child) (child as unknown as HTMLInputElement).type = options.type;
    if (options.attr) {
      for (const [k, v] of Object.entries(options.attr)) child.setAttribute(k, v);
    }
  }
  parent.appendChild(child);
  return decorate(child);
}

jest.mock('obsidian', () => {
  class Modal {
    app: unknown;
    modalEl: HTMLElement;
    titleEl: HTMLElement;
    contentEl: HTMLElement;
    containerEl: HTMLElement;
    onOpen?: () => void;
    onClose?: () => void;
    constructor(app: unknown) {
      this.app = app;
      this.modalEl = decorate(document.createElement('div'));
      this.titleEl = decorate(document.createElement('div'));
      this.contentEl = decorate(document.createElement('div'));
      this.containerEl = decorate(document.createElement('div'));
    }
    open = jest.fn(function (this: Modal) {
      this.onOpen?.();
    });
    close = jest.fn();
  }
  return {
    Modal,
    Notice: jest.fn(),
    setIcon: jest.fn(),
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (key === 'tasks.commitOnAccept.title') return 'Commit & push?';
    if (key === 'tasks.commitOnAccept.bodyOne') return `Accepted "${params?.title}". 1 file changed in the vault git repo.`;
    if (key === 'tasks.commitOnAccept.bodyMany') return `Accepted "${params?.title}". ${params?.count} files changed in the vault git repo.`;
    if (key === 'tasks.commitOnAccept.dontAsk') return "Don't ask again for this vault";
    if (key === 'tasks.commitOnAccept.skip') return 'Skip';
    if (key === 'tasks.commitOnAccept.commitAndPush') return 'Commit & push';
    return key;
  },
}));

function mountModal(opts: { taskTitle: string; dirtyCount: number }) {
  const app = {} as ConstructorParameters<typeof CommitOnAcceptModal>[0];
  const modal = new CommitOnAcceptModal(app, opts);
  modal.onOpen();
  return modal;
}

describe('CommitOnAcceptModal', () => {
  it('renders the task title and pluralised file count', () => {
    const modal = mountModal({ taskTitle: 'Refactor X', dirtyCount: 1 });
    expect(modal.contentEl.textContent).toContain('Refactor X');
    expect(modal.contentEl.textContent).toContain('1 file');
    expect(modal.contentEl.textContent).not.toContain('1 files');
  });

  it('renders pluralised count when dirtyCount > 1', () => {
    const modal = mountModal({ taskTitle: 'Refactor X', dirtyCount: 4 });
    expect(modal.contentEl.textContent).toContain('4 files');
  });

  it('resolves { confirmed: true, dontAskAgain: false } when Commit & push is clicked', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    const ctaBtn = modal.contentEl.querySelector(
      '[data-specorator-commit-on-accept="confirm"]',
    ) as HTMLButtonElement;
    ctaBtn.click();
    await expect(promise).resolves.toEqual({ confirmed: true, dontAskAgain: false });
  });

  it('resolves { confirmed: false, dontAskAgain: true } when Skip is clicked with checkbox checked', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    const cb = modal.contentEl.querySelector(
      '[data-specorator-commit-on-accept="dont-ask"]',
    ) as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    const skipBtn = modal.contentEl.querySelector(
      '[data-specorator-commit-on-accept="skip"]',
    ) as HTMLButtonElement;
    skipBtn.click();
    await expect(promise).resolves.toEqual({ confirmed: false, dontAskAgain: true });
  });

  it('resolves { confirmed: false, dontAskAgain: false } when onClose runs without a button click', async () => {
    const modal = mountModal({ taskTitle: 'X', dirtyCount: 2 });
    const promise = modal.result();
    modal.onClose();
    await expect(promise).resolves.toEqual({ confirmed: false, dontAskAgain: false });
  });
});
