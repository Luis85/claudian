import { type App, Component, MarkdownRenderer, Modal, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { formatRelativeTime } from '../../../utils/date';
import { isPureAcceptanceChecklist, parseAcceptanceChecklist } from '../model/acceptanceChecklist';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderSectionHeader } from './sectionHeader';
import { renderWorkOrderActivity } from './workOrderActivitySection';
import { type FooterAction, footerActionsForStatus } from './workOrderFooterActions';
import { renderWorkOrderProperties } from './workOrderPropertiesPanel';

export interface WorkOrderFieldUpdate {
  title?: string;
  /** Assigned Agents persona id. */
  agent?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
  /** Attached loop slug; empty string detaches. */
  loop?: string;
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
  onRun?(task: TaskSpec): void;
  onStop?(task: TaskSpec): void;
  onAccept?(task: TaskSpec): void;
  onRework?(task: TaskSpec): void;
  onMarkReady?(task: TaskSpec): void;
  onReopen?(task: TaskSpec): void;
  /** needs_handoff → review: salvage a run that finished without a structured handoff. */
  onSendToReview?(task: TaskSpec): void;
  /** needs_handoff → failed: give up on a run that finished without a structured handoff. */
  onMarkFailed?(task: TaskSpec): void;
  onArchive?(task: TaskSpec): void;
  onSaveFields?(task: TaskSpec, fields: WorkOrderFieldUpdate): void | Promise<void>;
  getProviderOptions(): WorkOrderOption[];
  getModelOptions(providerId: string): WorkOrderOption[];
  /** Open the loop picker for this task and persist the choice. */
  onPickLoop?(task: TaskSpec): void;
  /** Resolve the task's attached loop slug to a display name (sync, best-effort). */
  getLoopName?(loopId: string | undefined): string | undefined;
}

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
    // Size the modal through the variables Obsidian's own `.modal` rule consumes
    // so the height cap applies regardless of how the active theme out-specifies
    // a bare `.modal` selector. Writing them on modalEl is the most reliable
    // hook; the CSS mirrors these as a fallback.
    this.modalEl.setCssProps({
      '--modal-max-height': 'min(86vh, 760px)',
      '--dialog-max-height': 'min(86vh, 760px)',
      '--modal-width': 'min(960px, 92vw)',
      '--dialog-width': 'min(960px, 92vw)',
      '--modal-max-width': 'min(960px, 92vw)',
      '--dialog-max-width': 'min(960px, 92vw)',
    });

    // Pinned header → the NATIVE modal header. `this.titleEl` is Obsidian's
    // `.modal-title`, which sits inside a `.modal-header` that is a SIBLING of
    // `.modal-content` — so it stays pinned above the scrolling content without a
    // custom sticky layer, and we reuse the native chrome instead of duplicating
    // it. The body + footer live in the scrolling content.
    const header = this.titleEl;
    header.addClass('claudian-work-order-modal-header');
    this.renderHeader(header);

    this.contentEl.addClass('claudian-work-order-modal-content');
    const body = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-body' });
    const main = body.createDiv({ cls: 'claudian-work-order-modal-main' });
    const sidebar = body.createDiv({ cls: 'claudian-work-order-modal-sidebar' });
    const footer = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-footer' });

    renderWorkOrderProperties(sidebar, this.task, this.callbacks);

    this.renderObjective(main);
    this.renderAcceptance(main);
    renderWorkOrderActivity(main, {
      task: this.task,
      app: this.app,
      markdownComponent: this.markdownComponent,
    });

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
    // Closing is handled by Obsidian's built-in modal close button — no custom
    // reimplementation of core chrome.
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
      void this.callbacks.onSaveFields?.(task, { title: next });
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
        // The em-dash placeholder is decorative and supplied via CSS (::before
        // content), so no user-visible text literal lives in JS here.
        section.createDiv({ cls: 'claudian-work-order-modal-checklist-empty' });
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

    const svg = meter.createSvg('svg', {
      attr: { width: 22, height: 22, viewBox: '0 0 22 22' },
    });
    svg.setAttr('aria-hidden', 'true');
    // Add the ring classes one token at a time. Obsidian's createSvg applies a
    // `cls` value via classList.add(), which throws on any space-containing
    // token — so never pass a joined string (or rely on array handling); set
    // each class individually. A joined-string cls here previously crashed
    // onOpen mid-render (no acceptance items, no activity, empty footer).
    svg.addClass('claudian-work-order-modal-ring');
    svg.addClass(`claudian-work-order-modal-ring--${status}`);
    if (complete) svg.addClass('claudian-work-order-modal-ring--complete');
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

  private footerActions(): FooterAction[] {
    return footerActionsForStatus(this.task, this.callbacks);
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
