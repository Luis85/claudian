import { Menu, Notice, setIcon } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { renderMessageActionButton, wireCopyButton } from './messageActionButtons';
import { eligibleMessageActions } from './messageActions';

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

/**
 * Escapes the action bar reads from the owning {@link MessageRenderer}: the
 * plugin (registered actions + active conversation), live capability flags,
 * the rewind/fork callbacks, and the message-element / live-element lookups
 * that stay owned by the renderer's message lifecycle.
 */
export interface MessageActionBarDeps {
  readonly plugin: ClaudianPlugin;
  getCapabilities(): ProviderCapabilities;
  rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  forkCallback?: (messageId: string) => Promise<void>;
  isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean;
  getMessageEl(messageId: string): HTMLElement | null;
  getLiveMessageEl(messageId: string): HTMLElement | undefined;
  deleteLiveMessageEl(messageId: string): void;
}

/**
 * Builds the per-message action affordances — text/user copy buttons, the
 * registered message actions (e.g. Create work order), and the rewind/fork
 * hover buttons + rewind menu. Extracted from `MessageRenderer` so the
 * orchestrator keeps message lifecycle while this owns the toolbar DOM/wiring.
 */
export class MessageActionBar {
  constructor(private readonly deps: MessageActionBarDeps) {}

  /**
   * Adds a copy button to a text block.
   * Button shows clipboard icon on hover, changes to "copied!" on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'claudian-text-copy-btn' });
    wireCopyButton(copyBtn, () => markdown);
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.userMessageId) return;
    if (!this.deps.isRewindEligible(allMessages, index)) return;
    const msgEl = this.deps.getLiveMessageEl(msg.id);
    if (!msgEl) return;

    if (this.deps.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (this.deps.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }
    this.cleanupLiveMessageEl(msg.id, msgEl);
  }

  private cleanupLiveMessageEl(msgId: string, msgEl: HTMLElement): void {
    const needsRewind = this.deps.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn');
    const needsFork = this.deps.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.deps.deleteLiveMessageEl(msgId);
    }
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({ cls: 'claudian-user-msg-actions' });
  }

  addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const copyBtn = toolbar.createSpan({ cls: 'claudian-user-msg-copy-btn' });
    copyBtn.setAttribute('aria-label', 'Copy message');
    wireCopyButton(copyBtn, () => content);
  }

  /** Adds registered message actions (e.g. Create work order) to a completed agent message. */
  refreshMessageActions(msg: ChatMessage): void {
    const msgEl = this.deps.getMessageEl(msg.id);
    if (!msgEl) return;
    this.addAssistantMessageActions(msgEl, msg);
  }

  addRegisteredMessageActions(msgEl: HTMLElement, msg: ChatMessage): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    toolbar.querySelectorAll('.claudian-user-msg-action-btn').forEach((el) => el.remove());

    for (const action of eligibleMessageActions(this.deps.plugin.chatMessageActions, msg)) {
      renderMessageActionButton(toolbar, action, 'claudian-user-msg-action-btn', () => {
        action.run(msg, this.deps.plugin.getActiveConversationSnapshot()?.id ?? null);
      });
    }
  }

  /**
   * Renders registered message actions (e.g. Create work order) on an agent message,
   * inline beside the last text block's copy button so they share its hover affordance.
   */
  addAssistantMessageActions(msgEl: HTMLElement, msg: ChatMessage): void {
    msgEl.querySelector('.claudian-text-actions')?.remove();

    const actions = eligibleMessageActions(this.deps.plugin.chatMessageActions, msg);
    if (actions.length === 0) return;

    const textBlocks = msgEl.querySelectorAll('.claudian-text-block');
    // A protocol-card-only assistant message (handoff / progress / needs_input /
    // needs_approval) renders with no text block; fall back to the last
    // protocol card so actions stay reachable in work-order tabs.
    const protocolCardSelectors = [
      '.claudian-work-order-handoff-card',
      '.claudian-work-order-needs-approval-card',
      '.claudian-work-order-needs-input-card',
      '.claudian-work-order-progress-card',
    ];
    let cardAnchor: HTMLElement | null = null;
    for (const selector of protocolCardSelectors) {
      const matches = msgEl.querySelectorAll<HTMLElement>(selector);
      if (matches.length > 0) {
        cardAnchor = matches[matches.length - 1] as HTMLElement;
        break;
      }
    }
    const anchorEl = textBlocks.length > 0
      ? (textBlocks[textBlocks.length - 1] as HTMLElement)
      : cardAnchor;
    if (!anchorEl) return;

    const container = anchorEl.createDiv({ cls: 'claudian-text-actions' });
    for (const action of actions) {
      renderMessageActionButton(container, action, 'claudian-text-action-btn', () => {
        action.run(msg, this.deps.plugin.getActiveConversationSnapshot()?.id ?? null);
      });
    }
  }

  addRewindButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.deps.getCapabilities().supportsRewind) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-rewind-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'rotate-ccw');
    btn.setAttribute('aria-label', t('chat.rewind.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRewindMenu(e, messageId);
    });
  }

  private showRewindMenu(event: MouseEvent, messageId: string): void {
    const menu = new Menu();
    this.addRewindMenuItem(menu, messageId, 'conversation');
    this.addRewindMenuItem(menu, messageId, 'code-and-conversation');
    menu.showAtMouseEvent(event);
  }

  private addRewindMenuItem(menu: Menu, messageId: string, mode: ChatRewindMode): void {
    menu.addItem((item) => {
      item
        .setTitle(
          mode === 'conversation'
            ? t('chat.rewind.menuConversationOnly')
            : t('chat.rewind.menuCodeAndConversation')
        )
        .setIcon(mode === 'conversation' ? 'message-square' : 'rotate-ccw')
        .onClick(() => {
          runRendererAction(async () => {
            try {
              await this.deps.rewindCallback?.(messageId, mode);
            } catch (err) {
              new Notice(t('chat.rewind.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
            }
          });
        });
    });
  }

  addForkButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.deps.getCapabilities().supportsFork) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-fork-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'git-fork');
    btn.setAttribute('aria-label', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.deps.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
    });
  }
}
