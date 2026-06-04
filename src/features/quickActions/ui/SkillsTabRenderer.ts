import { setIcon } from 'obsidian';

import { t } from '@/i18n/i18n';

import type { SkillTabEntry, VaultSkillSource } from '../skills/types';

/**
 * Owns the Skills-tab body of `QuickActionsModal`: search input, provider
 * headers, skill rows, disabled-provider dimming, edit affordance.
 *
 * Lives outside the modal so its 150 LOC don't accrete onto the Quick
 * Actions tab and so the modal shell can focus on tab switching only.
 */
export class SkillsTabRenderer {
  private skills: SkillTabEntry[] = [];
  private filter = '';
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(
    private source: VaultSkillSource,
    private onRunSkill: (entry: SkillTabEntry) => void,
    private close: () => void,
  ) {}

  /** Builds the body inside `host` and resolves with the input element to focus. */
  async render(host: HTMLElement): Promise<HTMLInputElement | null> {
    this.filter = '';
    this.buildSearch(host);
    this.listEl = host.createDiv({
      cls: 'claudian-quick-actions-list claudian-quick-actions-skill-list',
    });
    await this.refresh();
    return this.searchInputEl;
  }

  private buildSearch(host: HTMLElement): void {
    const searchWrap = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = searchWrap.createDiv({
      cls: 'claudian-quick-actions-search-container',
    });
    const placeholder = t('quickActions.skills.searchPlaceholder');
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
  }

  private async refresh(): Promise<void> {
    if (!this.listEl) return;
    try {
      this.skills = await this.source.listAll();
    } catch {
      this.skills = [];
    }
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.skills.length === 0) {
      this.listEl.addClass('claudian-quick-actions-skills-empty');
      this.listEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-lead',
        text: t('quickActions.skills.emptyAll'),
      });
      this.listEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-hint',
        text: t('quickActions.skills.emptyHint'),
      });
      return;
    }
    this.listEl.removeClass('claudian-quick-actions-skills-empty');

    const filtered = this.applyFilter(this.skills);
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.skills.noResults'),
      });
      return;
    }

    let lastProvider: string | null = null;
    for (const skill of filtered) {
      if (skill.providerId !== lastProvider) {
        this.listEl.createDiv({
          cls: 'claudian-quick-actions-provider-header',
          text: skill.providerDisplayName,
        });
        lastProvider = skill.providerId;
      }
      this.renderRow(skill);
    }
  }

  private applyFilter(skills: SkillTabEntry[]): SkillTabEntry[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((s) => {
      if (s.name.toLowerCase().includes(needle)) return true;
      if (s.description.toLowerCase().includes(needle)) return true;
      if (s.providerDisplayName.toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  private runFirstMatch(): void {
    const first = this.applyFilter(this.skills)[0];
    if (!first) return;
    this.onRunSkill(first);
    this.close();
  }

  private renderRow(skill: SkillTabEntry): void {
    if (!this.listEl) return;

    const row = this.listEl.createDiv({
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
      this.onRunSkill(skill);
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
