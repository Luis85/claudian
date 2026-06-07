import { type App, Component, MarkdownRenderer, Modal, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import { formatRelativeTime } from '../../../utils/date';
import { isPureAcceptanceChecklist, parseAcceptanceChecklist } from '../model/acceptanceChecklist';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { hasAnyHandoffSection, parseHandoffSections } from '../model/handoffSections';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderEditableValueChip } from './editableValueChip';
import { renderSectionHeader } from './sectionHeader';

// One collapsible Agent-handoff card. `body` is the section's raw markdown
// (rendered through MarkdownRenderer so inline links stay live); `modifier`
// keys the per-section icon color in CSS; `defaultOpen` follows the spec.
interface HandoffCard {
  titleKey: TranslationKey;
  /** Lucide glyph; the color (per the spec table) is what matters, set in CSS. */
  icon: string;
  /** Per-section modifier driving the icon color (--summary/--verification/…). */
  modifier: string;
  defaultOpen: boolean;
  body: string;
}

// A parsed run-ledger line: `- <iso-ts> [<status>] <message>`. Malformed lines
// are dropped by the parser so the rendered list only holds well-formed entries.
interface LedgerEntry {
  timestamp: string;
  status: string;
  message: string;
}

const LEDGER_LINE = /^-\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$/;

// Footer button visual variant. `ghost` = transparent secondary; `cta` = the
// accent primary; `danger` = the destructive red action. The visual tokens for
// each live in CSS keyed off the modifier class below.
type FooterActionVariant = 'ghost' | 'cta' | 'danger';

// One sticky-footer action: a real `<button>` with a leading Lucide icon and a
// keyed label. `side` groups the button left (secondary/ghost) or right
// (primary group); `run` is invoked after the modal closes (close-on-click is
// preserved for every action). Actions whose callback is optional/missing are
// filtered out before render.
interface FooterAction {
  variant: FooterActionVariant;
  icon: string;
  labelKey: TranslationKey;
  side: 'left' | 'right';
  run: () => void;
}

export interface WorkOrderFieldUpdate {
  title?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
}

export interface WorkOrderOption {
  value: string;
  label: string;
}

export interface WorkOrderDetailModalCallbacks {
  onOpenNote(task: TaskSpec): void;
  onOpenConversation?(task: TaskSpec): void;
  /** Whether the linked conversation still exists and can be opened. Hides the button when false. */
  canOpenConversation?(task: TaskSpec): boolean;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  /** needs_handoff → review: salvage a run that finished without a structured handoff. */
  onSendToReview?(task: TaskSpec): void;
  /** needs_handoff → failed: give up on a run that finished without a structured handoff. */
  onMarkFailed?(task: TaskSpec): void;
  onArchive(task: TaskSpec): void;
  onSaveFields(task: TaskSpec, fields: WorkOrderFieldUpdate): void | Promise<void>;
  getProviderOptions(): WorkOrderOption[];
  getModelOptions(providerId: string): WorkOrderOption[];
}

const PRIORITY_OPTIONS: TaskPriority[] = ['0 - urgent', '1 - high', '2 - normal', '3 - low'];

// Statuses whose title can still be renamed inline. Every other status
// (running + terminal/review states) renders the title as plain text.
const EDITABLE_TITLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'inbox',
  'ready',
  'needs_fix',
]);

// The detail modal is a singleton (one work order open at a time), so a stable
// id is safe to use as the dialog's `aria-labelledby` target.
const TITLE_ID = 'claudian-work-order-modal-title';

// Numeric level extracted from the `N - label` priority string. Drives the
// status/color modifier class (`--0..3`) and the count of filled priority bars
// (urgent fills all 3, low fills 1). The status→color and priority→color maps
// themselves live in CSS (work-order-modal.css) keyed off these modifiers, so
// the visual token contract stays in one place.
const PRIORITY_LEVEL: Record<TaskPriority, number> = {
  '0 - urgent': 0,
  '1 - high': 1,
  '2 - normal': 2,
  '3 - low': 3,
};
const PRIORITY_FILLED_BARS: Record<TaskPriority, number> = {
  '0 - urgent': 3,
  '1 - high': 3,
  '2 - normal': 2,
  '3 - low': 1,
};

interface PropertyRow {
  el: HTMLElement;
  value: HTMLElement;
}

export class WorkOrderDetailModal extends Modal {
  private readonly markdownComponent = new Component();

  constructor(
    app: App,
    private readonly task: TaskSpec,
    private readonly callbacks: WorkOrderDetailModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    this.markdownComponent.load();
    this.modalEl.addClass('claudian-work-order-modal');

    // Sticky-shell frame: contentEl becomes a flex column with a pinned header,
    // a scrollable two-pane body (main + properties sidebar), and a pinned
    // footer. Header/footer stay reachable while only the body scrolls. The
    // header now owns the title (meta row + editable title + close button), so
    // the native modal title is intentionally left empty.
    this.contentEl.addClass('claudian-work-order-modal-content');
    const header = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-header' });
    const body = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-body' });
    const main = body.createDiv({ cls: 'claudian-work-order-modal-main' });
    const sidebar = body.createDiv({ cls: 'claudian-work-order-modal-sidebar' });
    const footer = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-footer' });

    this.renderHeader(header);

    this.renderPropertiesSidebar(sidebar);

    this.renderObjective(main);
    this.renderAcceptance(main);
    this.renderActivity(main);

    this.renderActions(footer);
  }

  onClose(): void {
    this.markdownComponent.unload();
    this.contentEl.empty();
  }

  /**
   * Pinned header: a meta row (ID chip + status-aware caption), the work-order
   * title (inline-editable in editable states), a left-anchored 2px accent
   * gradient keyed off the status→color contract, and a top-right close button.
   * The header owns the title — the native modal title stays empty.
   */
  private renderHeader(header: HTMLElement): void {
    const { status } = this.task.frontmatter;
    header.addClass(`claudian-work-order-modal-header--${status}`);

    this.renderHeaderMeta(header);
    this.renderHeaderTitle(header);

    // 2px accent line on the header's bottom edge (color from the CSS modifier).
    header.createDiv({ cls: 'claudian-work-order-modal-header-accent' }).setAttr('aria-hidden', 'true');

    const close = header.createEl('button', {
      cls: 'claudian-work-order-modal-close',
      attr: { type: 'button', 'aria-label': t('tasks.workOrderModal.closeAriaLabel') },
    });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.close());
  }

  /**
   * Meta row above the title: the monospace ID chip plus a status-aware
   * caption — a pulsing live dot + "Started … ago" while running, or a
   * "Finished … ago" caption once done. Captions are omitted when the backing
   * timestamp is missing or unparseable.
   */
  private renderHeaderMeta(header: HTMLElement): void {
    const fm = this.task.frontmatter;
    const meta = header.createDiv({ cls: 'claudian-work-order-modal-header-meta' });

    const chip = meta.createSpan({
      cls: 'claudian-work-order-modal-id-chip claudian-work-order-modal-mono',
      text: fm.id,
    });
    chip.setAttr('title', fm.id);
    chip.setAttr('aria-label', fm.id);

    if (fm.status === 'running') {
      const started = formatRelativeTime(fm.started);
      if (started) {
        const live = meta.createSpan({ cls: 'claudian-work-order-modal-header-live' });
        live.createSpan({ cls: 'claudian-work-order-modal-live-dot' }).setAttr('aria-hidden', 'true');
        live.createSpan({ text: t('tasks.workOrderModal.startedAgo', { ago: started }) });
      }
      return;
    }

    if (fm.status === 'done') {
      const finished = formatRelativeTime(fm.finished);
      if (finished) {
        meta.createSpan({
          cls: 'claudian-work-order-modal-header-sub',
          text: t('tasks.workOrderModal.finishedAt', { ago: finished }),
        });
      }
    }
  }

  /**
   * Work-order title. In editable states (inbox / ready / needs_fix) it is a
   * keyboard-focusable `contenteditable="plaintext-only"` element (the
   * plaintext clamp blocks rich-paste DOM injection into a plain-text field):
   * Enter commits (blur), Esc reverts to the original and blurs, and a blur
   * with a changed, non-empty value persists through `onSaveFields`. A rename
   * hint sits under the title. Every other status renders plain, static text.
   */
  private renderHeaderTitle(header: HTMLElement): void {
    const { task } = this;
    const original = task.frontmatter.title;
    const editable = EDITABLE_TITLE_STATUSES.has(task.frontmatter.status);

    const title = header.createDiv({ cls: 'claudian-work-order-modal-title' });
    title.setText(original);
    // The custom header replaces the native modal title, so expose the dialog's
    // accessible name through this element via `aria-labelledby`.
    title.setAttr('id', TITLE_ID);
    this.modalEl.setAttribute('aria-labelledby', TITLE_ID);

    if (!editable) {
      // A static (non-editable) title also doubles as the dialog heading.
      title.setAttr('role', 'heading');
      title.setAttr('aria-level', '2');
      return;
    }

    title.addClass('is-editable');
    title.setAttr('contenteditable', 'plaintext-only');
    title.setAttr('tabindex', '0');
    title.setAttr('spellcheck', 'false');

    // `committed` tracks the last persisted value so a re-blur (e.g. Enter →
    // blur) does not double-save, and Esc's revert is measured against it.
    let committed = original;

    const commit = (): void => {
      // Collapse whitespace runs — including newlines from a multi-line paste,
      // which the plaintext-only field still accepts — so the title stays a
      // single line (a multi-line value would break the frontmatter + body H1).
      const next = (title.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (next.length === 0 || next === committed) {
        // Reject empty/unchanged edits, but restore the displayed text so the
        // header never lingers in a blank or stray-whitespace unsaved state.
        title.setText(committed);
        return;
      }
      committed = next;
      // Reflect the normalized single-line value back into the field.
      title.setText(next);
      void this.callbacks.onSaveFields(task, { title: next });
    };

    title.addEventListener('blur', commit);
    title.addEventListener('keydown', (evt) => {
      const event = evt as KeyboardEvent;
      // While an IME composition is active, Enter/Escape belong to the IME
      // (confirm / cancel the candidate) — don't treat them as commit/revert.
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        title.blur();
      } else if (event.key === 'Escape') {
        title.setText(committed);
        title.blur();
      }
    });

    const hint = header.createDiv({ cls: 'claudian-work-order-modal-title-hint' });
    hint.setText(t('tasks.workOrderModal.editTitleHint'));
  }

  /**
   * Status-driven Activity block rendered after Objective + Acceptance:
   * - `review` / `needs_fix` with handoff content → structured Agent-handoff cards.
   * - `needs_handoff` → salvage callout + collapsible transcript tail.
   * - `failed` with ledger content → run-ledger list.
   * Every other status renders nothing.
   */
  private renderActivity(parent: HTMLElement): void {
    const { status } = this.task.frontmatter;
    if ((status === 'review' || status === 'needs_fix') && this.task.sections.handoff.length > 0) {
      this.renderHandoff(parent, this.task.sections.handoff);
      return;
    }
    if (status === 'needs_handoff') {
      this.renderHandoffSalvage(parent);
      return;
    }
    if (status === 'failed' && this.task.sections.ledger.length > 0) {
      this.renderRunLedger(parent, this.task.sections.ledger);
    }
  }

  /**
   * Agent handoff: parse the `## Heading\nbody` region into the four
   * ParsedHandoff fields and render them as collapsible bordered cards
   * (Summary / Verification / Risks / Next action). If the region parses into no
   * known section, fall back to rendering the full raw markdown so handoff text
   * is never dropped.
   */
  private renderHandoff(parent: HTMLElement, markdown: string): void {
    const { section } = renderSectionHeader(parent, {
      icon: 'clipboard-check',
      label: t('tasks.workOrderModal.sectionHandoff'),
    });

    const parsed = parseHandoffSections(markdown);
    if (!hasAnyHandoffSection(parsed)) {
      const fallback = section.createDiv({ cls: 'claudian-work-order-modal-handoff-fallback' });
      void MarkdownRenderer.render(this.app, markdown, fallback, this.task.path, this.markdownComponent);
      return;
    }

    const cards: HandoffCard[] = [
      { titleKey: 'tasks.workOrderModal.handoffSummary', icon: 'align-left', modifier: 'summary', defaultOpen: true, body: parsed.summary },
      { titleKey: 'tasks.workOrderModal.handoffVerification', icon: 'check-circle', modifier: 'verification', defaultOpen: false, body: parsed.verification },
      { titleKey: 'tasks.workOrderModal.handoffRisks', icon: 'alert-triangle', modifier: 'risks', defaultOpen: false, body: parsed.risks },
      { titleKey: 'tasks.workOrderModal.handoffNextAction', icon: 'arrow-right', modifier: 'next', defaultOpen: true, body: parsed.nextAction },
    ];

    const group = section.createDiv({ cls: 'claudian-work-order-modal-collapse-group' });
    for (const card of cards) {
      this.renderCollapsible(group, {
        title: t(card.titleKey),
        icon: card.icon,
        modifier: card.modifier,
        defaultOpen: card.defaultOpen,
        renderBody: (body) =>
          void MarkdownRenderer.render(this.app, card.body, body, this.task.path, this.markdownComponent),
      });
    }
  }

  /**
   * Needs-handoff salvage: a warning callout explaining the run finished without
   * a structured handoff, plus a collapsible monospace transcript tail sourced
   * from the available run trace (`sections.ledger`).
   */
  private renderHandoffSalvage(parent: HTMLElement): void {
    const { section } = renderSectionHeader(parent, {
      icon: 'alert-triangle',
      label: t('tasks.workOrderModal.salvageTitle'),
    });

    section.createDiv({
      cls: 'claudian-work-order-modal-salvage-callout',
      text: t('tasks.workOrderModal.salvageCallout'),
    });

    const trace = this.task.sections.ledger.trim();
    const group = section.createDiv({ cls: 'claudian-work-order-modal-collapse-group' });
    this.renderCollapsible(group, {
      title: t('tasks.workOrderModal.transcriptTail'),
      icon: 'scroll-text',
      modifier: 'tail',
      defaultOpen: true,
      renderBody: (body) => {
        const trail = body.createDiv({ cls: 'claudian-work-order-modal-tail-body' });
        trail.setText(trace.length > 0 ? trace : t('tasks.workOrderModal.transcriptTailEmpty'));
      },
    });
  }

  /**
   * Failed run ledger: parse the `- <ts> [<status>] <message>` lines (malformed
   * lines dropped) into an ordered list of status-colored dot + monospace time +
   * message rows. Dot color follows the status→color contract via a CSS modifier.
   */
  private renderRunLedger(parent: HTMLElement, ledger: string): void {
    const entries = this.parseLedger(ledger);
    if (entries.length === 0) return;

    const { section } = renderSectionHeader(parent, {
      icon: 'scroll-text',
      label: t('tasks.workOrderModal.sectionRunLedger'),
    });

    const list = section.createEl('ol', { cls: 'claudian-work-order-modal-ledger' });
    for (const entry of entries) {
      const row = list.createEl('li', { cls: 'claudian-work-order-modal-ledger-entry' });
      const dot = row.createSpan({
        cls: `claudian-work-order-modal-ledger-dot claudian-work-order-modal-ledger-dot--${entry.status}`,
      });
      dot.setAttr('aria-hidden', 'true');
      row.createSpan({ cls: 'claudian-work-order-modal-ledger-time', text: entry.timestamp });
      row.createSpan({ cls: 'claudian-work-order-modal-ledger-msg', text: entry.message });
    }
  }

  private parseLedger(ledger: string): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    for (const line of ledger.split('\n')) {
      const match = line.match(LEDGER_LINE);
      if (!match) continue;
      entries.push({ timestamp: match[1], status: match[2].trim(), message: match[3].trim() });
    }
    return entries;
  }

  /**
   * Shared collapsible card: a real `<button>` header (keyboard-operable,
   * `aria-expanded` reflecting state) carrying a rotating chevron + a colored
   * section icon + the title, over a body rendered on demand. Collapsible state
   * is local UI only — not persisted. The body is built lazily and cleared on
   * collapse so it re-renders cleanly on the next expand.
   */
  private renderCollapsible(
    parent: HTMLElement,
    options: {
      title: string;
      icon: string;
      modifier: string;
      defaultOpen: boolean;
      renderBody: (body: HTMLElement) => void;
    },
  ): void {
    const card = parent.createDiv({
      cls: `claudian-work-order-modal-collapse claudian-work-order-modal-collapse--${options.modifier}`,
    });

    const head = card.createEl('button', {
      cls: 'claudian-work-order-modal-collapse-head',
      attr: { type: 'button' },
    });
    const chevron = head.createSpan({ cls: 'claudian-work-order-modal-collapse-chevron' });
    chevron.setAttr('aria-hidden', 'true');
    chevron.setAttr('data-icon', 'chevron-right');
    setIcon(chevron, 'chevron-right');
    const icon = head.createSpan({ cls: 'claudian-work-order-modal-collapse-icon' });
    icon.setAttr('aria-hidden', 'true');
    icon.setAttr('data-icon', options.icon);
    setIcon(icon, options.icon);
    head.createSpan({ cls: 'claudian-work-order-modal-collapse-title', text: options.title });

    let open = false;
    let body: HTMLElement | undefined;
    const apply = (next: boolean): void => {
      open = next;
      head.setAttr('aria-expanded', open ? 'true' : 'false');
      card.toggleClass('is-open', open);
      if (open) {
        body ??= card.createDiv({ cls: 'claudian-work-order-modal-collapse-body' });
        body.empty();
        options.renderBody(body);
      } else if (body) {
        body.remove();
        body = undefined;
      }
    };
    head.addEventListener('click', () => apply(!open));
    apply(options.defaultOpen);
  }

  /**
   * Objective: shared section header (target icon) over a paragraph whose body
   * is rendered through `MarkdownRenderer` so Wikilinks / inline code / links
   * stay interactive.
   */
  private renderObjective(parent: HTMLElement): void {
    const { section } = renderSectionHeader(parent, {
      icon: 'target',
      label: t('tasks.workOrderModal.sectionObjective'),
    });
    const body = section.createDiv({ cls: 'claudian-work-order-modal-objective' });
    void MarkdownRenderer.render(
      this.app,
      this.task.sections.objective || '—',
      body,
      this.task.path,
      this.markdownComponent,
    );
  }

  /**
   * Acceptance criteria: shared section header (list-checks icon) with a
   * progress ring + done/total count in the right slot, over a read-only
   * checklist card. Counts come from `parseAcceptanceProgress`; the rows come
   * from `parseAcceptanceChecklist` (a sibling read-only parser) — no markdown
   * is mutated. The ring stroke follows the status→color contract and flips to
   * green at 100%.
   */
  private renderAcceptance(parent: HTMLElement): void {
    const { task } = this;
    const markdown = task.sections.acceptanceCriteria;
    const progress = parseAcceptanceProgress(markdown);
    const items = parseAcceptanceChecklist(markdown);

    const { section, right } = renderSectionHeader(parent, {
      icon: 'list-checks',
      label: t('tasks.workOrderModal.sectionAcceptance'),
    });

    if (progress.total > 0) {
      this.renderAcceptanceRing(right(), progress.done, progress.total, task.frontmatter.status);
    }

    // Render the custom checklist card only for a pure task-list. Anything else
    // — prose, plain bullets, or checkboxes interleaved with prose/nested lines
    // — renders as full markdown so no criteria are dropped from view.
    if (!isPureAcceptanceChecklist(markdown)) {
      if (markdown.trim().length === 0) {
        section.createDiv({ cls: 'claudian-work-order-modal-checklist-empty', text: '—' });
      } else {
        const prose = section.createDiv({ cls: 'claudian-work-order-modal-checklist-prose' });
        void MarkdownRenderer.render(this.app, markdown, prose, this.task.path, this.markdownComponent);
      }
      return;
    }

    const card = section.createDiv({ cls: 'claudian-work-order-modal-checklist' });
    for (const item of items) {
      const row = card.createDiv({ cls: 'claudian-work-order-modal-checklist-item' });
      // Read-only checkbox semantics so assistive tech hears the checked state;
      // the visible box glyph below stays decorative (aria-hidden).
      row.setAttr('role', 'checkbox');
      row.setAttr('aria-checked', item.checked ? 'true' : 'false');
      row.setAttr('aria-disabled', 'true');
      if (item.checked) row.addClass('is-checked');
      const box = row.createSpan({ cls: 'claudian-work-order-modal-checklist-box' });
      box.setAttr('aria-hidden', 'true');
      if (item.checked) {
        // The white check glyph is the non-color cue carrying the checked signal.
        const check = box.createSpan({ cls: 'claudian-work-order-modal-checklist-check' });
        check.setAttr('data-icon', 'check');
        setIcon(check, 'check');
      }
      // Render the label as markdown so inline links / wikilinks / code stay
      // interactive, matching the full-markdown fallback used for non-pure sections.
      const textEl = row.createDiv({ cls: 'claudian-work-order-modal-checklist-text' });
      void MarkdownRenderer.render(this.app, item.text, textEl, this.task.path, this.markdownComponent);
    }
  }

  /**
   * 22px SVG progress ring (faint track + status-accent arc) plus a done/total
   * count. The arc length is driven by `stroke-dasharray`/`stroke-dashoffset`
   * from the done ratio; at 100% a `--complete` modifier flips the stroke and
   * count color to green via CSS. Geometry mirrors the design prototype
   * (r=9, 22×22 viewBox, 2.5 stroke, rotated -90° so the arc starts at top).
   */
  private renderAcceptanceRing(
    parent: HTMLElement,
    done: number,
    total: number,
    status: TaskStatus,
  ): void {
    const radius = 9;
    const circumference = 2 * Math.PI * radius;
    const ratio = total > 0 ? done / total : 0;
    const complete = total > 0 && done >= total;

    const meter = parent.createDiv({ cls: 'claudian-work-order-modal-ring-meter' });

    const ringClasses = [
      'claudian-work-order-modal-ring',
      `claudian-work-order-modal-ring--${status}`,
      ...(complete ? ['claudian-work-order-modal-ring--complete'] : []),
    ].join(' ');
    const svg = meter.createSvg('svg', {
      cls: ringClasses,
      attr: { width: 22, height: 22, viewBox: '0 0 22 22' },
    });
    svg.setAttr('aria-hidden', 'true');
    svg.createSvg('circle', {
      cls: 'claudian-work-order-modal-ring-track',
      attr: { cx: 11, cy: 11, r: radius, fill: 'none', 'stroke-width': 2.5 },
    });
    svg.createSvg('circle', {
      cls: 'claudian-work-order-modal-ring-arc',
      attr: {
        cx: 11,
        cy: 11,
        r: radius,
        fill: 'none',
        'stroke-width': 2.5,
        'stroke-linecap': 'round',
        'stroke-dasharray': circumference,
        'stroke-dashoffset': circumference * (1 - ratio),
        transform: 'rotate(-90 11 11)',
      },
    });

    meter.createSpan({
      cls: 'claudian-work-order-modal-ring-count',
      text: `${done}/${total}`,
    });
  }

  /**
   * Right-pane Properties sidebar. Running work orders are read-only (status
   * pill, monospace provider/model, priority bars); every other status renders
   * Provider / Model / Priority as editable value chips persisted through
   * `onSaveFields`. The Agent row is a placeholder slot filled by the persona
   * slice.
   */
  private renderPropertiesSidebar(parent: HTMLElement): void {
    const { task } = this;
    const fm = task.frontmatter;
    const editable = fm.status !== 'running';

    const panel = parent.createDiv({ cls: 'claudian-work-order-modal-properties' });
    panel.createDiv({
      cls: 'claudian-work-order-modal-properties-head',
      text: t('tasks.workOrderModal.properties'),
    });

    // Status — always a colored pill.
    const statusValue = this.addPropertyRow(panel, 'status', 'circle-dot', t('tasks.workOrderModal.fieldStatus')).value;
    this.renderStatusPill(statusValue, fm.status);

    // Agent — placeholder slot (no avatar; the persona slice fills this).
    this.addPropertyRow(panel, 'agent', 'user', t('tasks.workOrderModal.fieldAgent')).value.createSpan({
      cls: 'claudian-work-order-modal-prop-placeholder',
      text: '—',
    });

    // Provider / Model — chips when editable; Provider change resets Model.
    const providerValue = this.addPropertyRow(panel, 'provider', 'cpu', t('tasks.workOrderModal.fieldProvider')).value;
    const modelValue = this.addPropertyRow(panel, 'model', 'sparkles', t('tasks.workOrderModal.fieldModel')).value;
    if (editable) {
      const modelChip = renderEditableValueChip({
        parent: modelValue,
        value: fm.model ?? '',
        options: this.callbacks.getModelOptions(fm.provider ?? ''),
        emptyOption: { value: '', label: 'Provider default' },
        onChange: (value) => void this.callbacks.onSaveFields(task, { model: value }),
      });
      renderEditableValueChip({
        parent: providerValue,
        value: fm.provider ?? '',
        options: this.callbacks.getProviderOptions(),
        onChange: (value) => {
          void this.callbacks.onSaveFields(task, { provider: value, model: '' });
          modelChip.setOptions({
            value: '',
            options: this.callbacks.getModelOptions(value),
            emptyOption: { value: '', label: 'Provider default' },
          });
        },
      });
    } else {
      providerValue.createSpan({
        cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-mono',
        text: fm.provider ?? '—',
      });
      modelValue.createSpan({
        cls: 'claudian-work-order-modal-prop-inner',
        text: fm.model ?? '—',
      });
    }

    // Priority — chip when editable; ascending bars + label otherwise.
    const priorityValue = this.addPropertyRow(panel, 'priority', 'signal', t('tasks.workOrderModal.fieldPriority')).value;
    if (editable) {
      renderEditableValueChip({
        parent: priorityValue,
        value: fm.priority,
        options: PRIORITY_OPTIONS.map((p) => ({ value: p, label: p })),
        onChange: (value) => void this.callbacks.onSaveFields(task, { priority: value as TaskPriority }),
      });
    } else {
      this.renderPriorityBars(priorityValue, fm.priority);
    }

    panel.createDiv({ cls: 'claudian-work-order-modal-properties-divider' });

    this.addPropertyRow(panel, 'created', 'calendar', t('tasks.workOrderModal.fieldCreated')).value.createSpan({
      cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
      text: fm.created,
    });
    this.addPropertyRow(panel, 'updated', 'clock', t('tasks.workOrderModal.fieldUpdated')).value.createSpan({
      cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
      text: fm.updated,
    });
    this.addPropertyRow(panel, 'attempts', 'repeat', t('tasks.workOrderModal.fieldAttempts')).value.createSpan({
      cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
      text: String(fm.attempts),
    });

    if (
      fm.conversation_id &&
      this.callbacks.onOpenConversation &&
      (this.callbacks.canOpenConversation?.(task) ?? true)
    ) {
      const convValue = this.addPropertyRow(
        panel,
        'conversation',
        'message-square',
        t('tasks.workOrderModal.fieldConversation'),
      ).value;
      const link = convValue.createEl('a', {
        cls: 'claudian-work-order-modal-prop-link',
        text: fm.conversation_id,
        href: '#',
      });
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.callbacks.onOpenConversation?.(task);
      });
    }
  }

  private addPropertyRow(
    parent: HTMLElement,
    key: string,
    icon: string,
    label: string,
  ): PropertyRow {
    const row = parent.createDiv({
      cls: 'claudian-work-order-modal-prop-row',
      attr: { 'data-prop': key },
    });
    const labelEl = row.createSpan({ cls: 'claudian-work-order-modal-prop-label' });
    const iconEl = labelEl.createSpan({ cls: 'claudian-work-order-modal-prop-icon' });
    iconEl.setAttr('data-icon', icon);
    setIcon(iconEl, icon);
    labelEl.createSpan({ cls: 'claudian-work-order-modal-prop-label-text', text: label });
    const value = row.createSpan({ cls: 'claudian-work-order-modal-prop-value' });
    return { el: row, value };
  }

  private renderStatusPill(parent: HTMLElement, status: TaskStatus): void {
    const pill = parent.createSpan({
      cls: `claudian-work-order-modal-status-pill claudian-work-order-modal-status-pill--${status}`,
    });
    pill.createSpan({ cls: 'claudian-work-order-modal-status-dot' });
    pill.createSpan({ cls: 'claudian-work-order-modal-status-label', text: status });
  }

  private renderPriorityBars(parent: HTMLElement, priority: TaskPriority): void {
    const wrap = parent.createSpan({
      cls: `claudian-work-order-modal-prop-inner claudian-work-order-modal-priority claudian-work-order-modal-priority--${PRIORITY_LEVEL[priority]}`,
    });
    const bars = wrap.createSpan({ cls: 'claudian-work-order-modal-priority-bars' });
    bars.setAttr('aria-hidden', 'true');
    const filled = PRIORITY_FILLED_BARS[priority];
    for (let i = 0; i < 3; i += 1) {
      const bar = bars.createEl('i');
      if (i < filled) bar.addClass('is-filled');
    }
    wrap.createSpan({ cls: 'claudian-work-order-modal-priority-label', text: priority });
  }

  /**
   * Sticky-footer action set. Secondary (ghost) buttons group left, the primary
   * group (CTA / danger) right — every button is a real keyboard-focusable
   * `<button>` with a leading Lucide icon. The set is status-driven (see
   * `footerActions`); each action closes the modal first, then runs its
   * callback, preserving the prior close-on-click contract. Run is deliberately
   * absent — in the redesign Run is a board-card action, not a modal action.
   */
  private renderActions(parent: HTMLElement): void {
    const actions = this.footerActions();

    const left = parent.createDiv({
      cls: 'claudian-work-order-modal-footer-group claudian-work-order-modal-footer-group--left',
    });
    const right = parent.createDiv({
      cls: 'claudian-work-order-modal-footer-group claudian-work-order-modal-footer-group--right',
    });

    for (const action of actions) {
      this.renderFooterButton(action.side === 'right' ? right : left, action);
    }
  }

  /**
   * Resolve the footer action list for the current status. Every status gets
   * Open note (ghost, left) and — when a conversation link exists and can be
   * opened — Open conversation (ghost, left). The right-side primary group is
   * status-specific. Statuses the spec does not tabulate fall back to a minimal
   * footer so none renders a dead footer.
   */
  private footerActions(): FooterAction[] {
    const { task } = this;
    const { status } = task.frontmatter;
    const actions: FooterAction[] = [];

    // Open note — present on every status.
    actions.push({
      variant: 'ghost',
      icon: 'file-text',
      labelKey: 'tasks.workOrderModal.actionOpenNote',
      side: 'left',
      run: () => this.callbacks.onOpenNote(task),
    });

    // Open conversation — left ghost, only when the linked conversation exists
    // and can still be opened (mirrors the sidebar Conversation-row guard).
    const canOpenConversation =
      Boolean(task.frontmatter.conversation_id) &&
      Boolean(this.callbacks.onOpenConversation) &&
      (this.callbacks.canOpenConversation?.(task) ?? true);

    const addOpenConversation = (): void => {
      if (!canOpenConversation) return;
      actions.push({
        variant: 'ghost',
        icon: 'message-square',
        labelKey: 'tasks.workOrderModal.actionOpenConversation',
        side: 'left',
        run: () => this.callbacks.onOpenConversation?.(task),
      });
    };

    switch (status) {
      case 'inbox':
        actions.push({
          variant: 'cta',
          icon: 'check',
          labelKey: 'tasks.workOrderModal.actionMarkReady',
          side: 'right',
          run: () => this.callbacks.onMarkReady(task),
        });
        break;

      // Live / read-only states: Open conversation + a single Stop danger.
      case 'running':
      case 'needs_input':
      case 'needs_approval':
        addOpenConversation();
        actions.push({
          variant: 'danger',
          icon: 'square',
          labelKey: 'tasks.workOrderModal.actionStop',
          side: 'right',
          run: () => this.callbacks.onStop(task),
        });
        break;

      case 'review':
        addOpenConversation();
        actions.push({
          variant: 'ghost',
          icon: 'rotate-ccw',
          labelKey: 'tasks.workOrderModal.actionRework',
          side: 'right',
          run: () => this.callbacks.onRework(task),
        });
        actions.push({
          variant: 'cta',
          icon: 'check',
          labelKey: 'tasks.workOrderModal.actionAccept',
          side: 'right',
          run: () => this.callbacks.onAccept(task),
        });
        break;

      case 'needs_handoff':
        addOpenConversation();
        actions.push({
          variant: 'danger',
          icon: 'triangle',
          labelKey: 'tasks.workOrderModal.actionMarkFailed',
          side: 'right',
          run: () => this.callbacks.onMarkFailed?.(task),
        });
        actions.push({
          variant: 'cta',
          icon: 'check',
          labelKey: 'tasks.workOrderModal.actionSendToReview',
          side: 'right',
          run: () => this.callbacks.onSendToReview?.(task),
        });
        break;

      case 'done':
        actions.push({
          variant: 'ghost',
          icon: 'archive',
          labelKey: 'tasks.workOrderModal.actionArchive',
          side: 'left',
          run: () => this.callbacks.onArchive(task),
        });
        actions.push({
          variant: 'ghost',
          icon: 'rotate-ccw',
          labelKey: 'tasks.workOrderModal.actionReopen',
          side: 'right',
          run: () => this.callbacks.onReopen(task),
        });
        break;

      case 'failed':
        actions.push({
          variant: 'ghost',
          icon: 'archive',
          labelKey: 'tasks.workOrderModal.actionArchive',
          side: 'right',
          run: () => this.callbacks.onArchive(task),
        });
        break;

      case 'canceled':
        actions.push({
          variant: 'ghost',
          icon: 'archive',
          labelKey: 'tasks.workOrderModal.actionArchive',
          side: 'right',
          run: () => this.callbacks.onArchive(task),
        });
        break;

      // ready / needs_fix (and any future status): Open note + Open conversation
      // only. Run is a board action now, so no right-side primary here.
      default:
        addOpenConversation();
        break;
    }

    return actions;
  }

  private renderFooterButton(parent: HTMLElement, action: FooterAction): void {
    const button = parent.createEl('button', {
      cls: `claudian-work-order-modal-action claudian-work-order-modal-action--${action.variant}`,
      attr: { type: 'button' },
    });
    const icon = button.createSpan({ cls: 'claudian-work-order-modal-action-icon' });
    icon.setAttr('aria-hidden', 'true');
    // The mock `setIcon` is a no-op; the data attribute records the icon intent
    // so tests can assert it (consistent with the rest of the modal).
    icon.setAttr('data-icon', action.icon);
    setIcon(icon, action.icon);
    button.createSpan({ cls: 'claudian-work-order-modal-action-label', text: t(action.labelKey) });
    button.addEventListener('click', () => {
      this.close();
      action.run();
    });
  }
}
