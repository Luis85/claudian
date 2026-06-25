import { setIcon } from 'obsidian';

import { t } from '../../../../i18n/i18n';

export interface CapabilityItem {
  id: string;            // selection key
  name: string;          // display label
  description?: string;  // secondary line
  badge?: string;        // small right-aligned tag (skills: provider)
}

export interface CapabilityPickerOptions {
  label: string;
  items: CapabilityItem[];
  selectedIds: string[];
  emptyHint: string;
  searchPlaceholder: string;
  onChange: (selectedIds: string[]) => void;
}

/**
 * Collapsible capability selector shared by the Skills and Tools sections of the
 * agent detail editor. Collapsed: a count + removable chips of the selection.
 * Expanded: a search box + a scrollable checklist with selected items sorted
 * first. Every selection change re-renders the chips/count and calls `onChange`.
 */
export function renderCapabilityPicker(parent: HTMLElement, options: CapabilityPickerOptions): void {
  const selected = new Set(options.selectedIds);
  let expanded = false;
  let query = '';

  const root = parent.createDiv({ cls: 'specorator-cap-picker' });

  const bodyId = `specorator-cap-picker-body-${Math.random().toString(36).slice(2, 10)}`;

  const header = root.createDiv({ cls: 'specorator-cap-picker-header' });
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-controls', bodyId);
  header.createSpan({ cls: 'specorator-cap-picker-label', text: options.label });
  const countEl = header.createSpan({ cls: 'specorator-cap-picker-count' });
  const caret = header.createSpan({ cls: 'specorator-cap-picker-caret' });

  const chipsEl = root.createDiv({ cls: 'specorator-cap-picker-chips' });
  const body = root.createDiv({ cls: 'specorator-cap-picker-body' });
  body.id = bodyId;

  const emit = (): void => options.onChange([...selected]);

  const renderCount = (): void => {
    countEl.setText(t('agentRoster.selectedCount', { count: String(selected.size) }));
  };

  const renderChips = (): void => {
    chipsEl.empty();
    for (const item of options.items) {
      if (!selected.has(item.id)) continue;
      const chip = chipsEl.createEl('button', { cls: 'specorator-cap-picker-chip' });
      chip.setAttribute('aria-label', t('agentRoster.removeCapability', { name: item.name }));
      chip.createSpan({ text: item.name });
      // Decorative close glyph rendered via CSS `::before` (no keyed literal).
      chip.createSpan({ cls: 'specorator-cap-picker-chip-x' });
      chip.addEventListener('click', () => {
        selected.delete(item.id);
        emit();
        renderChips();
        renderCount();
        if (expanded) renderRows();
      });
    }
  };

  let listEl: HTMLElement | null = null;

  const renderRows = (): void => {
    if (!listEl) return;
    listEl.empty();
    const q = query.trim().toLowerCase();
    const matches = options.items.filter(
      (it) => !q || it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q),
    );
    const ordered = [
      ...matches.filter((it) => selected.has(it.id)),
      ...matches.filter((it) => !selected.has(it.id)),
    ];
    for (const item of ordered) {
      const row = listEl.createEl('label', { cls: 'specorator-cap-picker-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = selected.has(item.id);
      // Listen on `click` (not `change`): the native checkbox toggles `checked`
      // before the click handler runs, and `click` is what tests/users trigger.
      cb.addEventListener('click', () => {
        if (cb.checked) selected.add(item.id);
        else selected.delete(item.id);
        emit();
        renderChips();
        renderCount();
      });
      const main = row.createDiv({ cls: 'specorator-cap-picker-row-main' });
      main.createDiv({ cls: 'specorator-cap-picker-row-name', text: item.name });
      if (item.description) main.createDiv({ cls: 'specorator-cap-picker-row-desc', text: item.description });
      if (item.badge) row.createSpan({ cls: 'specorator-cap-picker-row-badge', text: item.badge });
    }
  };

  const renderBody = (): void => {
    body.empty();
    listEl = null;
    if (!expanded) return;
    if (options.items.length === 0) {
      body.createDiv({ cls: 'specorator-cap-picker-empty', text: options.emptyHint });
      return;
    }
    const search = body.createEl('input', { cls: 'specorator-cap-picker-search', type: 'text' });
    search.placeholder = options.searchPlaceholder;
    search.setAttribute('aria-label', options.searchPlaceholder);
    search.value = query;
    search.addEventListener('input', () => { query = search.value; renderRows(); });
    listEl = body.createDiv({ cls: 'specorator-cap-picker-list' });
    listEl.setAttribute('role', 'group');
    listEl.setAttribute('aria-label', options.label);
    renderRows();
    search.focus();
  };

  const toggle = (): void => {
    expanded = !expanded;
    root.classList.toggle('is-expanded', expanded);
    header.setAttribute('aria-expanded', String(expanded));
    setIcon(caret, expanded ? 'chevron-down' : 'chevron-right');
    renderBody();
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  setIcon(caret, 'chevron-right');
  renderCount();
  renderChips();
  renderBody();
}
