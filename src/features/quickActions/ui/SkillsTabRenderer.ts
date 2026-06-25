import { setIcon } from 'obsidian';

import { t } from '@/i18n/i18n';

import type { ProviderId } from '../../../core/providers/types';
import type { UsageRecord } from '../../../core/usage/types';
import type { SkillTabEntry, VaultSkillSource } from '../skills/types';
import { formatUsageBadge, loadBadgeI18n } from './formatUsageBadge';

const SKELETON_ROWS = 4;

export class SkillsTabRenderer {
  private skills: SkillTabEntry[] = [];
  private filter = '';
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(
    private source: VaultSkillSource,
    private onRunSkill: (entry: SkillTabEntry) => void,
    private onEditSkill: (entry: SkillTabEntry) => void,
    private close: () => void,
    private usageTracker: { getAll(): ReadonlyMap<string, UsageRecord> } | null = null,
    private now: () => number = () => Date.now(),
  ) {}

  async render(host: HTMLElement): Promise<HTMLInputElement | null> {
    this.filter = '';
    this.buildSearch(host);
    this.listEl = host.createDiv({
      cls: 'specorator-quick-actions-list specorator-quick-actions-skill-list',
    });

    // Phase A: instant paint from in-memory cache (may be empty on cold start).
    this.skills = this.source.listCachedNow();
    this.renderList();

    // Phase B: background refresh, streaming per-provider updates.
    void this.source.listAllStreaming((providerId, entries) => {
      this.patchProvider(providerId, entries);
    });

    return this.searchInputEl;
  }

  private patchProvider(providerId: ProviderId, freshEntries: SkillTabEntry[]): void {
    this.skills = this.skills.filter((s) => s.providerId !== providerId);
    this.skills.push(...freshEntries);
    this.renderList();
  }

  private buildSearch(host: HTMLElement): void {
    const searchWrap = host.createDiv({ cls: 'specorator-quick-actions-search' });
    const inputContainer = searchWrap.createDiv({
      cls: 'specorator-quick-actions-search-container',
    });
    const placeholder = t('quickActions.skills.searchPlaceholder');
    this.searchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'specorator-quick-actions-search-input',
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

    const refreshBtn = inputContainer.createEl('button', {
      cls: 'specorator-quick-actions-search-refresh',
      attr: {
        type: 'button',
        title: t('quickActions.skills.refreshTooltip'),
        'aria-label': t('quickActions.skills.refreshTooltip'),
      },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      this.source.invalidate();
      void this.source.listAllStreaming((providerId, entries) => {
        this.patchProvider(providerId, entries);
      });
    });
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.skills.length === 0) {
      this.renderSkeleton();
      return;
    }
    this.listEl.removeClass('specorator-quick-actions-skills-empty');

    const filtered = this.applyFilter(this.skills);
    filtered.sort((a, b) => {
      if (a.providerId !== b.providerId) {
        return a.providerId.localeCompare(b.providerId);
      }
      return a.name.localeCompare(b.name);
    });

    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'specorator-quick-actions-empty-results',
        text: t('quickActions.skills.noResults'),
      });
      return;
    }

    let lastProvider: string | null = null;
    for (const skill of filtered) {
      if (skill.providerId !== lastProvider) {
        this.listEl.createDiv({
          cls: 'specorator-quick-actions-provider-header',
          text: skill.providerDisplayName,
        });
        lastProvider = skill.providerId;
      }
      this.renderRow(skill);
    }
  }

  private renderSkeleton(): void {
    if (!this.listEl) return;
    this.listEl.addClass('specorator-quick-actions-skills-skeleton');
    for (let i = 0; i < SKELETON_ROWS; i++) {
      const row = this.listEl.createDiv({
        cls: 'specorator-quick-action-row specorator-quick-actions-skill-row is-skeleton',
      });
      row.createDiv({ cls: 'specorator-quick-action-icon is-skeleton-block' });
      const text = row.createDiv({ cls: 'specorator-quick-action-text' });
      text.createDiv({ cls: 'is-skeleton-line is-skeleton-line-title' });
      text.createDiv({ cls: 'is-skeleton-line is-skeleton-line-desc' });
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
      cls: 'specorator-quick-action-row specorator-quick-actions-skill-row',
    });
    if (!skill.providerEnabled) {
      row.addClass('is-provider-disabled');
    }

    const main = row.createDiv({
      cls: 'specorator-quick-action-main specorator-quick-actions-skill-row-main',
    });

    const iconEl = main.createSpan({ cls: 'specorator-quick-action-icon' });
    setIcon(iconEl, 'book-open');

    const textCol = main.createDiv({ cls: 'specorator-quick-action-text' });
    textCol.createEl('strong', { text: skill.name });
    if (skill.description) {
      textCol.createDiv({
        cls: 'specorator-quick-action-desc',
        text: skill.description,
      });
    }
    if (this.usageTracker) {
      const key = `skill:${skill.providerId}:${skill.name}`;
      const record = this.usageTracker.getAll().get(key) ?? null;
      textCol.createSpan({
        cls: 'specorator-skill-usage-badge',
        text: formatUsageBadge(record, this.now(), loadBadgeI18n()),
      });
    }
    if (!skill.providerEnabled) {
      textCol.createSpan({
        cls: 'specorator-quick-actions-skill-disabled-badge',
        text: t('quickActions.skills.disabledBadge'),
      });
    }

    main.addEventListener('click', () => {
      this.onRunSkill(skill);
      this.close();
    });

    if (skill.sourceFilePath) {
      const actions = row.createDiv({ cls: 'specorator-quick-action-actions' });
      const editBtn = actions.createEl('button', {
        cls: 'specorator-quick-actions-skill-edit',
        text: t('quickActions.skills.editInSettings', {
          provider: skill.providerDisplayName,
        }),
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onEditSkill(skill);
      });
    }
  }
}
