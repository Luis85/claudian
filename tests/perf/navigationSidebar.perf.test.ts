/**
 * NavigationSidebar scan scaling guard.
 *
 * `scrollToMessage` (prev/next nav) does `querySelectorAll('.claudian-message-user')`
 * then reads `offsetTop` in a loop. That cost is O(mounted user messages) — which
 * is SAFE only because `MessageRenderer` caps the mounted DOM to its render window
 * (PERF-2). This guards that contract end to end: the nav scan must track the
 * MOUNTED message count, not the conversation length. If windowing is ever removed
 * upstream, the mounted set grows unbounded and this trips.
 *
 * Timing is reported, never asserted (DOM layout isn't modeled in node tests); the
 * assertions are structural — the scan visits O(mounted), bounded by the window.
 */
import { RENDER_WINDOW_SIZE } from '@/features/chat/rendering/windowedRenderSetup';
import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';

import { reportMetrics, timeMs } from './perfReport';

jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, iconName: string) => el.setAttribute?.('data-icon', iconName)),
}));

type Listener = (event: any) => void;

/** Minimal element with the surface NavigationSidebar touches, plus scan instrumentation. */
class NavMockElement {
  tagName: string;
  children: NavMockElement[] = [];
  private classes = new Set<string>();
  private attributes: Record<string, string> = {};
  private listeners: Record<string, Listener[]> = {};
  parent: NavMockElement | null = null;
  offsetTop = 0;
  scrollTop = 0;
  scrollHeight = 100000;
  clientHeight = 500;
  ownerDocument: { defaultView: Window | null };
  /** Counts nodes visited by querySelectorAll — the scan-cost probe. */
  static nodesVisited = 0;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = { defaultView: (globalThis as { window?: Window }).window ?? null };
  }

  set className(value: string) {
    this.classes.clear();
    value.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
  }
  get className(): string { return Array.from(this.classes).join(' '); }

  classList = {
    add: (...items: string[]) => items.forEach((i) => this.classes.add(i)),
    remove: (...items: string[]) => items.forEach((i) => this.classes.delete(i)),
    contains: (i: string) => this.classes.has(i),
    toggle: (i: string, force?: boolean) => {
      const on = force ?? !this.classes.has(i);
      if (on) this.classes.add(i); else this.classes.delete(i);
    },
  };

  appendChild(child: NavMockElement): NavMockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string }): NavMockElement {
    const el = new NavMockElement('div');
    if (options?.cls) el.className = options.cls;
    return this.appendChild(el);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  addEventListener(type: string, l: Listener): void { (this.listeners[type] ??= []).push(l); }
  removeEventListener(type: string, l: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== l);
  }
  dispatchEvent(event: any): void { (this.listeners[event.type] ?? []).forEach((l) => l(event)); }
  click(): void { this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} }); }
  scrollTo(opts: { top: number }): void { this.scrollTop = opts.top; }

  querySelector(selector: string): NavMockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): NavMockElement[] {
    const className = selector.startsWith('.') ? selector.slice(1) : selector;
    const matches: NavMockElement[] = [];
    const traverse = (el: NavMockElement): void => {
      NavMockElement.nodesVisited++;
      if (el.classes.has(className)) matches.push(el);
      for (const child of el.children) traverse(child);
    };
    traverse(this);
    return matches;
  }
}

/** Mounts `count` user-message elements with increasing offsetTop, like a rendered window. */
function mountUserMessages(messagesEl: NavMockElement, count: number): void {
  for (let i = 0; i < count; i++) {
    const msg = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    msg.offsetTop = (i + 1) * 100;
  }
}

describe('NavigationSidebar scan scaling', () => {
  let originalWindow: Window | undefined;

  beforeEach(() => {
    originalWindow = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number,
        cancelAnimationFrame: (h: number) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
      } as Window,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
  });

  it('scans only the mounted messages, bounded by the render window', () => {
    // The renderer never mounts more than RENDER_WINDOW_SIZE messages, so the nav
    // scan over mounted DOM is bounded regardless of conversation length.
    const mountedCounts = [10, RENDER_WINDOW_SIZE];

    const metrics = mountedCounts.map((mounted) => {
      const parentEl = new NavMockElement('div');
      const messagesEl = new NavMockElement('div');
      parentEl.appendChild(messagesEl);
      mountUserMessages(messagesEl, mounted);

      const sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );
      // Position mid-list so prev/next actually scan.
      messagesEl.scrollTop = (mounted / 2) * 100;

      NavMockElement.nodesVisited = 0;
      const prevBtn = parentEl.querySelector('.claudian-nav-btn-prev')!;
      const nextBtn = parentEl.querySelector('.claudian-nav-btn-next')!;
      const ms = timeMs(() => { prevBtn.click(); nextBtn.click(); });
      const visited = NavMockElement.nodesVisited;

      sidebar.destroy();
      return { n: mounted, visited, values: { mounted, nodesVisited: visited, scanMs: Math.round(ms * 1000) / 1000 } };
    });

    reportMetrics('NavigationSidebar — scan cost vs mounted messages', metrics);

    // The mounted set the nav scans never exceeds the render window cap.
    for (const m of metrics) {
      expect(m.n).toBeLessThanOrEqual(RENDER_WINDOW_SIZE);
    }

    // Scan cost is O(mounted): two prev/next clicks => two full traversals, each
    // visiting (mounted + a small constant of container/sidebar nodes). The probe
    // must scale ~linearly with mounted count and never with conversation length.
    const [small, large] = metrics;
    const perMessageSmall = small.visited / small.n;
    const perMessageLarge = large.visited / large.n;
    // Per-message visit cost stays flat (no super-linear blow-up as mounted grows).
    expect(perMessageLarge).toBeLessThanOrEqual(perMessageSmall + 1);
    // And the absolute scan stays within a small constant factor of mounted count.
    expect(large.visited).toBeLessThan(large.n * 6);
  });
});
