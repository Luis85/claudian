import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec, TaskStatus } from '../model/taskTypes';
import type { WorkOrderDetailModalCallbacks } from './WorkOrderDetailModal';

// Footer button visual variant. `ghost` = transparent secondary; `cta` = the
// accent primary; `danger` = the destructive red action. The visual tokens for
// each live in CSS keyed off the modifier class in the modal renderer.
export type FooterActionVariant = 'ghost' | 'cta' | 'danger';

// One sticky-footer action: a real `<button>` with a leading Lucide icon and a
// keyed label. `side` groups the button left (secondary/ghost) or right
// (primary group); `run` is invoked after the modal closes (close-on-click is
// preserved for every action). Actions whose callback is optional/missing are
// filtered out before they are pushed.
export interface FooterAction {
  variant: FooterActionVariant;
  icon: string;
  labelKey: TranslationKey;
  side: 'left' | 'right';
  run: () => void;
}

/**
 * Resolve the footer action list for the current status. Every status gets
 * Open note (ghost, left) and — when a conversation link exists and can be
 * opened — Open conversation (ghost, left). The right-side primary group is
 * status-specific. Statuses the spec does not tabulate fall back to a minimal
 * footer so none renders a dead footer.
 *
 * Behavior-preserving extraction of the modal's former `footerActions` method:
 * control flow, push order, and the per-callback presence guards are identical.
 */
export function footerActionsForStatus(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
): FooterAction[] {
  const { status } = task.frontmatter;
  const actions: FooterAction[] = [];

  // Open note — present on every status.
  actions.push({
    variant: 'ghost',
    icon: 'file-text',
    labelKey: 'tasks.workOrderModal.actionOpenNote',
    side: 'left',
    run: () => callbacks.onOpenNote(task),
  });

  // Open conversation — left ghost, only when the linked conversation exists
  // and can still be opened (mirrors the sidebar Conversation-row guard).
  const canOpenConversation =
    Boolean(task.frontmatter.conversation_id) &&
    Boolean(callbacks.onOpenConversation) &&
    (callbacks.canOpenConversation?.(task) ?? true);

  const addOpenConversation = (): void => {
    if (!canOpenConversation) return;
    actions.push({
      variant: 'ghost',
      icon: 'message-square',
      labelKey: 'tasks.workOrderModal.actionOpenConversation',
      side: 'left',
      run: () => callbacks.onOpenConversation?.(task),
    });
  };

  appendStatusActions(status, task, callbacks, actions, addOpenConversation);

  return actions;
}

// Per-status appenders that push the right-side primary group (and any extra
// left ghost actions) onto `actions`. The ordering and guards match the
// original switch exactly; the table keeps the dispatch flat. Statuses absent
// from the table fall through to the `ready` / `needs_fix` default below
// (Open note + Open conversation only — Run is a board action now).
const STATUS_APPENDERS: Partial<
  Record<
    TaskStatus,
    (
      task: TaskSpec,
      callbacks: WorkOrderDetailModalCallbacks,
      actions: FooterAction[],
      addOpenConversation: () => void,
    ) => void
  >
> = {
  inbox: (task, callbacks, actions) => appendInboxActions(task, callbacks, actions),
  // Live / read-only states: Open conversation + a single Stop danger.
  running: appendLiveActions,
  needs_input: appendLiveActions,
  needs_approval: appendLiveActions,
  review: appendReviewActions,
  needs_handoff: appendNeedsHandoffActions,
  done: (task, callbacks, actions) => appendDoneActions(task, callbacks, actions),
  failed: (task, callbacks, actions) => appendArchiveRightAction(task, callbacks, actions),
  canceled: (task, callbacks, actions) => appendArchiveRightAction(task, callbacks, actions),
};

// Push the status-specific right-side primary group (and any extra left ghost
// actions) onto `actions`.
function appendStatusActions(
  status: TaskStatus,
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
  addOpenConversation: () => void,
): void {
  const appender = STATUS_APPENDERS[status];
  if (appender) {
    appender(task, callbacks, actions, addOpenConversation);
    return;
  }
  // ready / needs_fix (and any future status): Open note + Open conversation
  // only.
  addOpenConversation();
}

function appendInboxActions(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
): void {
  if (callbacks.onMarkReady) {
    actions.push({
      variant: 'cta',
      icon: 'check',
      labelKey: 'tasks.workOrderModal.actionMarkReady',
      side: 'right',
      run: () => callbacks.onMarkReady?.(task),
    });
  }
}

function appendLiveActions(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
  addOpenConversation: () => void,
): void {
  addOpenConversation();
  if (callbacks.onStop) {
    actions.push({
      variant: 'danger',
      icon: 'square',
      labelKey: 'tasks.workOrderModal.actionStop',
      side: 'right',
      run: () => callbacks.onStop?.(task),
    });
  }
}

function appendReviewActions(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
  addOpenConversation: () => void,
): void {
  addOpenConversation();
  if (callbacks.onRework) {
    actions.push({
      variant: 'ghost',
      icon: 'rotate-ccw',
      labelKey: 'tasks.workOrderModal.actionRework',
      side: 'right',
      run: () => callbacks.onRework?.(task),
    });
  }
  if (callbacks.onAccept) {
    actions.push({
      variant: 'cta',
      icon: 'check',
      labelKey: 'tasks.workOrderModal.actionAccept',
      side: 'right',
      run: () => callbacks.onAccept?.(task),
    });
  }
}

function appendNeedsHandoffActions(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
  addOpenConversation: () => void,
): void {
  addOpenConversation();
  if (callbacks.onMarkFailed) {
    actions.push({
      variant: 'danger',
      icon: 'triangle',
      labelKey: 'tasks.workOrderModal.actionMarkFailed',
      side: 'right',
      run: () => callbacks.onMarkFailed?.(task),
    });
  }
  if (callbacks.onSendToReview) {
    actions.push({
      variant: 'cta',
      icon: 'check',
      labelKey: 'tasks.workOrderModal.actionSendToReview',
      side: 'right',
      run: () => callbacks.onSendToReview?.(task),
    });
  }
}

function appendDoneActions(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
): void {
  if (callbacks.onArchive) {
    actions.push({
      variant: 'ghost',
      icon: 'archive',
      labelKey: 'tasks.workOrderModal.actionArchive',
      side: 'left',
      run: () => callbacks.onArchive?.(task),
    });
  }
  if (callbacks.onReopen) {
    actions.push({
      variant: 'ghost',
      icon: 'rotate-ccw',
      labelKey: 'tasks.workOrderModal.actionReopen',
      side: 'right',
      run: () => callbacks.onReopen?.(task),
    });
  }
}

// failed / canceled: a single right-side Archive ghost (when wired).
function appendArchiveRightAction(
  task: TaskSpec,
  callbacks: WorkOrderDetailModalCallbacks,
  actions: FooterAction[],
): void {
  if (callbacks.onArchive) {
    actions.push({
      variant: 'ghost',
      icon: 'archive',
      labelKey: 'tasks.workOrderModal.actionArchive',
      side: 'right',
      run: () => callbacks.onArchive?.(task),
    });
  }
}
