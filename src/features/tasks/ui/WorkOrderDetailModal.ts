import { type App, Component, MarkdownRenderer, Modal, setIcon, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { parseAcceptanceChecklist } from '../model/acceptanceChecklist';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderEditableValueChip } from './editableValueChip';
import { renderSectionHeader } from './sectionHeader';

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
    const { task } = this;
    this.markdownComponent.load();
    this.setTitle(task.frontmatter.title);
    this.modalEl.addClass('claudian-work-order-modal');

    // Sticky-shell frame: contentEl becomes a flex column with a pinned header,
    // a scrollable two-pane body (main + properties sidebar), and a pinned
    // footer. Header/footer stay reachable while only the body scrolls. This
    // slice keeps the inner surfaces unchanged — they are just relocated into
    // the new regions; the native modal title still owns the header text until
    // the header slice fills this container.
    this.contentEl.addClass('claudian-work-order-modal-content');
    this.contentEl.createDiv({ cls: 'claudian-work-order-modal-header' });
    const body = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-body' });
    const main = body.createDiv({ cls: 'claudian-work-order-modal-main' });
    const sidebar = body.createDiv({ cls: 'claudian-work-order-modal-sidebar' });
    const footer = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-footer' });

    this.renderPropertiesSidebar(sidebar);

    this.renderObjective(main);
    this.renderAcceptance(main);

    if (
      (task.frontmatter.status === 'review' || task.frontmatter.status === 'needs_fix') &&
      task.sections.handoff.length > 0
    ) {
      this.renderMarkdownBlock(main, 'Handoff', task.sections.handoff);
    }

    if (task.frontmatter.status === 'failed' && task.sections.ledger.length > 0) {
      this.renderMarkdownBlock(main, 'Run ledger', task.sections.ledger);
    }

    this.renderActions(footer);
  }

  onClose(): void {
    this.markdownComponent.unload();
    this.contentEl.empty();
  }

  // Handoff / Run-ledger markdown blocks (owned by a later slice). Objective and
  // Acceptance render through the dedicated section helpers below.
  private renderMarkdownBlock(parent: HTMLElement, label: string, markdown: string): void {
    parent.createEl('h4', { text: label, cls: 'claudian-work-order-modal-heading' });
    const el = parent.createDiv({ cls: 'claudian-work-order-modal-handoff' });
    void MarkdownRenderer.render(this.app, markdown, el, this.task.path, this.markdownComponent);
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

    if (items.length === 0) {
      if (markdown.trim().length === 0) {
        section.createDiv({ cls: 'claudian-work-order-modal-checklist-empty', text: '—' });
      } else {
        // Acceptance criteria that aren't task-list checkboxes (prose / plain
        // bullets) still render as markdown so existing or custom work orders
        // don't appear to have no criteria.
        const prose = section.createDiv({ cls: 'claudian-work-order-modal-checklist-prose' });
        void MarkdownRenderer.render(this.app, markdown, prose, this.task.path, this.markdownComponent);
      }
      return;
    }

    const card = section.createDiv({ cls: 'claudian-work-order-modal-checklist' });
    for (const item of items) {
      const row = card.createDiv({ cls: 'claudian-work-order-modal-checklist-item' });
      if (item.checked) row.addClass('is-checked');
      const box = row.createSpan({ cls: 'claudian-work-order-modal-checklist-box' });
      box.setAttr('aria-hidden', 'true');
      if (item.checked) {
        // The white check glyph is the non-color cue carrying the checked signal.
        const check = box.createSpan({ cls: 'claudian-work-order-modal-checklist-check' });
        check.setAttr('data-icon', 'check');
        setIcon(check, 'check');
      }
      row.createSpan({ cls: 'claudian-work-order-modal-checklist-text', text: item.text });
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

  private renderActions(parent: HTMLElement): void {
    const { task } = this;
    const actions = new Setting(parent);

    const editLabel = task.frontmatter.status === 'review' ? 'Open note' : 'Edit';
    actions.addButton((btn) =>
      btn.setButtonText(editLabel).onClick(() => {
        this.close();
        this.callbacks.onOpenNote(task);
      }),
    );

    if (
      task.frontmatter.conversation_id &&
      this.callbacks.onOpenConversation &&
      (this.callbacks.canOpenConversation?.(task) ?? true)
    ) {
      actions.addButton((btn) =>
        btn.setButtonText('Open conversation').onClick(() => {
          this.close();
          this.callbacks.onOpenConversation?.(task);
        }),
      );
    }

    if (task.frontmatter.status === 'inbox') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Mark ready')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onMarkReady(task);
          }),
      );
    }

    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Run')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onRun(task);
          }),
      );
    }

    if (task.frontmatter.status === 'running') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Stop')
          .setWarning()
          .onClick(() => {
            this.close();
            this.callbacks.onStop(task);
          }),
      );
    }

    if (task.frontmatter.status === 'review') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Accept')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onAccept(task);
          }),
      );
      actions.addButton((btn) =>
        btn.setButtonText('Rework').onClick(() => {
          this.close();
          this.callbacks.onRework(task);
        }),
      );
    }

    if (task.frontmatter.status === 'done') {
      actions.addButton((btn) =>
        btn.setButtonText('Reopen').onClick(() => {
          this.close();
          this.callbacks.onReopen(task);
        }),
      );
    }

    if (task.frontmatter.status === 'needs_handoff') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Review')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onSendToReview?.(task);
          }),
      );
      actions.addButton((btn) =>
        btn
          .setButtonText('Mark failed')
          .setWarning()
          .onClick(() => {
            this.close();
            this.callbacks.onMarkFailed?.(task);
          }),
      );
    }

    if (
      task.frontmatter.status === 'done' ||
      task.frontmatter.status === 'failed' ||
      task.frontmatter.status === 'canceled'
    ) {
      actions.addButton((btn) =>
        btn
          .setButtonText('Archive')
          .onClick(() => {
            this.close();
            this.callbacks.onArchive(task);
          }),
      );
    }
  }
}
