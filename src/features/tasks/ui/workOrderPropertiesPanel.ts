import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { formatDateTime } from '../../../utils/date';
import { renderAgentAvatar } from '../../agents/agentAvatar';
import { resolvePersona } from '../../agents/personaRegistry';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderEditableValueChip } from './editableValueChip';
// Type-only import (no runtime edge — mirrors workOrderFooterActions.ts) so the
// panel can reference the modal's callback contract without an import cycle.
import type { WorkOrderDetailModalCallbacks } from './WorkOrderDetailModal';

const PRIORITY_OPTIONS: TaskPriority[] = ['0 - urgent', '1 - high', '2 - normal', '3 - low'];

// Statuses where the Agent assignee can still be changed. Every other status
// (running + terminal/review states) renders the assignee as a static avatar +
// name. Mirrors the editable-title set per the persona-seam spec.
const EDITABLE_AGENT_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'inbox',
  'ready',
  'needs_fix',
]);

// Avatar diameter (px) for the modal Agent property value.
const AGENT_AVATAR_SIZE = 18;

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

/**
 * Renders the work-order detail modal's properties sidebar (status pill, editable
 * agent/provider/model/priority chips, created/updated/attempts, and the linked
 * conversation link). Extracted from `WorkOrderDetailModal` so the modal keeps
 * its shell + body sections while this owns the properties panel DOM.
 */
export function renderWorkOrderProperties(
  parent: HTMLElement,
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
): void {
  const fm = task.frontmatter;
  const editable = fm.status !== 'running';

  const panel = parent.createDiv({ cls: 'claudian-work-order-modal-properties' });
  panel.createDiv({
    cls: 'claudian-work-order-modal-properties-head',
    text: t('tasks.workOrderModal.properties'),
  });

  // Status — always a colored pill.
  const statusValue = addPropertyRow(panel, 'status', 'circle-dot', t('tasks.workOrderModal.fieldStatus')).value;
  renderStatusPill(statusValue, fm.status);

  // Agent — assignee persona. Editable states get a persona picker (avatar in
  // the value chip); every other status shows a static avatar + name.
  const agentValue = addPropertyRow(panel, 'agent', 'user', t('tasks.workOrderModal.fieldAgent')).value;
  renderAgentRow(agentValue, fm.agent, EDITABLE_AGENT_STATUSES.has(fm.status), task, callbacks);

  // Provider / Model — chips when editable; Provider change resets Model.
  const providerValue = addPropertyRow(panel, 'provider', 'cpu', t('tasks.workOrderModal.fieldProvider')).value;
  const modelValue = addPropertyRow(panel, 'model', 'sparkles', t('tasks.workOrderModal.fieldModel')).value;
  if (editable) {
    const modelChip = renderEditableValueChip({
      parent: modelValue,
      value: fm.model ?? '',
      options: callbacks.getModelOptions(fm.provider ?? ''),
      emptyOption: { value: '', label: 'Provider default' },
      onChange: (value) => void callbacks.onSaveFields?.(task, { model: value }),
    });
    renderEditableValueChip({
      parent: providerValue,
      value: fm.provider ?? '',
      options: callbacks.getProviderOptions(),
      onChange: (value) => {
        void callbacks.onSaveFields?.(task, { provider: value, model: '' });
        modelChip.setOptions({
          value: '',
          options: callbacks.getModelOptions(value),
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
  const priorityValue = addPropertyRow(panel, 'priority', 'signal', t('tasks.workOrderModal.fieldPriority')).value;
  if (editable) {
    renderEditableValueChip({
      parent: priorityValue,
      value: fm.priority,
      options: PRIORITY_OPTIONS.map((p) => ({ value: p, label: p })),
      onChange: (value) => void callbacks.onSaveFields?.(task, { priority: value as TaskPriority }),
    });
  } else {
    renderPriorityBars(priorityValue, fm.priority);
  }

  panel.createDiv({ cls: 'claudian-work-order-modal-properties-divider' });

  addPropertyRow(panel, 'created', 'calendar', t('tasks.workOrderModal.fieldCreated')).value.createSpan({
    cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
    text: formatDateTime(fm.created),
  });
  addPropertyRow(panel, 'updated', 'clock', t('tasks.workOrderModal.fieldUpdated')).value.createSpan({
    cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
    text: formatDateTime(fm.updated),
  });
  addPropertyRow(panel, 'attempts', 'repeat', t('tasks.workOrderModal.fieldAttempts')).value.createSpan({
    cls: 'claudian-work-order-modal-prop-inner claudian-work-order-modal-prop-num',
    text: String(fm.attempts),
  });

  if (
    fm.conversation_id &&
    callbacks.onOpenConversation &&
    (callbacks.canOpenConversation?.(task) ?? true)
  ) {
    const convValue = addPropertyRow(
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
      callbacks.onOpenConversation?.(task);
    });
  }
}

/**
 * Agent assignee value. Both presentations resolve the persona from the
 * stored `agent` id through `resolvePersona` (absent / unknown → Standard).
 * Editable states render the shared editable value chip (so the picker stays
 * keyboard-operable and visually matches Provider / Model / Priority) with the
 * resolved persona avatar prepended into the chip; selection persists through
 * `onSaveFields`. Non-editable states render a static avatar + persona name.
 *
 * When the stored id is a `roster:` id the chip shows the label supplied by
 * `getAgentOptions()` ("Agent: <name>"); the avatar comes from the preloaded
 * `callbacks.resolvePersona` (roster agent color + initials), falling back to
 * Standard only when no resolver is supplied.
 */
function renderAgentRow(
  parent: HTMLElement,
  agentId: string | undefined,
  editable: boolean,
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
): void {
  const resolve = callbacks.resolvePersona ?? resolvePersona;
  const persona = resolve(agentId);

  if (!editable) {
    const wrap = parent.createSpan({ cls: 'claudian-work-order-modal-agent' });
    renderAgentAvatar(wrap, persona, AGENT_AVATAR_SIZE);
    // For roster ids the label comes from getAgentOptions(); fall back to persona name.
    const isRosterId = agentId?.startsWith('roster:') ?? false;
    const rosterLabel = isRosterId
      ? callbacks.getAgentOptions().find((o) => o.value === agentId)?.label
      : undefined;
    wrap.createSpan({ cls: 'claudian-work-order-modal-agent-name', text: rosterLabel ?? persona.name });
    return;
  }

  const agentOptions = callbacks.getAgentOptions();
  // The currently selected value: prefer the raw agentId when it exists in options
  // (covers roster ids like "roster:foo") so the chip shows the right entry.
  const selectedValue = agentOptions.some((o) => o.value === agentId) ? (agentId ?? persona.id) : persona.id;
  const chip = renderEditableValueChip({
    parent,
    value: selectedValue,
    options: agentOptions,
    onChange: (value) => void callbacks.onSaveFields?.(task, { agent: value }),
  });

  // Lead the chip with the selected persona's avatar (kept in sync on change).
  // Roster ids fall back to Standard persona avatar — no custom avatar in picker.
  chip.el.addClass('claudian-work-order-modal-chip--agent');
  let avatar = renderAgentAvatar(chip.el, persona, AGENT_AVATAR_SIZE);
  chip.el.insertBefore(avatar, chip.el.firstChild);
  chip.selectEl.addEventListener('change', () => {
    const next = resolve(chip.selectEl.value);
    const replacement = renderAgentAvatar(chip.el, next, AGENT_AVATAR_SIZE);
    chip.el.insertBefore(replacement, chip.el.firstChild);
    avatar.remove();
    avatar = replacement;
  });
}

function addPropertyRow(
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

function renderStatusPill(parent: HTMLElement, status: TaskStatus): void {
  const pill = parent.createSpan({
    cls: `claudian-work-order-modal-status-pill claudian-work-order-modal-status-pill--${status}`,
  });
  // Tooltip carries the status name on hover (parity with the ID chip + the
  // assignee avatar); the inner dot stays decorative (color is the inner cue,
  // the label text is the non-color cue).
  pill.setAttr('title', status);
  pill.createSpan({ cls: 'claudian-work-order-modal-status-dot' });
  pill.createSpan({ cls: 'claudian-work-order-modal-status-label', text: status });
}

function renderPriorityBars(parent: HTMLElement, priority: TaskPriority): void {
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
