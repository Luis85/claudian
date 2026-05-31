import { Notice, setIcon } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from '../../../core/runtime/QueuedTurn';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';

/** Snapshot pushed when a steered turn is accepted, so the host can reconcile provider message boundaries. */
export interface SteerCommittedMessage {
  displayContent: string;
  persistedContent?: string;
  currentNote?: string;
  images?: ChatMessage['images'];
}

/**
 * Dependencies the queue/steer state machine needs from its host (InputController).
 * Kept explicit so the controller is testable in isolation; `state` is the same
 * shared `ChatState` instance the host holds — single source of truth for queue state.
 */
export interface QueuedMessageControllerDeps {
  state: ChatState;
  getAgentService: () => ChatRuntime | null;
  getActiveCapabilities: () => ProviderCapabilities;
  getInputEl: () => HTMLTextAreaElement;
  getImageContextManager: () => ImageContextManager | null;
  getFileContextManager: () => FileContextManager | null;
  resetInputHeight: () => void;
  /** Re-enter the host's send path with the dequeued snapshot. */
  requestSend: (options: {
    content: string;
    images?: ChatMessage['images'];
    turnRequestOverride: ChatTurnRequest;
  }) => void;
  /** Record a committed steered turn against the host's provider-message-boundary bookkeeping. */
  onSteerCommitted: (message: SteerCommittedMessage) => void;
}

/**
 * Owns the queued-message / steering state machine extracted from InputController.
 *
 * Concurrency semantics are behavior-preserving: the `steerInFlight` guard, the
 * merge-vs-replace logic in `mergeQueuedMessages`/`mergePendingMessages`, the
 * `cancelRequested || !pendingSteerMessage` re-check after the async `steer`, and
 * `restoreQueuedMessageAfterSteerFailure` must not change — a subtle change here
 * loses or duplicates user messages.
 */
export class QueuedMessageController {
  private steerInFlight = false;
  private pendingSteerMessage: QueuedMessage | null = null;

  constructor(private readonly deps: QueuedMessageControllerDeps) {}

  updateQueueIndicator(): void {
    const { state } = this.deps;
    const indicatorEl = state.queueIndicatorEl;
    if (!indicatorEl) return;

    indicatorEl.empty();

    const visibleQueuedMessage = state.queuedMessage ?? this.pendingSteerMessage;
    if (visibleQueuedMessage) {
      const isPendingSteerOnly = !state.queuedMessage && !!this.pendingSteerMessage;
      indicatorEl.createSpan({
        cls: 'claudian-queue-indicator-text',
        text: `${isPendingSteerOnly ? '⌙ Steering: ' : '⌙ Queued: '}${this.getQueuedMessageDisplay(visibleQueuedMessage)}`,
      });

      if (state.queuedMessage) {
        const actionsEl = indicatorEl.createDiv({ cls: 'claudian-queue-indicator-actions' });

        if (this.canSteerQueuedMessage()) {
          const steerButton = actionsEl.createEl('button', {
            cls: 'claudian-queue-indicator-action',
            text: this.steerInFlight ? 'Steering...' : 'Steer Now',
          });
          steerButton.setAttribute('type', 'button');
          if (this.steerInFlight) {
            steerButton.setAttribute('disabled', 'true');
          } else {
            steerButton.addEventListener('click', (event) => {
              event.stopPropagation();
              void this.steerQueuedMessage();
            });
          }
        }

        const editButton = this.createQueueIconButton(
          actionsEl,
          'pencil',
          'Edit queued message',
        );
        editButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.withdrawQueuedMessageToComposer();
        });

        const discardButton = this.createQueueIconButton(
          actionsEl,
          'trash-2',
          'Discard queued message',
        );
        discardButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.clearQueuedMessage();
        });
      }

      indicatorEl.addClass('claudian-visible-flex');
      indicatorEl.removeClass('claudian-hidden');
      return;
    }

    indicatorEl.removeClass('claudian-visible-flex');
    indicatorEl.addClass('claudian-hidden');
  }

  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  withdrawQueuedMessageToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    if (!message) return;

    const { content, images } = message;
    const inputEl = this.deps.getInputEl();
    const currentContent = options.mergeWithComposer ? inputEl.value.trim() : '';
    inputEl.value = currentContent
      ? appendMarkdownSnippet(content, currentContent)
      : content;

    const imageContextManager = this.deps.getImageContextManager();
    const currentImages = options.mergeWithComposer
      ? (imageContextManager?.getAttachedImages() ?? [])
      : [];
    const restoredImages = [...(images ?? []), ...currentImages];
    if (restoredImages.length > 0) {
      imageContextManager?.setImages(restoredImages);
    }
    this.deps.resetInputHeight();
    inputEl.focus();
  }

  restorePendingMessagesToInput(): void {
    const { state } = this.deps;
    const combinedMessage = this.mergePendingMessages(
      this.pendingSteerMessage,
      state.queuedMessage,
    );
    this.restoreMessageToInput(combinedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.clearPendingSteerState();
    this.updateQueueIndicator();
  }

  processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateQueueIndicator();

    window.setTimeout(
      () => {
        this.deps.requestSend({
          content: queuedMessage.content,
          images: queuedMessage.images,
          turnRequestOverride: this.toQueuedChatTurn(queuedMessage).request,
        });
      },
      0
    );
  }

  private getQueuedMessageDisplay(message: QueuedMessage | null): string {
    if (!message) {
      return '';
    }

    const rawContent = message.content.trim();
    const preview = rawContent.length > 40
      ? rawContent.slice(0, 40) + '...'
      : rawContent;
    const hasImages = (message.images?.length ?? 0) > 0;

    if (hasImages) {
      return preview ? `${preview} [images]` : '[images]';
    }

    return preview;
  }

  private createQueueIconButton(
    parentEl: HTMLElement,
    icon: string,
    label: string,
  ): HTMLElement {
    const button = parentEl.createEl('button', {
      cls: 'claudian-queue-indicator-icon-action',
      attr: {
        'aria-label': label,
        title: label,
        type: 'button',
      },
    });
    setIcon(button, icon);
    return button;
  }

  private canSteerQueuedMessage(): boolean {
    const agentService = this.deps.getAgentService();
    return this.deps.state.isStreaming
      && this.deps.getActiveCapabilities().supportsTurnSteer === true
      && typeof agentService?.steer === 'function';
  }

  private cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
      ...message,
      images: message.images ? [...message.images] : undefined,
      turnRequest: message.turnRequest
        ? cloneChatTurnRequest(message.turnRequest)
        : undefined,
    };
  }

  createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      content: displayContent,
      images: request.images,
      editorContext: request.editorSelection ?? null,
      browserContext: request.browserSelection ?? null,
      canvasContext: request.canvasSelection ?? null,
      turnRequest: request,
    };
  }

  private toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
    if (message.turnRequest) {
      return {
        displayContent: message.content,
        request: cloneChatTurnRequest(message.turnRequest),
      };
    }

    return {
      displayContent: message.content,
      request: {
        text: message.content,
        images: message.images ? [...message.images] : undefined,
        editorSelection: message.editorContext,
        browserSelection: message.browserContext ?? null,
        canvasSelection: message.canvasContext,
      },
    };
  }

  private mergePendingMessages(
    first: QueuedMessage | null,
    second: QueuedMessage | null,
  ): QueuedMessage | null {
    if (first && second) {
      return this.mergeQueuedMessages(first, second);
    }

    if (first) {
      return this.cloneQueuedMessage(first);
    }

    if (second) {
      return this.cloneQueuedMessage(second);
    }

    return null;
  }

  clearPendingSteerState(): void {
    this.pendingSteerMessage = null;
    this.steerInFlight = false;
  }

  restorePendingSteerMessageToQueue(): void {
    if (!this.pendingSteerMessage) {
      return;
    }

    const { state } = this.deps;
    const pendingSteerMessage = this.cloneQueuedMessage(this.pendingSteerMessage);
    this.clearPendingSteerState();
    state.queuedMessage = state.queuedMessage
      ? this.mergeQueuedMessages(pendingSteerMessage, state.queuedMessage)
      : pendingSteerMessage;
    this.updateQueueIndicator();
  }

  mergeQueuedMessages(
    existing: QueuedMessage | null,
    incoming: QueuedMessage,
  ): QueuedMessage {
    if (!existing) {
      return this.cloneQueuedMessage(incoming);
    }

    const mergedTurn = mergeQueuedChatTurns(
      this.toQueuedChatTurn(existing),
      this.toQueuedChatTurn(incoming),
    );
    return this.createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
  }

  private async steerQueuedMessage(): Promise<void> {
    if (this.steerInFlight) {
      return;
    }

    const { state } = this.deps;
    const agentService = this.deps.getAgentService();
    if (!state.queuedMessage || !this.canSteerQueuedMessage() || !agentService?.steer) {
      return;
    }

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.updateQueueIndicator();

    try {
      const { displayContent, request } = this.toQueuedChatTurn(queuedMessage);

      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.steer(preparedTurn);
      if (state.cancelRequested || !this.pendingSteerMessage) {
        return;
      }
      if (!accepted) {
        this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
        return;
      }

      this.deps.getFileContextManager()?.markCurrentNoteSent();
      // Pill mentions were folded into the prepared turn above; clear them so they
      // don't linger in the composer after the steered message is committed.
      this.deps.getFileContextManager()?.clearAttachedPills();

      this.deps.onSteerCommitted({
        displayContent,
        persistedContent: preparedTurn.persistedContent,
        currentNote: preparedTurn.isCompact
          ? undefined
          : preparedTurn.request.currentNotePath,
        images: request.images,
      });
    } catch {
      this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      new Notice(t('chat.queue.steerFailed'));
    }
  }

  private restoreQueuedMessageAfterSteerFailure(
    message: QueuedMessage,
  ): void {
    const { state } = this.deps;
    this.clearPendingSteerState();
    if (state.cancelRequested) {
      this.updateQueueIndicator();
      return;
    }

    if (state.isStreaming) {
      state.queuedMessage = state.queuedMessage
        ? this.mergeQueuedMessages(message, state.queuedMessage)
        : message;
      this.updateQueueIndicator();
      return;
    }

    this.restoreMessageToInput(message, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }
}
