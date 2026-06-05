import type { EventBus } from '../../../core/events/EventBus';
import type { UsageEventMap } from '../../../core/usage/events';
import type { UsageRecord } from '../../../core/usage/types';
import { t } from '../../../i18n/i18n';
import type { SkillTabEntry } from '../skills/types';
import type { QuickAction } from '../types';
import { formatUsageBadge, loadBadgeI18n } from './formatUsageBadge';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DROP_DAYS_THRESHOLD = 30;
const TOP_K = 5;
const DROP_CANDIDATE_LIMIT = 10;
const REFRESH_DEBOUNCE_MS = 250;

type SortKey = 'mostUsed' | 'leastUsed' | 'longestUnused' | 'recentlyUsed';

interface Row {
  kind: 'quickAction' | 'skill';
  name: string;
  providerId?: string;
  providerDisplayName?: string;
  count: number;
  lastUsedAt: number;
}

export interface UsageStatsTabOptions {
  tracker: { getAll(): ReadonlyMap<string, UsageRecord> };
  events: EventBus<UsageEventMap>;
  quickActions: () => QuickAction[];
  skills: () => SkillTabEntry[];
  now: () => number;
  onClearAll: () => void;
}

export class UsageStatsTab {
  private host: HTMLElement | null = null;
  private sort: SortKey = 'mostUsed';
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;

  constructor(private opts: UsageStatsTabOptions) {}

  render(host: HTMLElement): void {
    this.host = host;
    this.unsubscribe?.();
    this.unsubscribe = this.opts.events.on('usage.recorded', () => this.scheduleRefresh());
    this.paint();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.paint();
    }, REFRESH_DEBOUNCE_MS);
  }

  private paint(): void {
    if (!this.host) return;
    this.host.empty();
    const rows = this.collectLiveRows();

    if (rows.length === 0) {
      this.host.createDiv({
        cls: 'claudian-usage-empty',
        text: t('quickActions.usage.empty'),
      });
      this.renderClearAllButton();
      return;
    }

    this.renderTop(rows);
    this.renderDropCandidates(rows);
    this.renderAll(rows);
    this.renderClearAllButton();
  }

  private collectLiveRows(): Row[] {
    const all = this.opts.tracker.getAll();
    const liveActionStems = new Set(
      this.opts.quickActions().map((a) => filenameStem(a.filePath)),
    );
    const liveSkills = this.opts.skills();
    const liveSkillKeys = new Set(
      liveSkills.map((s) => `${s.providerId}:${s.name}`),
    );
    const providerDisplay = new Map(
      liveSkills.map((s) => [s.providerId, s.providerDisplayName]),
    );

    const out: Row[] = [];
    for (const [key, record] of all) {
      if (key.startsWith('quickAction:_:')) {
        const name = key.slice('quickAction:_:'.length);
        if (!liveActionStems.has(name)) continue;
        out.push({
          kind: 'quickAction', name,
          count: record.count, lastUsedAt: record.lastUsedAt,
        });
      } else if (key.startsWith('skill:')) {
        const rest = key.slice('skill:'.length);
        const sep = rest.indexOf(':');
        if (sep <= 0) continue;
        const providerId = rest.slice(0, sep);
        const name = rest.slice(sep + 1);
        if (!liveSkillKeys.has(`${providerId}:${name}`)) continue;
        out.push({
          kind: 'skill', name, providerId,
          providerDisplayName: providerDisplay.get(providerId) ?? providerId,
          count: record.count, lastUsedAt: record.lastUsedAt,
        });
      }
    }
    return out;
  }

  private renderTop(rows: Row[]): void {
    if (!this.host) return;
    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    section.createEl('h3', { text: t('quickActions.usage.topUsed') });
    const top = [...rows].sort((a, b) => b.count - a.count).slice(0, TOP_K);
    for (const row of top) {
      const el = section.createDiv({ cls: 'claudian-usage-top-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderDropCandidates(rows: Row[]): void {
    if (!this.host) return;
    const counts = rows.map((r) => r.count).sort((a, b) => a - b);
    const median = counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)];
    const now = this.opts.now();
    const candidates = rows
      .filter((r) => r.count < median && (now - r.lastUsedAt) > DROP_DAYS_THRESHOLD * ONE_DAY_MS)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
      .slice(0, DROP_CANDIDATE_LIMIT);

    if (candidates.length === 0) return;

    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    section.createEl('h3', { text: t('quickActions.usage.dropCandidates') });
    for (const row of candidates) {
      const el = section.createDiv({ cls: 'claudian-usage-drop-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderAll(rows: Row[]): void {
    if (!this.host) return;
    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    const header = section.createDiv({ cls: 'claudian-usage-all-header' });
    header.createEl('h3', { text: t('quickActions.usage.all') });

    const sortSel = header.createEl('select', { cls: 'claudian-usage-sort' });
    for (const key of ['mostUsed', 'leastUsed', 'longestUnused', 'recentlyUsed'] as const) {
      const opt = sortSel.createEl('option', {
        text: t(`quickActions.usage.sort.${key}`),
        attr: { value: key },
      });
      if (this.sort === key) opt.selected = true;
    }
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.paint();
    });

    const sorted = sortRows(rows, this.sort);
    for (const row of sorted) {
      const el = section.createDiv({ cls: 'claudian-usage-all-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderClearAllButton(): void {
    if (!this.host) return;
    const footer = this.host.createDiv({ cls: 'claudian-usage-footer' });
    const btn = footer.createEl('button', {
      cls: 'claudian-usage-clear-all',
      text: t('quickActions.usage.clearAll'),
    });
    btn.addEventListener('click', () => this.opts.onClearAll());
  }

  private paintRowLabel(el: HTMLElement, row: Row): void {
    const typeLabel = row.kind === 'quickAction'
      ? t('quickActions.usage.type.quickAction')
      : t('quickActions.usage.type.skill');
    const displayName = row.kind === 'skill'
      ? `${row.name} (${row.providerDisplayName ?? row.providerId ?? ''})`
      : row.name;
    el.createSpan({ cls: 'claudian-usage-row-type', text: typeLabel });
    el.createSpan({ cls: 'claudian-usage-row-name', text: displayName });
    el.createSpan({
      cls: 'claudian-usage-row-badge',
      text: formatUsageBadge(
        { count: row.count, lastUsedAt: row.lastUsedAt },
        this.opts.now(),
        loadBadgeI18n(),
      ),
    });
  }
}

function sortRows(rows: Row[], key: SortKey): Row[] {
  switch (key) {
    case 'mostUsed':       return [...rows].sort((a, b) => b.count - a.count);
    case 'leastUsed':      return [...rows].sort((a, b) => a.count - b.count);
    case 'longestUnused':  return [...rows].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    case 'recentlyUsed':   return [...rows].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }
}

function filenameStem(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}
