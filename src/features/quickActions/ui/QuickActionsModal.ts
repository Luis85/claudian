import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { QuickActionStorage } from '../QuickActionStorage';
import type { SkillTabEntry } from '../skills/types';
import type { VaultSkillAggregator } from '../skills/VaultSkillAggregator';
import type { QuickAction } from '../types';
import { QuickActionEditorModal } from './QuickActionEditorModal';

export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;
  onRunSkill: (entry: SkillTabEntry) => void;
  storage: QuickActionStorage;
  aggregator: VaultSkillAggregator;
}

type ActiveTab = 'quickActions' | 'skills';

export class QuickActionsModal extends Modal {
  private callbacks: QuickActionsModalCallbacks;
  private activeTab: ActiveTab = 'quickActions';
  private tabStripEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  // Quick Actions tab state
  private introEl: HTMLElement | null = null;
  private searchWrapEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private actions: QuickAction[] = [];
  private filter = '';

  // Skills tab state
  private skillSearchInputEl: HTMLInputElement | null = null;
  private skillListEl: HTMLElement | null = null;
  private skills: SkillTabEntry[] = [];
  private skillFilter = '';

  constructor(app: App, callbacks: QuickActionsModalCallbacks) {
    super(app);
    this.callbacks = callbacks;
  }

  onOpen(): void {
    this.setTitle(t('quickActions.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-quick-actions-modal');

    this.tabStripEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-tabs' });
    this.renderTabStrip();

    this.bodyEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-body' });
    void this.renderActiveTab();
  }

  private renderTabStrip(): void {
    if (!this.tabStripEl) return;
    this.tabStripEl.empty();

    const entries: Array<{ key: ActiveTab; label: string }> = [
      { key: 'quickActions', label: t('quickActions.modal.tabs.quickActions') },
      { key: 'skills', label: t('quickActions.modal.tabs.skills') },
    ];

    for (const entry of entries) {
      const tab = this.tabStripEl.createEl('button', {
        cls: 'claudian-quick-actions-tab',
        text: entry.label,
        attr: { type: 'button' },
      });
      if (this.activeTab === entry.key) {
        tab.addClass('is-active');
      }
      tab.addEventListener('click', () => {
        if (this.activeTab === entry.key) return;
        this.activeTab = entry.key;
        this.renderTabStrip();
        void this.renderActiveTab();
      });
    }
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.introEl = null;
    this.searchWrapEl = null;
    this.searchInputEl = null;
    this.listEl = null;
    this.skillSearchInputEl = null;
    this.skillListEl = null;
    this.filter = '';
    this.skillFilter = '';

    if (this.activeTab === 'quickActions') {
      this.renderQuickActionsBody(this.bodyEl);
      await this.refreshList();
      // Cast defeats narrowing — fields were nulled at the top, then
      // re-assigned inside renderQuickActionsBody (TS can't track that).
      (this.searchInputEl as HTMLInputElement | null)?.focus();
    } else {
      this.renderSkillsBody(this.bodyEl);
      await this.refreshSkills();
      (this.skillSearchInputEl as HTMLInputElement | null)?.focus();
    }
  }

  // ============================================================
  // Quick Actions tab (refactored from prior onOpen body)
  // ============================================================

  private renderQuickActionsBody(host: HTMLElement): void {
    this.introEl = host.createDiv({ cls: 'claudian-quick-actions-intro' });

    this.searchWrapEl = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = this.searchWrapEl.createDiv({
      cls: 'claudian-quick-actions-search-container',
    });
    const placeholder = t('quickActions.modal.searchPlaceholder');
    this.searchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.searchInputEl.addEventListener('input', () => {
      this.filter = this.searchInputEl?.value ?? '';
      this.renderList();
    });
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstMatch();
      } else if (e.key === 'Escape' && this.searchInputEl?.value) {
        e.preventDefault();
        e.stopPropagation();
        this.searchInputEl.value = '';
        this.filter = '';
        this.renderList();
      }
    });

    const resetBtn = inputContainer.createEl('button', {
      cls: 'claudian-quick-actions-search-reset',
      text: '✕',
      attr: { title: 'Clear search', 'aria-label': 'Clear search' },
    });
    resetBtn.addEventListener('click', () => {
      this.setFilter('');
    });

    this.listEl = host.createDiv({ cls: 'claudian-quick-actions-list' });

    const footer = host.createDiv({ cls: 'claudian-quick-actions-footer' });
    footer
      .createEl('button', {
        cls: 'mod-cta',
        text: t('quickActions.modal.add'),
      })
      .addEventListener('click', () => {
        this.openEditor(null);
      });
  }

  private runFirstMatch(): void {
    const filtered = this.applyFilter(this.actions);
    const first = filtered[0];
    if (!first) {
      return;
    }
    this.callbacks.onRun(first);
    this.close();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl || !this.introEl) {
      return;
    }
    this.actions = await this.callbacks.storage.loadAll();
    this.renderIntro();
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl || !this.searchWrapEl) {
      return;
    }
    this.listEl.empty();

    if (this.actions.length === 0) {
      this.listEl.addClass('claudian-quick-actions-list--empty');
      this.searchWrapEl.addClass('claudian-quick-actions-search--hidden');
      return;
    }

    this.listEl.removeClass('claudian-quick-actions-list--empty');
    this.searchWrapEl.removeClass('claudian-quick-actions-search--hidden');

    const filtered = this.applyFilter(this.actions);
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.modal.noResults'),
      });
      return;
    }

    for (const action of filtered) {
      this.renderRow(action);
    }
  }

  private setFilter(value: string): void {
    this.filter = value;
    if (this.searchInputEl) {
      this.searchInputEl.value = value;
      this.searchInputEl.focus();
    }
    this.renderList();
  }

  private applyFilter(actions: QuickAction[]): QuickAction[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) {
      return actions;
    }
    return actions.filter((a) => {
      if (a.name.toLowerCase().includes(needle)) return true;
      if (a.description.toLowerCase().includes(needle)) return true;
      if (a.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  private renderIntro(): void {
    if (!this.introEl) {
      return;
    }
    this.introEl.empty();

    if (this.actions.length === 0) {
      this.introEl.addClass('claudian-quick-actions-intro--empty');
      this.introEl.createEl('p', {
        cls: 'claudian-quick-actions-intro-lead',
        text: t('quickActions.modal.emptyLead'),
      });
      const hints = this.introEl.createEl('ul', {
        cls: 'claudian-quick-actions-intro-hints',
      });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintVault') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintRun') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintCreate') });
      return;
    }

    this.introEl.removeClass('claudian-quick-actions-intro--empty');
    this.introEl.createEl('p', { text: t('quickActions.modal.intro') });
  }

  private renderRow(action: QuickAction): void {
    if (!this.listEl) {
      return;
    }

    const row = this.listEl.createDiv({ cls: 'claudian-quick-action-row' });
    const main = row.createDiv({ cls: 'claudian-quick-action-main' });

    if (action.icon) {
      const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
      setIcon(iconEl, action.icon);
    }

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: action.name });
    if (action.description !== action.name) {
      textCol.createDiv({
        cls: 'claudian-quick-action-desc',
        text: action.description,
      });
    }
    if (action.tags && action.tags.length > 0) {
      const tagsEl = textCol.createDiv({ cls: 'claudian-quick-action-tags' });
      for (const tag of action.tags) {
        const chip = tagsEl.createSpan({
          cls: 'claudian-quick-action-tag',
          text: `#${tag}`,
          attr: {
            role: 'button',
            tabindex: '0',
            'aria-label': t('quickActions.modal.filterByTag', { tag }),
          },
        });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFilter(tag);
        });
        chip.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.setFilter(tag);
          }
        });
      }
    }

    main.addEventListener('click', () => {
      this.callbacks.onRun(action);
      this.close();
    });

    const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
    actions
      .createEl('button', { text: t('common.edit') })
      .addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(action);
      });
    actions
      .createEl('button', { text: t('common.delete') })
      .addEventListener('click', (e) => {
        e.stopPropagation();
        void this.deleteAction(action);
      });
  }

  private openEditor(existing: QuickAction | null): void {
    new QuickActionEditorModal(this.app, existing, async (action) => {
      const filePath = await this.callbacks.storage.save(action);
      action.filePath = filePath;
      await this.refreshList();
    }).open();
  }

  private async deleteAction(action: QuickAction): Promise<void> {
    if (!action.filePath) {
      return;
    }
    try {
      await this.callbacks.storage.delete(action.filePath);
      await this.refreshList();
    } catch {
      new Notice(t('quickActions.modal.deleteFailed'));
    }
  }

  // ============================================================
  // Skills tab
  // ============================================================

  private renderSkillsBody(host: HTMLElement): void {
    const searchWrap = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = searchWrap.createDiv({
      cls: 'claudian-quick-actions-search-container',
    });
    const placeholder = t('quickActions.skills.searchPlaceholder');
    this.skillSearchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.skillSearchInputEl.addEventListener('input', () => {
      this.skillFilter = this.skillSearchInputEl?.value ?? '';
      this.renderSkillList();
    });
    this.skillSearchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstSkillMatch();
      } else if (e.key === 'Escape' && this.skillSearchInputEl?.value) {
        e.preventDefault();
        e.stopPropagation();
        this.skillSearchInputEl.value = '';
        this.skillFilter = '';
        this.renderSkillList();
      }
    });

    this.skillListEl = host.createDiv({
      cls: 'claudian-quick-actions-list claudian-quick-actions-skill-list',
    });
  }

  private async refreshSkills(): Promise<void> {
    if (!this.skillListEl) return;
    try {
      this.skills = await this.callbacks.aggregator.listAll();
    } catch {
      this.skills = [];
    }
    this.renderSkillList();
  }

  private renderSkillList(): void {
    if (!this.skillListEl) return;
    this.skillListEl.empty();

    if (this.skills.length === 0) {
      this.skillListEl.addClass('claudian-quick-actions-skills-empty');
      this.skillListEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-lead',
        text: t('quickActions.skills.emptyAll'),
      });
      this.skillListEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-hint',
        text: t('quickActions.skills.emptyHint'),
      });
      return;
    }
    this.skillListEl.removeClass('claudian-quick-actions-skills-empty');

    const filtered = this.applySkillFilter(this.skills);
    if (filtered.length === 0) {
      this.skillListEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.skills.noResults'),
      });
      return;
    }

    let lastProvider: string | null = null;
    for (const skill of filtered) {
      if (skill.providerId !== lastProvider) {
        this.skillListEl.createDiv({
          cls: 'claudian-quick-actions-provider-header',
          text: skill.providerDisplayName,
        });
        lastProvider = skill.providerId;
      }
      this.renderSkillRow(skill);
    }
  }

  private applySkillFilter(skills: SkillTabEntry[]): SkillTabEntry[] {
    const needle = this.skillFilter.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((s) => {
      if (s.name.toLowerCase().includes(needle)) return true;
      if (s.description.toLowerCase().includes(needle)) return true;
      if (s.providerDisplayName.toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  private runFirstSkillMatch(): void {
    const filtered = this.applySkillFilter(this.skills);
    const first = filtered[0];
    if (!first) return;
    this.callbacks.onRunSkill(first);
    this.close();
  }

  private renderSkillRow(skill: SkillTabEntry): void {
    if (!this.skillListEl) return;

    const row = this.skillListEl.createDiv({
      cls: 'claudian-quick-action-row claudian-quick-actions-skill-row',
    });
    if (!skill.providerEnabled) {
      row.addClass('is-provider-disabled');
    }

    const main = row.createDiv({
      cls: 'claudian-quick-action-main claudian-quick-actions-skill-row-main',
    });

    const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
    setIcon(iconEl, 'book-open');

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: skill.name });
    if (skill.description) {
      textCol.createDiv({
        cls: 'claudian-quick-action-desc',
        text: skill.description,
      });
    }
    if (!skill.providerEnabled) {
      textCol.createSpan({
        cls: 'claudian-quick-actions-skill-disabled-badge',
        text: t('quickActions.skills.disabledBadge'),
      });
    }

    main.addEventListener('click', () => {
      this.callbacks.onRunSkill(skill);
      this.close();
    });

    if (skill.sourceFilePath) {
      const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
      const editBtn = actions.createEl('button', {
        cls: 'claudian-quick-actions-skill-edit',
        text: t('quickActions.skills.editInSettings', {
          provider: skill.providerDisplayName,
        }),
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Best-effort: close modal so user lands in plugin settings.
        // Provider-specific deep-link is deferred to a future change.
        this.close();
      });
    }
  }
}
