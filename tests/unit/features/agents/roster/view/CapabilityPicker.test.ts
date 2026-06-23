/**
 * @jest-environment jsdom
 */
import '../../../../../setup/obsidianDom';

import { type CapabilityItem, renderCapabilityPicker } from '@/features/agents/roster/view/CapabilityPicker';

const items: CapabilityItem[] = [
  { id: 'a', name: 'pdf-extract', description: 'extract text', badge: 'Vault' },
  { id: 'b', name: 'web-research', description: 'search web', badge: 'Claude' },
  { id: 'c', name: 'csv-parse', description: 'parse CSV', badge: 'Vault' },
];

function host(): HTMLElement {
  return document.createElement('div');
}

function open(root: HTMLElement, selectedIds: string[] = [], onChange = jest.fn()): jest.Mock {
  renderCapabilityPicker(root, {
    label: 'Skills', items, selectedIds, emptyHint: 'none', searchPlaceholder: 'Search…', onChange,
  });
  return onChange;
}

describe('renderCapabilityPicker', () => {
  it('renders the selected count and chips, collapsed by default', () => {
    const root = host();
    open(root, ['a', 'b']);
    expect(root.querySelector('.specorator-cap-picker-count')?.textContent).toBe('2 selected');
    expect(root.querySelectorAll('.specorator-cap-picker-chip')).toHaveLength(2);
    expect(root.querySelector('.specorator-cap-picker-search')).toBeNull();
  });

  it('expands on header activation to reveal the searchable list', () => {
    const root = host();
    open(root);
    root.querySelector<HTMLElement>('.specorator-cap-picker-header')!.click();
    expect(root.querySelector('.specorator-cap-picker-search')).not.toBeNull();
    expect(root.querySelectorAll('.specorator-cap-picker-row')).toHaveLength(3);
  });

  it('flips the header aria-expanded on toggle', () => {
    const root = host();
    open(root);
    const header = root.querySelector<HTMLElement>('.specorator-cap-picker-header')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('labels a selected chip with its Remove purpose', () => {
    const root = host();
    open(root, ['a']);
    const chip = root.querySelector<HTMLButtonElement>('.specorator-cap-picker-chip')!;
    expect(chip.getAttribute('aria-label')).toContain('Remove');
  });

  it('filters rows by name or description', () => {
    const root = host();
    open(root);
    root.querySelector<HTMLElement>('.specorator-cap-picker-header')!.click();
    const search = root.querySelector<HTMLInputElement>('.specorator-cap-picker-search')!;
    search.value = 'csv';
    search.dispatchEvent(new Event('input'));
    const names = [...root.querySelectorAll('.specorator-cap-picker-row-name')].map((n) => n.textContent);
    expect(names).toEqual(['csv-parse']);
  });

  it('sorts selected items first', () => {
    const root = host();
    open(root, ['c']);
    root.querySelector<HTMLElement>('.specorator-cap-picker-header')!.click();
    const first = root.querySelector('.specorator-cap-picker-row-name')?.textContent;
    expect(first).toBe('csv-parse');
  });

  it('toggling a checkbox updates selection and calls onChange', () => {
    const root = host();
    const onChange = open(root, []);
    root.querySelector<HTMLElement>('.specorator-cap-picker-header')!.click();
    const boxes = root.querySelectorAll<HTMLInputElement>('.specorator-cap-picker-row input[type="checkbox"]');
    boxes[2].click(); // csv-parse (id 'c')
    expect(onChange).toHaveBeenLastCalledWith(['c']);
    expect(root.querySelectorAll('.specorator-cap-picker-chip')).toHaveLength(1);
  });

  it('removing a chip deselects', () => {
    const root = host();
    const onChange = open(root, ['a']);
    root.querySelector<HTMLButtonElement>('.specorator-cap-picker-chip')!.click();
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(root.querySelectorAll('.specorator-cap-picker-chip')).toHaveLength(0);
  });

  it('renders the empty hint when the catalog is empty', () => {
    const root = host();
    renderCapabilityPicker(root, {
      label: 'Tools', items: [], selectedIds: [], emptyHint: 'No tools yet', searchPlaceholder: 'Search…', onChange: jest.fn(),
    });
    root.querySelector<HTMLElement>('.specorator-cap-picker-header')!.click();
    expect(root.querySelector('.specorator-cap-picker-empty')?.textContent).toBe('No tools yet');
    expect(root.querySelectorAll('.specorator-cap-picker-row')).toHaveLength(0);
  });
});
