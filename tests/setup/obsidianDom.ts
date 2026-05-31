// Polyfills Obsidian's HTMLElement extensions (createDiv, createEl, empty) onto
// jsdom's HTMLElement.prototype so production code that uses them can run under
// the jsdom test environment. Idempotent: safe to import from multiple tests.
//
// Type signatures for these helpers come from `obsidian.d.ts` (which augments
// the global `Node` / `HTMLElement` interfaces). We only install the runtime
// methods here; no global type augmentation, so we do not clash with Obsidian's
// own DomElementInfo signature.

interface CreateOpts {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
  [key: string]: unknown;
}

function applyCreateOpts(el: HTMLElement, opts?: CreateOpts | string): void {
  if (!opts) return;
  if (typeof opts === 'string') {
    el.className = opts;
    return;
  }
  if (opts.cls) {
    el.className = Array.isArray(opts.cls) ? opts.cls.join(' ') : opts.cls;
  }
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.attr) {
    for (const [name, value] of Object.entries(opts.attr)) {
      if (value === null || value === undefined) continue;
      el.setAttribute(name, String(value));
    }
  }
}

export function installObsidianDom(): void {
  const proto = (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement?.prototype as
    | (HTMLElement & Record<string, unknown>)
    | undefined;
  if (!proto) return;

  const protoRecord = proto as unknown as Record<string, unknown>;

  if (typeof protoRecord.createDiv !== 'function') {
    protoRecord.createDiv = function createDiv(
      this: HTMLElement,
      opts?: CreateOpts | string,
    ): HTMLDivElement {
      const child = this.ownerDocument.createElement('div');
      applyCreateOpts(child, opts);
      this.appendChild(child);
      return child;
    };
  }

  if (typeof protoRecord.createEl !== 'function') {
    protoRecord.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
      this: HTMLElement,
      tag: K,
      opts?: CreateOpts | string,
    ): HTMLElementTagNameMap[K] {
      const child = this.ownerDocument.createElement(tag);
      applyCreateOpts(child, opts);
      this.appendChild(child);
      return child;
    };
  }

  if (typeof protoRecord.empty !== 'function') {
    protoRecord.empty = function empty(this: HTMLElement): void {
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
    };
  }

  if (typeof protoRecord.addClass !== 'function') {
    protoRecord.addClass = function addClass(this: HTMLElement, cls: string): void {
      this.classList.add(cls);
    };
  }

  if (typeof protoRecord.removeClass !== 'function') {
    protoRecord.removeClass = function removeClass(this: HTMLElement, cls: string): void {
      this.classList.remove(cls);
    };
  }

  if (typeof protoRecord.toggleClass !== 'function') {
    protoRecord.toggleClass = function toggleClass(
      this: HTMLElement,
      cls: string,
      force?: boolean,
    ): void {
      if (force === undefined) {
        this.classList.toggle(cls);
      } else {
        this.classList.toggle(cls, force);
      }
    };
  }

  if (typeof protoRecord.setText !== 'function') {
    protoRecord.setText = function setText(this: HTMLElement, value: string): void {
      this.textContent = value;
    };
  }

  if (typeof protoRecord.createSpan !== 'function') {
    protoRecord.createSpan = function createSpan(
      this: HTMLElement,
      opts?: CreateOpts | string,
    ): HTMLSpanElement {
      const child = this.ownerDocument.createElement('span');
      applyCreateOpts(child, opts);
      this.appendChild(child);
      return child;
    };
  }
}

installObsidianDom();
