import { renderSectionHeader } from '../../../../../src/features/tasks/ui/sectionHeader';

// Minimal recording element mirroring the Obsidian create* surface the helper
// touches, so the produced header tree (icon name + label + lazy right slot)
// is observable without a real DOM.
interface El {
  tag: string;
  cls: Set<string>;
  text: string;
  attrs: Record<string, string>;
  children: El[];
  createDiv(opts?: { cls?: string; text?: string }): El;
  createSpan(opts?: { cls?: string; text?: string }): El;
  setAttr(name: string, value: string): void;
}

function makeEl(tag: string): El {
  const make = (childTag: string, opts?: { cls?: string; text?: string }): El => {
    const child = makeEl(childTag);
    if (opts?.cls) opts.cls.split(/\s+/).filter(Boolean).forEach((c) => child.cls.add(c));
    if (opts?.text) child.text = opts.text;
    el.children.push(child);
    return child;
  };
  const el: El = {
    tag,
    cls: new Set<string>(),
    text: '',
    attrs: {},
    children: [],
    createDiv: (opts) => make('div', opts),
    createSpan: (opts) => make('span', opts),
    setAttr(name, value) {
      this.attrs[name] = value;
    },
  };
  return el;
}

function find(root: El, cls: string): El | undefined {
  if (root.cls.has(cls)) return root;
  for (const child of root.children) {
    const hit = find(child, cls);
    if (hit) return hit;
  }
  return undefined;
}

describe('renderSectionHeader', () => {
  it('renders an icon + label under the shared section wrapper', () => {
    const parent = makeEl('div') as unknown as HTMLElement;
    const { section } = renderSectionHeader(parent, { icon: 'target', label: 'Objective' });

    const sectionEl = section as unknown as El;
    expect(sectionEl.cls.has('claudian-work-order-modal-section')).toBe(true);

    const icon = find(sectionEl, 'claudian-work-order-modal-section-icon');
    expect(icon).toBeDefined();
    expect(icon!.attrs['data-icon']).toBe('target');

    const label = find(sectionEl, 'claudian-work-order-modal-section-label');
    expect(label).toBeDefined();
    expect(label!.text).toBe('Objective');
  });

  it('creates the right slot lazily and reuses it across calls', () => {
    const parent = makeEl('div') as unknown as HTMLElement;
    const handle = renderSectionHeader(parent, { icon: 'list-checks', label: 'Acceptance' });
    const sectionEl = handle.section as unknown as El;

    // No right slot until requested.
    expect(find(sectionEl, 'claudian-work-order-modal-section-right')).toBeUndefined();

    const right1 = handle.right();
    const right2 = handle.right();
    expect(find(sectionEl, 'claudian-work-order-modal-section-right')).toBeDefined();
    // Idempotent: the same element is returned, not a second slot.
    expect(right1).toBe(right2);
  });
});
