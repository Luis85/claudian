import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec } from '../model/taskTypes';
import { renderSectionHeader } from './sectionHeader';

/**
 * Editable work-order body sections collected from the detail modal's inline
 * edit form. Mirrors `WriteSectionsOptions` in `TaskNoteStore` so the modal can
 * hand the update straight to the note store. Each provided value replaces the
 * body under the matching `## Heading`.
 */
export interface WorkOrderSectionUpdate {
  objective?: string;
  acceptanceCriteria?: string;
  context?: string;
  constraints?: string;
}

export interface WorkOrderEditFormCallbacks {
  /** Persist the collected section bodies (Save). */
  onSave(sections: WorkOrderSectionUpdate): void | Promise<void>;
  /** Discard the in-progress edit and return to the rendered view (Cancel). */
  onCancel(): void;
}

interface FieldSpec {
  key: keyof WorkOrderSectionUpdate;
  icon: string;
  labelKey: TranslationKey;
  placeholderKey: TranslationKey;
}

// The four editable body sections, in the same order they read top-to-bottom in
// the work-order note. Icons match the read-only section headers so the form
// reads as the same document, just editable.
const FIELD_SPECS: readonly FieldSpec[] = [
  {
    key: 'objective',
    icon: 'target',
    labelKey: 'tasks.workOrderModal.sectionObjective',
    placeholderKey: 'tasks.workOrderModal.editObjectivePlaceholder',
  },
  {
    key: 'acceptanceCriteria',
    icon: 'list-checks',
    labelKey: 'tasks.workOrderModal.sectionAcceptance',
    placeholderKey: 'tasks.workOrderModal.editAcceptancePlaceholder',
  },
  {
    key: 'context',
    icon: 'link',
    labelKey: 'tasks.workOrderModal.sectionContext',
    placeholderKey: 'tasks.workOrderModal.editContextPlaceholder',
  },
  {
    key: 'constraints',
    icon: 'shield',
    labelKey: 'tasks.workOrderModal.sectionConstraints',
    placeholderKey: 'tasks.workOrderModal.editConstraintsPlaceholder',
  },
];

/**
 * Renders the work-order detail modal's inline edit form: one raw-markdown
 * textarea per editable body section (Objective, Acceptance Criteria, Context,
 * Constraints) seeded from the task, plus Cancel / Save actions. Save collects
 * every textarea value (so a cleared field persists as an empty section) and
 * routes it through `onSave`; Cancel discards via `onCancel`. The modal owns the
 * edit-vs-view toggle and re-renders the main pane when either fires.
 */
export function renderWorkOrderEditForm(
  parent: HTMLElement,
  task: TaskSpec,
  callbacks: WorkOrderEditFormCallbacks,
): void {
  const form = parent.createDiv({ cls: 'specorator-work-order-modal-edit-form' });

  const textareas = FIELD_SPECS.map((spec) => {
    const { section } = renderSectionHeader(form, { icon: spec.icon, label: t(spec.labelKey) });
    const textarea = section.createEl('textarea', {
      cls: 'specorator-work-order-modal-edit-textarea',
      attr: { placeholder: t(spec.placeholderKey), spellcheck: 'false' },
    });
    textarea.value = task.sections[spec.key] ?? '';
    return { key: spec.key, textarea };
  });

  const actions = form.createDiv({ cls: 'specorator-work-order-modal-edit-actions' });
  renderActionButton(actions, {
    variant: 'ghost',
    icon: 'x',
    labelKey: 'tasks.workOrderModal.actionCancelEdit',
    onClick: () => callbacks.onCancel(),
  });
  renderActionButton(actions, {
    variant: 'cta',
    icon: 'check',
    labelKey: 'tasks.workOrderModal.actionSaveSections',
    onClick: () => {
      const update: WorkOrderSectionUpdate = {};
      for (const field of textareas) update[field.key] = field.textarea.value;
      void callbacks.onSave(update);
    },
  });
}

interface ActionButtonSpec {
  variant: 'cta' | 'ghost';
  icon: string;
  labelKey: TranslationKey;
  onClick(): void;
}

function renderActionButton(parent: HTMLElement, spec: ActionButtonSpec): void {
  const button = parent.createEl('button', {
    cls: `specorator-work-order-modal-action specorator-work-order-modal-action--${spec.variant}`,
    attr: { type: 'button' },
  });
  const icon = button.createSpan({ cls: 'specorator-work-order-modal-action-icon' });
  icon.setAttr('aria-hidden', 'true');
  icon.setAttr('data-icon', spec.icon);
  setIcon(icon, spec.icon);
  button.createSpan({ cls: 'specorator-work-order-modal-action-label', text: t(spec.labelKey) });
  button.addEventListener('click', () => spec.onClick());
}
