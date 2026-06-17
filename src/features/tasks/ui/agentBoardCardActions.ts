import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec, TaskStatus } from '../model/taskTypes';
import { PortalPopover, type PortalPopoverItem } from './portalPopover';

export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  onMoveToInbox(task: TaskSpec): void;
  onAddWorkOrder(): void;
  onRunNextReady(): void;
  /** Queue skip reason for a card, or null when the card is not skipped. */
  getSkipReason?: (task: TaskSpec) => string | null;
  /** Dismiss a card's queue skip chip. */
  onAckSkip?: (task: TaskSpec) => void;
  onContextMenu(task: TaskSpec, event: MouseEvent): void;
  onToggleLaneCollapse(laneId: string): void;
  onReply?(task: TaskSpec, content: string): void;
  onApprove?(task: TaskSpec): void;
  onReject?(task: TaskSpec, reason: string): void;
  onCancelPaused?(task: TaskSpec): void;
  /** needs_handoff → review: salvage a run that finished without a structured handoff. */
  onSendToReview?(task: TaskSpec): void;
  /** needs_handoff → failed: give up on a run that finished without a structured handoff. */
  onMarkFailed?(task: TaskSpec): void;
  /** ⋯ menu: move a terminal/inbox work order to the archive folder. */
  onArchive(task: TaskSpec): void;
  /** ⋯ menu: open the work-order note in a new tab. */
  onOpenNote(task: TaskSpec): void;
  /** ⋯ menu: open the linked conversation in a new tab. */
  onOpenConversation(task: TaskSpec): void;
  /** Whether the linked conversation still exists; gates "Open conversation". */
  canOpenConversation?(task: TaskSpec): boolean;
}

/**
 * One card action — the per-status primary button or a ⋯ overflow-menu item.
 * `labelKey` resolves through the i18n helper; `icon` is a Lucide glyph;
 * `variant` keys the primary button styling; `danger` marks destructive ⋯ menu
 * items (red). `run` is resolved against the live callbacks at click time.
 */
interface CardAction {
  labelKey: TranslationKey;
  icon: string;
  variant?: 'cta' | 'danger' | 'ghost';
  danger?: boolean;
  run: (callbacks: AgentBoardRenderCallbacks, task: TaskSpec) => void;
  /** When present, the action is only shown if this returns true. */
  available?: (callbacks: AgentBoardRenderCallbacks, task: TaskSpec) => boolean;
}

interface CardActionModel {
  primary: CardAction | null;
  /** Optional labeled button rendered between the primary and the ⋯ menu. */
  secondary?: CardAction;
  menu: CardAction[];
}

// Reusable ⋯ menu items (labels reuse the modal/context-menu keys where they
// already exist; board-only labels live under tasks.board.cardAction.*).
const MENU_OPEN_NOTE: CardAction = {
  labelKey: 'tasks.board.contextMenu.openNote',
  icon: 'file-text',
  run: (cb, task) => cb.onOpenNote(task),
};
const MENU_OPEN_CONVERSATION: CardAction = {
  labelKey: 'tasks.board.contextMenu.openConversation',
  icon: 'message-square',
  run: (cb, task) => cb.onOpenConversation(task),
  // Same guard the detail modal + right-click menu use: a persisted
  // conversation_id whose conversation still resolves.
  available: (cb, task) => Boolean(task.frontmatter.conversation_id) && (cb.canOpenConversation?.(task) ?? true),
};
// Visible "Go to conversation" button (live cards surface it next to Stop rather
// than burying it in the ⋯ menu). Same guard as MENU_OPEN_CONVERSATION: a
// persisted conversation_id whose conversation still resolves.
const GO_TO_CONVERSATION: CardAction = {
  labelKey: 'tasks.board.cardAction.goToConversation',
  icon: 'message-square',
  variant: 'ghost',
  run: (cb, task) => cb.onOpenConversation(task),
  available: (cb, task) => Boolean(task.frontmatter.conversation_id) && (cb.canOpenConversation?.(task) ?? true),
};
const MENU_ARCHIVE: CardAction = {
  labelKey: 'tasks.board.contextMenu.archive',
  icon: 'archive',
  danger: true,
  run: (cb, task) => cb.onArchive(task),
};
const MENU_BACK_TO_INBOX: CardAction = {
  labelKey: 'tasks.board.cardAction.backToInbox',
  icon: 'rotate-ccw',
  run: (cb, task) => cb.onMoveToInbox(task),
};
const MENU_STOP: CardAction = {
  labelKey: 'tasks.workOrderModal.actionStop',
  icon: 'square',
  danger: true,
  run: (cb, task) => cb.onStop(task),
};
const MENU_REWORK: CardAction = {
  labelKey: 'tasks.workOrderModal.actionRework',
  icon: 'rotate-ccw',
  run: (cb, task) => cb.onRework(task),
};
const MENU_MARK_FAILED: CardAction = {
  labelKey: 'tasks.workOrderModal.actionMarkFailed',
  icon: 'triangle',
  danger: true,
  run: (cb, task) => cb.onMarkFailed?.(task),
};

/**
 * Per-status primary action + ⋯ overflow menu (the spec table). `needs_fix`
 * mirrors `ready` and `canceled` mirrors `failed` (both restored from the
 * pre-cluster recovery actions); any status the spec does not tabulate falls
 * back to an Open-note-only menu so every card stays actionable.
 */
const CARD_ACTIONS: Partial<Record<TaskStatus, CardActionModel>> = {
  inbox: {
    primary: { labelKey: 'tasks.workOrderModal.actionMarkReady', icon: 'check', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    // No "Run now": inbox items aren't runnable (must transition to ready first).
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  ready: {
    primary: { labelKey: 'tasks.board.cardAction.run', icon: 'play', variant: 'cta', run: (cb, task) => cb.onRun(task) },
    // No Archive: ready/needs_fix are actionable, not archivable (ARCHIVABLE_STATUSES).
    menu: [MENU_OPEN_NOTE, MENU_BACK_TO_INBOX],
  },
  needs_fix: {
    primary: { labelKey: 'tasks.board.cardAction.run', icon: 'play', variant: 'cta', run: (cb, task) => cb.onRun(task) },
    menu: [MENU_OPEN_NOTE, MENU_BACK_TO_INBOX],
  },
  running: {
    primary: { labelKey: 'tasks.workOrderModal.actionStop', icon: 'square', variant: 'danger', run: (cb, task) => cb.onStop(task) },
    // "Go to conversation" is a visible button on the live card; the ⋯ menu drops
    // the duplicate Open-conversation entry it used to carry.
    secondary: GO_TO_CONVERSATION,
    menu: [MENU_OPEN_NOTE],
  },
  needs_input: {
    primary: null,
    menu: [MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_STOP],
  },
  needs_approval: {
    primary: null,
    menu: [MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_STOP],
  },
  review: {
    primary: { labelKey: 'tasks.workOrderModal.actionAccept', icon: 'check', variant: 'cta', run: (cb, task) => cb.onAccept(task) },
    menu: [MENU_REWORK, MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_BACK_TO_INBOX],
  },
  needs_handoff: {
    primary: { labelKey: 'tasks.workOrderModal.actionSendToReview', icon: 'check', variant: 'cta', run: (cb, task) => cb.onSendToReview?.(task) },
    menu: [MENU_MARK_FAILED, MENU_OPEN_NOTE],
  },
  done: {
    primary: { labelKey: 'tasks.workOrderModal.actionReopen', icon: 'rotate-ccw', variant: 'ghost', run: (cb, task) => cb.onReopen(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  failed: {
    primary: { labelKey: 'tasks.board.cardAction.retry', icon: 'rotate-ccw', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  canceled: {
    primary: { labelKey: 'tasks.board.cardAction.retry', icon: 'rotate-ccw', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
};

const FALLBACK_CARD_ACTIONS: CardActionModel = { primary: null, menu: [MENU_OPEN_NOTE] };

/** Live callbacks escape so each click resolves against current board state. */
export interface AgentBoardCardActionsDeps {
  getCallbacks(): AgentBoardRenderCallbacks | null;
}

/**
 * Owns the per-card hover action cluster (per-status primary button + ⋯ overflow
 * menu) and the single body-portaled overflow popover. Extracted from
 * `AgentBoardRenderer` so the renderer keeps card/lane DOM while this owns the
 * action spec table + popover lifecycle.
 */
export class AgentBoardCardActions {
  // The single open ⋯ overflow popover (only one card menu is open at a time).
  // Tracked so a full re-render or a removed card tears it down — the popover is
  // portaled onto document.body, so it would otherwise leak a detached node and
  // its scroll/resize/click listeners across renders.
  private openPopover: PortalPopover | null = null;

  constructor(private readonly deps: AgentBoardCardActionsDeps) {}

  /** Tear down the open ⋯ overflow popover (portaled on document.body), if any. */
  closePopover(): void {
    this.openPopover?.close();
    this.openPopover = null;
  }

  /**
   * Build the hover action cluster (per-status primary + ⋯) for a card. It
   * reserves no layout width (CSS `position: absolute`), so titles keep their
   * full width; it reveals on card hover/focus, and stays visible on live cards
   * (running / needs_input / needs_approval). `persistent` keys the always-on
   * styling for live cards. Every click routes through the supplied callbacks.
   */
  renderCardActions(card: HTMLElement, task: TaskSpec, persistent: boolean): HTMLElement {
    const model = CARD_ACTIONS[task.frontmatter.status] ?? FALLBACK_CARD_ACTIONS;
    const cluster = card.createDiv({
      cls: `claudian-agent-board-card-actions${persistent ? ' claudian-agent-board-card-actions--persistent' : ''}`,
    });
    // The card opens the detail view on click; keep cluster interactions local.
    cluster.addEventListener('click', (event) => event.stopPropagation());

    if (model.primary) this.renderPrimaryAction(cluster, task, model.primary);
    if (model.secondary) this.renderSecondaryAction(cluster, task, model.secondary);
    this.renderOverflowMenu(cluster, task, model.menu);
    return cluster;
  }

  /**
   * Build the cluster and place it immediately after the title row (its DOM slot
   * on first render). The cluster is `position: absolute`, so order doesn't
   * affect its placement, but keeping the slot stable avoids surprising the
   * `cardRefs` consumers. Used by `patchCard` after removing the stale cluster.
   */
  insertCardActions(
    card: HTMLElement,
    statusDot: HTMLElement,
    task: TaskSpec,
    persistent: boolean,
  ): HTMLElement {
    const cluster = this.renderCardActions(card, task, persistent);
    const titleRow = statusDot.parentElement;
    if (titleRow && titleRow.nextSibling) card.insertBefore(cluster, titleRow.nextSibling);
    return cluster;
  }

  private renderPrimaryAction(cluster: HTMLElement, task: TaskSpec, action: CardAction): void {
    const variant = action.variant ?? 'cta';
    const button = cluster.createEl('button', {
      cls: `claudian-agent-board-card-action-primary claudian-agent-board-card-action-primary--${variant}`,
      attr: { type: 'button' },
    });
    const label = t(action.labelKey);
    const icon = button.createSpan({ cls: 'claudian-agent-board-card-action-icon' });
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-icon', action.icon);
    setIcon(icon, action.icon);
    button.createSpan({ cls: 'claudian-agent-board-card-action-label', text: label });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const callbacks = this.deps.getCallbacks();
      if (callbacks) action.run(callbacks, task);
    });
  }

  /**
   * Labeled secondary button (e.g. "Go to conversation" on running cards). Honors
   * the action's `available` guard at render time so a missing/deleted
   * conversation hides it rather than rendering a dead button; the cluster is
   * rebuilt on every `patchCard`, so the guard re-evaluates as state changes.
   */
  private renderSecondaryAction(cluster: HTMLElement, task: TaskSpec, action: CardAction): void {
    const callbacks = this.deps.getCallbacks();
    if (action.available && !(callbacks != null && action.available(callbacks, task))) return;

    const button = cluster.createEl('button', {
      cls: 'claudian-agent-board-card-action-secondary',
      attr: { type: 'button' },
    });
    const icon = button.createSpan({ cls: 'claudian-agent-board-card-action-icon' });
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-icon', action.icon);
    setIcon(icon, action.icon);
    button.createSpan({ cls: 'claudian-agent-board-card-action-label', text: t(action.labelKey) });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const cb = this.deps.getCallbacks();
      if (cb) action.run(cb, task);
    });
  }

  private renderOverflowMenu(cluster: HTMLElement, task: TaskSpec, menu: CardAction[]): void {
    const trigger = cluster.createEl('button', {
      cls: 'claudian-agent-board-card-action-more',
      attr: { type: 'button', 'aria-label': t('tasks.board.cardAction.moreActions'), 'aria-haspopup': 'menu' },
    });
    const glyph = trigger.createSpan({ cls: 'claudian-agent-board-card-action-icon' });
    glyph.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('data-icon', 'more-horizontal');
    setIcon(glyph, 'more-horizontal');

    // The hover cluster hides on mouseleave (it shows on card :hover/:focus-within);
    // keep it visible while THIS card's ⋯ menu is open so the trigger isn't
    // orphaned when the pointer moves onto the (body-portaled) menu.
    const card = cluster.closest('.claudian-agent-board-card') as HTMLElement | null;

    const popover = new PortalPopover({
      trigger,
      // Built lazily on each open so guards (canOpenConversation, etc.)
      // re-evaluate against current state, not the render-time snapshot.
      items: (): PortalPopoverItem[] => {
        const cb = this.deps.getCallbacks();
        return menu
          .filter((action) => !action.available || (cb != null && action.available(cb, task)))
          .map((action) => ({
            label: t(action.labelKey),
            icon: action.icon,
            danger: action.danger,
            run: () => {
              const callbacks = this.deps.getCallbacks();
              if (callbacks) action.run(callbacks, task);
            },
          }));
      },
      menuClass: 'claudian-agent-board-card-menu',
      itemClass: 'claudian-agent-board-card-menu-item',
      itemIconClass: 'claudian-agent-board-card-menu-item-icon',
      itemDangerClass: 'claudian-agent-board-card-menu-item--danger',
      upClass: 'claudian-agent-board-card-menu--up',
      onClose: () => card?.removeClass('is-menu-open'),
    });

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      // Toggle: a second click on an already-open menu (this trigger's) closes it.
      if (popover.isOpen()) {
        this.closePopover();
        return;
      }
      // Only one card menu is open at a time — close any other before opening.
      this.closePopover();
      this.openPopover = popover;
      card?.addClass('is-menu-open');
      popover.open();
    });
  }
}
