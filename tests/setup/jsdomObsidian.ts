// Integration-test seam for Obsidian's Modal under jsdom.
//
// The canonical mock (tests/__mocks__/obsidian.ts) is a *unit* stub: Modal.open
// is a no-op spy and contentEl is a fake element. Integration tests that drive a
// real Modal subclass end-to-end need open() to actually invoke onOpen() against
// real jsdom DOM, plus a real titleEl. JsdomModal is that single, shared
// override — everything else (Notice, TFile, Setting, normalizePath, ...) stays
// sourced from the one canonical mock via jsdomObsidianMock(), so the surface
// never drifts the way per-test inline `jest.mock('obsidian', ...)` copies did.
//
// Pair with `import './setup/obsidianDom'` (or a transitive import of it) so the
// createDiv/createEl/setText prototype helpers exist on the jsdom elements.

export class JsdomModal {
  app: unknown;
  contentEl: HTMLElement = document.createElement('div');
  modalEl: HTMLElement = document.createElement('div');
  titleEl: HTMLElement = document.createElement('div');
  scope = { register: jest.fn() };

  constructor(app: unknown) {
    this.app = app;
  }

  open(): void {
    document.body.appendChild(this.contentEl);
    this.onOpen();
  }

  close(): void {
    this.onClose();
    this.contentEl.remove();
  }

  setTitle(): this {
    return this;
  }

  onOpen(): void {}
  onClose(): void {}
}

// Build an `obsidian` module mock that reuses the canonical mock for everything
// except the jsdom-driving Modal (and any caller-supplied overrides). Call from
// inside a `jest.mock('obsidian', () => require('.../jsdomObsidian').jsdomObsidianMock())`
// factory; `jest.requireActual` resolves through moduleNameMapper to the
// canonical mock, not the real package.
export function jsdomObsidianMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(jest.requireActual('obsidian') as Record<string, unknown>),
    Modal: JsdomModal,
    ...overrides,
  };
}
