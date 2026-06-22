# Agent Detail Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Agent Roster detail editor into a single-page, card-based profile with a reusable collapsible+searchable picker for skills/tools and a sticky footer with unsaved-change tracking.

**Architecture:** Extract the detail editor out of `AgentRosterView` into a focused `AgentDetailEditor`. Build a reusable `renderCapabilityPicker` used for both Skills and Tools. Add a pure `isRosterAgentDirty` helper for the unsaved-change indicator and the Back guard. The view keeps the list/dashboard + card actions and delegates the detail page to the editor via callbacks.

**Tech Stack:** TypeScript, Obsidian `ItemView`/`Setting`/`setIcon` DOM APIs (no innerHTML), Jest + jsdom for unit tests, i18n via `t()` across 10 locales.

---

## File Structure

- **Create** `src/features/agents/roster/view/CapabilityPicker.ts` — the reusable picker (collapsed chips + count; expanded search + checklist). Pure render function, unit-tested.
- **Create** `src/features/agents/roster/rosterDirty.ts` — `isRosterAgentDirty(original, draft)`, a pure editable-field comparison. Unit-tested.
- **Create** `src/features/agents/roster/view/AgentDetailEditor.ts` — owns the detail page: draft, cards, pickers, dirty tracking, sticky footer, save. Manually-verified UI.
- **Modify** `src/features/agents/roster/view/AgentRosterView.ts` — remove the inline detail renderer + moved helpers; delegate to `AgentDetailEditor`. Keeps list/card/actions.
- **Modify** `src/i18n/types/agents.ts` + all 10 `src/i18n/locales/*.json` — new keys.
- **Modify** `src/style/features/agent-roster.css` + `src/style/accessibility.css` — cards, header, picker, sticky footer, focus ring.
- **Create** `tests/unit/features/agents/roster/view/CapabilityPicker.test.ts`
- **Create** `tests/unit/features/agents/roster/rosterDirty.test.ts`

---

## Task 1: i18n keys

**Files:**
- Modify: `src/i18n/types/agents.ts`
- Modify: `src/i18n/locales/en.json` + 9 other locales (script)
- Test: `tests/unit/i18n/*` (existing parity tests)

- [ ] **Step 1: Add keys to the type union**

In `src/i18n/types/agents.ts`, find the line `| 'agentRoster.capsSummary'` and add the new keys right after it:

```ts
  | 'agentRoster.capsSummary'
  | 'agentRoster.searchSkills'
  | 'agentRoster.searchTools'
  | 'agentRoster.selectedCount'
  | 'agentRoster.unsavedChanges'
  | 'agentRoster.discardConfirm'
```

- [ ] **Step 2: Add the values to all 10 locales**

Run this script (keeps English values for all locales, matching the namespace's existing convention; locale translation is tracked separately in `docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups.md`):

```bash
python3 - <<'PY'
import json, collections
KEYS = collections.OrderedDict([
    ('searchSkills', 'Search skills…'),
    ('searchTools', 'Search tools…'),
    ('selectedCount', '{count} selected'),
    ('unsavedChanges', 'Unsaved changes'),
    ('discardConfirm', 'Discard unsaved changes?'),
])
for loc in ['en','de','es','fr','ja','ko','pt','ru','zh-CN','zh-TW']:
    p = f'src/i18n/locales/{loc}.json'
    with open(p, encoding='utf-8') as fh:
        d = json.load(fh, object_pairs_hook=collections.OrderedDict)
    ns = d['agentRoster']
    new = collections.OrderedDict()
    for k, v in ns.items():
        new[k] = v
        if k == 'capsSummary':
            for nk, nv in KEYS.items():
                new.setdefault(nk, nv)
    for nk, nv in KEYS.items():
        new.setdefault(nk, nv)
    d['agentRoster'] = new
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('updated', loc)
PY
```

- [ ] **Step 3: Verify parity + typecheck**

Run: `npm run typecheck && npx jest --selectProjects unit -t "locale|i18n|parity"`
Expected: typecheck clean; i18n parity tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n
git commit -m "i18n(agents): add detail-editor picker + save keys"
```

---

## Task 2: `isRosterAgentDirty` helper (TDD)

**Files:**
- Create: `src/features/agents/roster/rosterDirty.ts`
- Test: `tests/unit/features/agents/roster/rosterDirty.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/agents/roster/rosterDirty.test.ts`:

```ts
import { createRosterAgent } from '@/features/agents/roster/rosterCapabilities';
import { isRosterAgentDirty } from '@/features/agents/roster/rosterDirty';

const base = () => ({ ...createRosterAgent('Reviewer', 1), prompt: 'p', skills: ['s1'], tools: ['t1'], roles: ['worker' as const] });

describe('isRosterAgentDirty', () => {
  it('is false for an unchanged copy', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, skills: [...a.skills], tools: [...a.tools], roles: [...a.roles] })).toBe(false);
  });

  it('detects a scalar field change', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, name: 'New' })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, prompt: 'changed' })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, color: 'var(--color-red)' })).toBe(true);
  });

  it('detects skills/tools/roles set changes regardless of order', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, skills: ['s1', 's2'] })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, tools: [] })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, roles: ['worker', 'verifier'] })).toBe(true);
  });

  it('treats set fields as order-insensitive', () => {
    const a = { ...base(), skills: ['s1', 's2'] };
    expect(isRosterAgentDirty(a, { ...a, skills: ['s2', 's1'] })).toBe(false);
  });

  it('detects model selection add/remove/change', () => {
    const a = base();
    const withModel = { ...a, modelSelection: { modelId: 'm', providerId: 'claude' as const } };
    expect(isRosterAgentDirty(a, withModel)).toBe(true);
    expect(isRosterAgentDirty(withModel, a)).toBe(true);
    expect(isRosterAgentDirty(withModel, { ...withModel, modelSelection: { modelId: 'm2', providerId: 'claude' as const } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest --selectProjects unit rosterDirty -t "isRosterAgentDirty"`
Expected: FAIL — cannot find module `rosterDirty`.

- [ ] **Step 3: Implement the helper**

Create `src/features/agents/roster/rosterDirty.ts`:

```ts
import type { RosterAgent, RosterAgentModelSelection } from './rosterTypes';

// Fields the detail editor can change; comparing only these avoids false dirty
// from timestamps (createdAt/updatedAt) or stored-but-unedited fields.
const SCALAR_KEYS = ['name', 'description', 'prompt', 'color', 'initials', 'providerOverride', 'permissionMode'] as const;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((value) => seen.has(value));
}

function sameModel(a?: RosterAgentModelSelection, b?: RosterAgentModelSelection): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.modelId === b.modelId && a.providerId === b.providerId;
}

/** True when `draft` differs from `original` in any editor-editable field. */
export function isRosterAgentDirty(original: RosterAgent, draft: RosterAgent): boolean {
  for (const key of SCALAR_KEYS) {
    if ((original[key] ?? '') !== (draft[key] ?? '')) return true;
  }
  return (
    !sameSet(original.skills, draft.skills) ||
    !sameSet(original.tools, draft.tools) ||
    !sameSet(original.roles, draft.roles) ||
    !sameModel(original.modelSelection, draft.modelSelection)
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest --selectProjects unit rosterDirty`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/roster/rosterDirty.ts tests/unit/features/agents/roster/rosterDirty.test.ts
git commit -m "feat(agents): isRosterAgentDirty for unsaved-change tracking"
```

---

## Task 3: `CapabilityPicker` component (TDD)

**Files:**
- Create: `src/features/agents/roster/view/CapabilityPicker.ts`
- Test: `tests/unit/features/agents/roster/view/CapabilityPicker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/agents/roster/view/CapabilityPicker.test.ts`:

```ts
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
    expect(root.querySelector('.claudian-cap-picker-count')?.textContent).toBe('2 selected');
    expect(root.querySelectorAll('.claudian-cap-picker-chip')).toHaveLength(2);
    expect(root.querySelector('.claudian-cap-picker-search')).toBeNull();
  });

  it('expands on header activation to reveal the searchable list', () => {
    const root = host();
    open(root);
    root.querySelector<HTMLElement>('.claudian-cap-picker-header')!.click();
    expect(root.querySelector('.claudian-cap-picker-search')).not.toBeNull();
    expect(root.querySelectorAll('.claudian-cap-picker-row')).toHaveLength(3);
  });

  it('filters rows by name or description', () => {
    const root = host();
    open(root);
    root.querySelector<HTMLElement>('.claudian-cap-picker-header')!.click();
    const search = root.querySelector<HTMLInputElement>('.claudian-cap-picker-search')!;
    search.value = 'csv';
    search.dispatchEvent(new Event('input'));
    const names = [...root.querySelectorAll('.claudian-cap-picker-row-name')].map((n) => n.textContent);
    expect(names).toEqual(['csv-parse']);
  });

  it('sorts selected items first', () => {
    const root = host();
    open(root, ['c']);
    root.querySelector<HTMLElement>('.claudian-cap-picker-header')!.click();
    const first = root.querySelector('.claudian-cap-picker-row-name')?.textContent;
    expect(first).toBe('csv-parse');
  });

  it('toggling a checkbox updates selection and calls onChange', () => {
    const root = host();
    const onChange = open(root, []);
    root.querySelector<HTMLElement>('.claudian-cap-picker-header')!.click();
    const boxes = root.querySelectorAll<HTMLInputElement>('.claudian-cap-picker-row input[type="checkbox"]');
    boxes[2].click(); // csv-parse (id 'c')
    expect(onChange).toHaveBeenLastCalledWith(['c']);
    expect(root.querySelectorAll('.claudian-cap-picker-chip')).toHaveLength(1);
  });

  it('removing a chip deselects', () => {
    const root = host();
    const onChange = open(root, ['a']);
    root.querySelector<HTMLButtonElement>('.claudian-cap-picker-chip')!.click();
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(root.querySelectorAll('.claudian-cap-picker-chip')).toHaveLength(0);
  });

  it('renders the empty hint when the catalog is empty', () => {
    const root = host();
    renderCapabilityPicker(root, {
      label: 'Tools', items: [], selectedIds: [], emptyHint: 'No tools yet', searchPlaceholder: 'Search…', onChange: jest.fn(),
    });
    root.querySelector<HTMLElement>('.claudian-cap-picker-header')!.click();
    expect(root.querySelector('.claudian-cap-picker-empty')?.textContent).toBe('No tools yet');
    expect(root.querySelectorAll('.claudian-cap-picker-row')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest --selectProjects unit CapabilityPicker`
Expected: FAIL — cannot find module `CapabilityPicker`.

- [ ] **Step 3: Implement the component**

Create `src/features/agents/roster/view/CapabilityPicker.ts`:

```ts
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

  const root = parent.createDiv({ cls: 'claudian-cap-picker' });

  const header = root.createDiv({ cls: 'claudian-cap-picker-header' });
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.createSpan({ cls: 'claudian-cap-picker-label', text: options.label });
  const countEl = header.createSpan({ cls: 'claudian-cap-picker-count' });
  const caret = header.createSpan({ cls: 'claudian-cap-picker-caret' });

  const chipsEl = root.createDiv({ cls: 'claudian-cap-picker-chips' });
  const body = root.createDiv({ cls: 'claudian-cap-picker-body' });

  const emit = (): void => options.onChange([...selected]);

  const renderCount = (): void => {
    countEl.setText(t('agentRoster.selectedCount', { count: String(selected.size) }));
  };

  const renderChips = (): void => {
    chipsEl.empty();
    for (const item of options.items) {
      if (!selected.has(item.id)) continue;
      const chip = chipsEl.createEl('button', { cls: 'claudian-cap-picker-chip' });
      chip.createSpan({ text: item.name });
      chip.createSpan({ cls: 'claudian-cap-picker-chip-x', text: '×' });
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
      const row = listEl.createEl('label', { cls: 'claudian-cap-picker-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = selected.has(item.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(item.id);
        else selected.delete(item.id);
        emit();
        renderChips();
        renderCount();
      });
      const main = row.createDiv({ cls: 'claudian-cap-picker-row-main' });
      main.createDiv({ cls: 'claudian-cap-picker-row-name', text: item.name });
      if (item.description) main.createDiv({ cls: 'claudian-cap-picker-row-desc', text: item.description });
      if (item.badge) row.createSpan({ cls: 'claudian-cap-picker-row-badge', text: item.badge });
    }
  };

  const renderBody = (): void => {
    body.empty();
    listEl = null;
    if (!expanded) return;
    if (options.items.length === 0) {
      body.createDiv({ cls: 'claudian-cap-picker-empty', text: options.emptyHint });
      return;
    }
    const search = body.createEl('input', { cls: 'claudian-cap-picker-search', type: 'text' });
    search.placeholder = options.searchPlaceholder;
    search.value = query;
    search.addEventListener('input', () => { query = search.value; renderRows(); });
    listEl = body.createDiv({ cls: 'claudian-cap-picker-list' });
    renderRows();
  };

  const toggle = (): void => {
    expanded = !expanded;
    root.classList.toggle('is-expanded', expanded);
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest --selectProjects unit CapabilityPicker`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/roster/view/CapabilityPicker.ts tests/unit/features/agents/roster/view/CapabilityPicker.test.ts
git commit -m "feat(agents): reusable collapsible CapabilityPicker"
```

---

## Task 4: Extract `AgentDetailEditor` and rewire the view

**Files:**
- Create: `src/features/agents/roster/view/AgentDetailEditor.ts`
- Modify: `src/features/agents/roster/view/AgentRosterView.ts`

No new unit tests (the view + editor are manually-verified UI, excluded from coverage like the other library views). Validated by typecheck/lint/build.

- [ ] **Step 1: Create the editor**

Create `src/features/agents/roster/view/AgentDetailEditor.ts`:

```ts
import { type DropdownComponent, Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { confirm } from '../../../../shared/modals/ConfirmModal';
import { renderAgentAvatar } from '../../agentAvatar';
import { rosterAgentToPersona } from '../../personaRegistry';
import { toolCapabilityId } from '../rosterCapabilities';
import { isRosterAgentDirty } from '../rosterDirty';
import type { RosterAgent } from '../rosterTypes';
import { type CapabilityItem, renderCapabilityPicker } from './CapabilityPicker';

const AVATAR_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
const DETAIL_AVATAR_SIZE = 48;

export interface AgentDetailEditorCallbacks {
  onBack(): void;
  onStartChat(agent: RosterAgent): void;
  onDeleted(agent: RosterAgent): void;
}

/** Owns the agent detail/edit page: cards, pickers, dirty tracking, sticky footer. */
export class AgentDetailEditor {
  private avatarHost: HTMLElement | null = null;
  private dirtyDot: HTMLElement | null = null;
  private original!: RosterAgent;
  private draft!: RosterAgent;

  constructor(private readonly plugin: ClaudianPlugin, private readonly callbacks: AgentDetailEditorCallbacks) {}

  async render(root: HTMLElement, agent: RosterAgent): Promise<void> {
    this.original = agent;
    this.draft = { ...agent, roles: [...agent.roles], skills: [...agent.skills], tools: [...agent.tools] };

    root.empty();
    root.removeClass('claudian-roster');
    root.addClass('claudian-roster-detail');

    this.renderTopbar(root);
    this.renderHeaderCard(root);
    this.renderModelCard(root);
    this.renderInstructionsCard(root);
    await this.renderSkillsCard(root);
    this.renderToolsCard(root);
    this.renderFooter(root);
    this.updateDirty();
  }

  private card(root: HTMLElement, heading?: string): HTMLElement {
    const card = root.createDiv({ cls: 'claudian-roster-card-section' });
    if (heading) card.createEl('h3', { cls: 'claudian-roster-section', text: heading });
    return card;
  }

  private renderTopbar(root: HTMLElement): void {
    const topbar = root.createDiv({ cls: 'claudian-roster-detail-topbar' });
    const back = topbar.createEl('button', { text: t('agentRoster.back') });
    back.onclick = () => this.handleBack();
  }

  private handleBack(): void {
    if (!isRosterAgentDirty(this.original, this.draft)) {
      this.callbacks.onBack();
      return;
    }
    void confirm(this.plugin.app, t('agentRoster.discardConfirm'), t('agentRoster.back')).then((ok) => {
      if (ok) this.callbacks.onBack();
    });
  }

  private renderHeaderCard(root: HTMLElement): void {
    const head = root.createDiv({ cls: 'claudian-roster-detail-head' });
    this.avatarHost = head.createDiv({ cls: 'claudian-roster-detail-avatar' });
    this.refreshAvatar();

    const fields = head.createDiv({ cls: 'claudian-roster-detail-headfields' });
    const nameEl = fields.createEl('input', { cls: 'claudian-roster-detail-name', type: 'text' });
    nameEl.value = this.draft.name;
    nameEl.placeholder = t('agentRoster.fieldName');
    nameEl.addEventListener('input', () => {
      this.draft.name = nameEl.value;
      this.refreshAvatar();
      this.updateDirty();
    });
    const descEl = fields.createEl('input', { cls: 'claudian-roster-detail-desc', type: 'text' });
    descEl.value = this.draft.description;
    descEl.placeholder = t('agentRoster.fieldDescription');
    descEl.addEventListener('input', () => { this.draft.description = descEl.value; this.updateDirty(); });

    this.renderAppearanceRow(fields);
    this.renderRolesRow(fields);
  }

  private renderAppearanceRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: 'claudian-roster-appearance' });

    const color = row.createEl('select', { cls: 'claudian-roster-appearance-color dropdown' });
    color.createEl('option', { value: '', text: t('agentRoster.providerDefault') });
    for (const name of AVATAR_COLORS) color.createEl('option', { value: `var(--color-${name})`, text: name });
    color.value = this.draft.color ?? '';
    color.addEventListener('change', () => {
      this.draft.color = color.value || undefined;
      this.refreshAvatar();
      this.updateDirty();
    });

    const initials = row.createEl('input', { cls: 'claudian-roster-appearance-initials', type: 'text' });
    initials.maxLength = 2;
    initials.value = this.draft.initials ?? '';
    initials.placeholder = t('agentRoster.initials');
    initials.addEventListener('input', () => {
      this.draft.initials = initials.value.toUpperCase() || undefined;
      this.refreshAvatar();
      this.updateDirty();
    });
  }

  private renderRolesRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: 'claudian-roster-roles' });
    const roles: Array<['worker' | 'verifier', string]> = [
      ['worker', t('agentRoster.roleWorker')],
      ['verifier', t('agentRoster.roleVerifier')],
    ];
    for (const [role, label] of roles) {
      const chip = row.createEl('button', { cls: 'claudian-roster-role-chip', text: label });
      const sync = (): void => { chip.classList.toggle('is-on', this.draft.roles.includes(role)); };
      sync();
      chip.addEventListener('click', () => {
        this.draft.roles = this.draft.roles.includes(role)
          ? this.draft.roles.filter((r) => r !== role)
          : [...this.draft.roles, role];
        sync();
        this.updateDirty();
      });
    }
  }

  private renderModelCard(root: HTMLElement): void {
    const card = this.card(root, t('agentRoster.sectionModel'));
    const grid = card.createDiv({ cls: 'claudian-roster-model-grid' });
    const settings = asSettingsBag(this.plugin.settings);
    const providerIds = ProviderRegistry.getEnabledProviderIds(settings);
    let modelDropdown: DropdownComponent | null = null;

    const populateModels = (providerId: string): void => {
      if (!modelDropdown) return;
      modelDropdown.selectEl.empty();
      modelDropdown.addOption('', t('agentRoster.modelDefault'));
      const options = providerId
        ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
        : [];
      for (const o of options) modelDropdown.addOption(o.value, o.label);
      const current = this.draft.modelSelection?.modelId ?? '';
      modelDropdown.setValue(options.some((o) => o.value === current) ? current : '');
    };

    new Setting(grid).setName(t('agentRoster.provider')).addDropdown((c) => {
      c.addOption('', t('agentRoster.providerDefault'));
      for (const id of providerIds) c.addOption(id, id);
      c.setValue(this.draft.providerOverride ?? '');
      c.onChange((v) => {
        this.draft.providerOverride = (v || undefined) as ProviderId | undefined;
        this.draft.modelSelection = undefined;
        populateModels(v);
        this.updateDirty();
      });
    });

    new Setting(grid).setName(t('agentRoster.model')).addDropdown((c) => {
      modelDropdown = c;
      c.onChange((v) => {
        const providerId = (this.draft.providerOverride
          ?? this.draft.modelSelection?.providerId
          ?? providerIds[0]) as ProviderId | undefined;
        this.draft.modelSelection = v && providerId ? { modelId: v, providerId } : undefined;
        this.updateDirty();
      });
      populateModels(this.draft.providerOverride ?? this.draft.modelSelection?.providerId ?? '');
    });
  }

  private renderInstructionsCard(root: HTMLElement): void {
    const card = this.card(root, t('agentRoster.sectionInstructions'));
    const ta = card.createEl('textarea', { cls: 'claudian-roster-prompt-area' });
    ta.value = this.draft.prompt;
    ta.rows = 8;
    ta.addEventListener('input', () => { this.draft.prompt = ta.value; this.updateDirty(); });
  }

  private async renderSkillsCard(root: HTMLElement): Promise<void> {
    const card = this.card(root);
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const items: CapabilityItem[] = entries.map((e) => ({
      id: e.name, name: e.name, description: e.description, badge: e.providerDisplayName,
    }));
    renderCapabilityPicker(card, {
      label: t('agentRoster.skills'),
      items,
      selectedIds: this.draft.skills,
      emptyHint: t('agentRoster.noSkillsHint'),
      searchPlaceholder: t('agentRoster.searchSkills'),
      onChange: (ids) => { this.draft.skills = ids; this.updateDirty(); },
    });
  }

  private renderToolsCard(root: HTMLElement): void {
    const card = this.card(root);
    const tools = (this.plugin.toolRegistry?.list() ?? []).filter((tool) => tool.module && !tool.error);
    const items: CapabilityItem[] = tools.flatMap((tool) =>
      tool.module ? [{ id: toolCapabilityId(tool.module.manifest.name), name: tool.module.manifest.name, description: tool.module.manifest.description }] : [],
    );
    renderCapabilityPicker(card, {
      label: t('agentRoster.tools'),
      items,
      selectedIds: this.draft.tools,
      emptyHint: t('agentRoster.noToolsHint'),
      searchPlaceholder: t('agentRoster.searchTools'),
      onChange: (ids) => { this.draft.tools = ids; this.updateDirty(); },
    });
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: 'claudian-roster-detail-footer' });
    this.dirtyDot = footer.createSpan({ cls: 'claudian-roster-dirty', text: t('agentRoster.unsavedChanges') });
    footer.createDiv({ cls: 'claudian-roster-footer-spacer' });

    const save = footer.createEl('button', { cls: 'mod-cta', text: t('agentRoster.save') });
    save.onclick = () => void this.save();
    const start = footer.createEl('button', { text: t('agentRoster.startChat') });
    start.onclick = () => this.callbacks.onStartChat(this.draft);
    const del = footer.createEl('button', { cls: 'claudian-roster-card-delete', text: t('agentRoster.delete') });
    del.onclick = () => this.callbacks.onDeleted(this.original);
  }

  private async save(): Promise<void> {
    this.draft.updatedAt = Date.now();
    await this.plugin.agentRosterStore?.save(this.draft);
    this.original = { ...this.draft, roles: [...this.draft.roles], skills: [...this.draft.skills], tools: [...this.draft.tools] };
    new Notice(t('agentRoster.saved', { name: this.draft.name }));
    this.updateDirty();
  }

  private updateDirty(): void {
    this.dirtyDot?.classList.toggle('is-visible', isRosterAgentDirty(this.original, this.draft));
  }

  private refreshAvatar(): void {
    if (!this.avatarHost) return;
    this.avatarHost.empty();
    renderAgentAvatar(this.avatarHost, rosterAgentToPersona(this.draft), DETAIL_AVATAR_SIZE);
  }
}
```

- [ ] **Step 2: Typecheck the new editor in isolation**

Run: `npm run typecheck`
Expected: clean (the editor is not yet imported anywhere, but must compile).

- [ ] **Step 3: Rewire `AgentRosterView` to delegate**

In `src/features/agents/roster/view/AgentRosterView.ts`:

(a) Replace the imports block. Remove `DropdownComponent`, `Setting`, `asSettingsBag`, `ProviderRegistry` usage that only the detail used — but `ProviderRegistry`/`asSettingsBag`/`ProviderId` are still used by `resolveAgentProvider`, so keep those. Remove `renderLibraryEmptyState`? No — still used by the empty state. Add the editor import. The final import list:

```ts
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { renderLibraryNav } from '../../../../shared/libraryNav';
import { confirm } from '../../../../shared/modals/ConfirmModal';
import { withErrorNotice } from '../../../../shared/uiAction';
import { renderLibraryEmptyState } from '../../../../utils/libraryView';
import { renderAgentAvatar } from '../../agentAvatar';
import { rosterAgentToPersona } from '../../personaRegistry';
import { installPresetAgents } from '../presetAgents';
import { createRosterAgent, dedupeRosterId } from '../rosterCapabilities';
import type { RosterAgent } from '../rosterTypes';
import { AgentDetailEditor } from './AgentDetailEditor';
```

(Note: `toolCapabilityId`, `type DropdownComponent`, `Setting` are no longer imported here — they moved to the editor. The constants `AVATAR_COLORS`, `AVATAR_AVATAR_SIZE` are removed; keep `CARD_AVATAR_SIZE`.)

(b) Delete these members (moved to the editor): `avatarHostEl` field, `renderDetail`, `renderModelSection`, `renderSkillPicker`, `renderToolPicker`, `renderRoleToggle`, `sectionHeading`, `refreshAvatar`, `saveDraft`, and the `AVATAR_COLORS` + `AVATAR_AVATAR_SIZE` constants. **Keep** `deleteAgent`, `startChatWithAgent`, `resolveAgentProvider` (used by both the card and the editor callbacks).

(c) Add the editor-opening method (replaces the old `renderDetail`):

```ts
  private async openDetail(agent: RosterAgent): Promise<void> {
    const editor = new AgentDetailEditor(this.plugin, {
      onBack: () => void this.renderList(),
      onStartChat: (a) => void withErrorNotice(() => this.startChatWithAgent(a), t('agentRoster.actionFailed'), (e) => this.fail(e)),
      onDeleted: (a) => void withErrorNotice(() => this.deleteAgent(a), t('agentRoster.actionFailed'), (e) => this.fail(e)),
    });
    await editor.render(this.contentEl, agent);
  }
```

(d) Update the three existing references from `this.renderDetail(...)` to `this.openDetail(...)`: in `renderCard` (`card.onclick`), in `wireCardKeyboard` (Enter/Space handler), and in `createAndEdit` (final line). `deleteAgent` already calls `renderList` after delete; keep it. After `deleteAgent`/`startChatWithAgent` run from the editor footer, they call `renderList()` / open a tab as today, which navigates away from the detail page — acceptable.

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean. (If lint flags import order, run `npm run lint:fix`.)

- [ ] **Step 5: Confirm no dead exports / boundary issues**

Run: `mv coverage /tmp/cov_bak 2>/dev/null; npm run check:quality; mv /tmp/cov_bak coverage 2>/dev/null`
Expected: `Quality ratchet OK` (no new clones, deadCodeIssues=0, boundaryViolations=0). If `cloneGroups`/`duplicatedLines` regressed, extract the shared bit and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/roster/view/AgentDetailEditor.ts src/features/agents/roster/view/AgentRosterView.ts
git commit -m "feat(agents): extract AgentDetailEditor with card layout + pickers"
```

---

## Task 5: Styling

**Files:**
- Modify: `src/style/features/agent-roster.css`
- Modify: `src/style/accessibility.css`

- [ ] **Step 1: Add the detail-page + picker styles**

Append to `src/style/features/agent-roster.css`:

```css
/* ── Detail editor: cards ── */
.claudian-roster-card-section {
  padding: var(--size-4-3);
  margin-bottom: var(--size-4-3);
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.claudian-roster-detail-headfields {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.claudian-roster-detail-name {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
}

.claudian-roster-detail-name,
.claudian-roster-detail-desc {
  width: 100%;
}

.claudian-roster-appearance {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  align-items: center;
}

.claudian-roster-appearance-initials {
  width: 4em;
  text-align: center;
}

.claudian-roster-roles {
  display: flex;
  gap: var(--size-4-1);
}

.claudian-roster-role-chip {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  background: var(--background-modifier-border);
  box-shadow: none;
}

.claudian-roster-role-chip.is-on {
  color: var(--text-on-accent);
  background: var(--interactive-accent);
}

.claudian-roster-model-grid {
  display: grid;
  /* Two-up when there's room; stacks to one column on a narrow sidebar without
     needing a container query. */
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0 var(--size-4-4);
}

.claudian-roster-model-grid .setting-item {
  border-top: none;
  padding: var(--size-4-1) 0;
}

.claudian-roster-prompt-area {
  width: 100%;
  resize: vertical;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}

/* ── Capability picker ── */
.claudian-cap-picker {
  padding: var(--size-4-3);
  margin-bottom: var(--size-4-3);
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.claudian-cap-picker-header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  cursor: pointer;
}

.claudian-cap-picker-label {
  font-weight: var(--font-semibold);
}

.claudian-cap-picker-count {
  flex: 1 1 auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.claudian-cap-picker-caret {
  display: flex;
  color: var(--text-muted);
}

.claudian-cap-picker-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  margin-top: var(--size-4-2);
}

.claudian-cap-picker-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  font-size: var(--font-ui-smaller);
  padding: 0 var(--size-4-1);
  box-shadow: none;
  background: var(--background-modifier-border);
}

.claudian-cap-picker-chip-x {
  color: var(--text-muted);
}

.claudian-cap-picker-body {
  margin-top: var(--size-4-2);
}

.claudian-cap-picker-search {
  width: 100%;
  margin-bottom: var(--size-4-2);
}

.claudian-cap-picker-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.claudian-cap-picker-row {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
}

.claudian-cap-picker-row:hover {
  background: var(--background-modifier-hover);
}

.claudian-cap-picker-row-main {
  flex: 1 1 auto;
  min-width: 0;
}

.claudian-cap-picker-row-name {
  font-size: var(--font-ui-small);
}

.claudian-cap-picker-row-desc {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.claudian-cap-picker-row-badge {
  flex: 0 0 auto;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  background: var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: 0 var(--size-4-1);
}

.claudian-cap-picker-empty {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/* ── Sticky footer ── */
.claudian-roster-detail-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-4);
  padding: var(--size-4-3) 0;
  background: var(--background-primary);
  border-top: 1px solid var(--background-modifier-border);
}

.claudian-roster-footer-spacer {
  flex: 1 1 auto;
}

.claudian-roster-dirty {
  display: none;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-warning, var(--text-muted));
  font-size: var(--font-ui-smaller);
}

.claudian-roster-dirty.is-visible {
  display: inline-flex;
}

.claudian-roster-dirty::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
```

The `repeat(auto-fit, minmax(180px, 1fr))` above already handles narrow widths (it collapses to one column when there isn't room for two), so no media/container query is needed.

- [ ] **Step 2: Add the picker focus ring**

In `src/style/accessibility.css`, find the block that lists `.claudian-roster-card:focus-visible,` and add the picker header to that same selector group:

```css
.claudian-roster-card:focus-visible,
.claudian-library-nav-item:focus-visible,
.claudian-cap-picker-header:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Build CSS and sanity-check**

Run: `npm run build`
Expected: `Built styles.css`. No CSS build error (every new class is plain; no `@import` needed since these files are already registered).

- [ ] **Step 4: Commit**

```bash
git add src/style/features/agent-roster.css src/style/accessibility.css
git commit -m "style(agents): card layout, capability picker, sticky footer"
```

---

## Task 6: Full gate sweep + push

**Files:** none (verification + push).

- [ ] **Step 1: Run the full gate suite**

Run each and confirm green:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run check:loc
mv coverage /tmp/cov_bak 2>/dev/null; npm run check:quality; mv /tmp/cov_bak coverage 2>/dev/null
npm run test:coverage
npm run test:perf
```

Expected: typecheck/lint clean; all tests pass; `LOC guard OK`; `Quality ratchet OK`; coverage thresholds met; perf 23 passed.

- [ ] **Step 2: If `check:loc` flags `AgentRosterView.ts`**

The extraction should *shrink* `AgentRosterView.ts` well under 500 and add `AgentDetailEditor.ts` (new file, must also be under 500 — it is ~300). If either is over, that's a real signal to split further; otherwise no baseline edit is needed. Do **not** add new allowlist entries without cause.

- [ ] **Step 3: Push**

```bash
git push origin claude/ai-agents-plugin-research-ljdmgg
```

- [ ] **Step 4: Confirm the commit author is correct**

Run: `git log -1 --format='%an <%ae>'`
Expected: `Claude <noreply@anthropic.com>`. If not, run `git config user.email noreply@anthropic.com && git config user.name Claude && git commit --amend --no-edit --reset-author` and force-push with `--force-with-lease`.

---

## Notes for the implementer

- **No `console.*`** in `src/`; **no `innerHTML`** — build DOM with `createEl`/`createDiv`/`createSpan`/`setText`/`.empty()` (already followed in the code above).
- The picker tracks **skills by name** and **tools by capability id** (`toolCapabilityId(name)`), matching `RosterAgent.skills` / `.tools`. A selected id no longer present in the catalog simply won't render a chip; it is not silently dropped from the draft (onChange only fires on user action).
- Buttons in jsdom tests are activated with `.click()`; there is no jest-dom, so assert classes via `classList.contains` and presence via `querySelector`.
- Keep `withErrorNotice` wrapping on the editor's footer Start/Delete via the view callbacks (already wired in Task 4 Step 3c).
