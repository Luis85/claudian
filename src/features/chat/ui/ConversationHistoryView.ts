import { Menu, Notice, setIcon } from 'obsidian';

import type { TitleGenerationService } from '../../../core/providers/types';
import type { ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import type { ChatState } from '../state/ChatState';

function runConversationAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

/**
 * Conversations mounted per history-dropdown chunk. Like the message-list window
 * (PERF-2), this bounds DOM nodes + per-row listeners to O(window) instead of
 * O(conversation count); older conversations mount on demand via "Show more".
 */
const HISTORY_RENDER_WINDOW_SIZE = 50;

export type HistoryConversationOpenState = 'closed' | 'open' | 'current';

export type HistoryRenderOptions = {
  onSelectConversation: (id: string) => Promise<void>;
  onOpenConversationInNewTab?: (id: string, activate?: boolean) => Promise<void>;
  getConversationOpenState?: (id: string) => HistoryConversationOpenState;
  onRerender: () => void;
};

export interface ConversationHistoryViewDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  getHistoryDropdown: () => HTMLElement | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  /** Switch the active tab to a conversation — wired to `ConversationController.switchTo`. */
  onSelectConversation: (id: string) => Promise<void>;
  /** Reload the active conversation after the current one is deleted — wired to `loadActive`. */
  onReloadAfterActiveDelete: () => Promise<void>;
}

/**
 * Renders the conversation history dropdown and owns its per-row interactions
 * (select, open-in-new-tab, context menu, rename, delete, title regeneration,
 * and "show more" windowing). Extracted from `ConversationController` so the
 * controller keeps its documented job — session switching, history reload,
 * save, and rewind — while this view owns the list presentation. The two
 * actions that escape the list back to session lifecycle (switch / reload after
 * deleting the active conversation) arrive as `deps` callbacks.
 */
export class ConversationHistoryView {
  private deps: ConversationHistoryViewDeps;

  constructor(deps: ConversationHistoryViewDeps) {
    this.deps = deps;
  }

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.deps.onSelectConversation(id),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders history dropdown items to a container.
   * Shared implementation for updateHistoryDropdown() and renderHistoryDropdown().
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: HistoryRenderOptions
  ): void {
    const { plugin } = this.deps;

    container.empty();

    const dropdownHeader = container.createDiv({ cls: 'claudian-history-header' });
    dropdownHeader.createSpan({ text: 'Conversations' });

    const list = container.createDiv({ cls: 'claudian-history-list' });
    const allConversations = plugin.getConversationList();

    if (allConversations.length === 0) {
      list.createDiv({ cls: 'claudian-history-empty', text: 'No conversations' });
      return;
    }

    // Sort by lastResponseAt (fallback to createdAt) descending
    const conversations = [...allConversations].sort((a, b) => {
      return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
    });

    // Windowing hides everything past the first chunk behind "Show more". If the
    // active conversation is older than that cut (e.g. an old thread was just
    // reopened without a new response), pin it to the top so its "Current
    // session" row stays visible; otherwise recency order is untouched.
    const currentId = this.deps.state.currentConversationId;
    if (currentId) {
      const currentIdx = conversations.findIndex((c) => c.id === currentId);
      if (currentIdx >= HISTORY_RENDER_WINDOW_SIZE) {
        const [current] = conversations.splice(currentIdx, 1);
        conversations.unshift(current);
      }
    }

    // Window the list: mount only a trailing chunk and reveal older
    // conversations on demand, bounding DOM/listeners to O(window). Items stay
    // direct children of the list; the "show more" control is moved to the end
    // after each chunk so it always trails the revealed rows.
    let rendered = 0;
    const renderChunk = () => {
      const next = Math.min(rendered + HISTORY_RENDER_WINDOW_SIZE, conversations.length);
      for (let i = rendered; i < next; i++) {
        this.renderHistoryItem(list, conversations[i], options);
      }
      rendered = next;
    };

    renderChunk();

    if (rendered < conversations.length) {
      const showMore = list.createDiv({ cls: 'claudian-history-show-more' });
      const btn = showMore.createEl('button', {
        cls: 'claudian-history-show-more-btn',
        text: t('chat.history.showMore'),
        attr: { type: 'button' },
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderChunk();
        if (rendered < conversations.length) {
          // Re-append to keep the control after the freshly revealed rows.
          list.appendChild(showMore);
        } else {
          showMore.remove();
        }
      });
    }
  }

  private renderHistoryItem(
    list: HTMLElement,
    conv: ConversationMeta,
    options: HistoryRenderOptions,
  ): void {
    const { state } = this.deps;
    const isCurrent = conv.id === state.currentConversationId;
    const item = list.createDiv({
      cls: `claudian-history-item${isCurrent ? ' active' : ''}`,
    });

    const iconEl = item.createDiv({ cls: 'claudian-history-item-icon' });
    setIcon(iconEl, isCurrent ? 'message-square-dot' : 'message-square');

    const content = item.createDiv({ cls: 'claudian-history-item-content' });
    const titleEl = content.createDiv({ cls: 'claudian-history-item-title', text: conv.title });
    titleEl.setAttribute('title', conv.title);
    content.createDiv({
      cls: 'claudian-history-item-date',
      text: isCurrent ? 'Current session' : this.formatDate(conv.lastResponseAt ?? conv.createdAt),
    });

    if (!isCurrent) {
      content.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isHistoryNewTabModifierClick(e) && options.onOpenConversationInNewTab) {
          e.preventDefault();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.history.loadFailed'),
            ),
            t('chat.history.loadFailed'),
          );
          return;
        }

        runConversationAction(
          () => this.runHistoryAction(
            () => options.onSelectConversation(conv.id),
            t('chat.history.loadFailed'),
          ),
          t('chat.history.loadFailed'),
        );
      });

      if (options.onOpenConversationInNewTab) {
        content.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.history.loadFailed'),
            ),
            t('chat.history.loadFailed'),
          );
        });
      }
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showHistoryContextMenu(item, conv.id, conv.title, isCurrent, options, e);
    });

    const actions = item.createDiv({ cls: 'claudian-history-item-actions' });

    // Show regenerate button if title generation failed, or loading indicator if pending
    if (conv.titleGenerationStatus === 'pending') {
      const loadingEl = actions.createEl('span', { cls: 'claudian-action-btn claudian-action-loading' });
      setIcon(loadingEl, 'loader-2');
      loadingEl.setAttribute('aria-label', 'Generating title...');
    } else if (conv.titleGenerationStatus === 'failed') {
      const regenerateBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
      setIcon(regenerateBtn, 'refresh-cw');
      regenerateBtn.setAttribute('aria-label', 'Regenerate title');
      regenerateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runConversationAction(
          () => this.regenerateTitle(conv.id),
          t('chat.history.regenerateFailed'),
        );
      });
    }

    const renameBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
    setIcon(renameBtn, 'pencil');
    renameBtn.setAttribute('aria-label', 'Rename');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRenameInput(item, conv.id, conv.title);
    });

    const deleteBtn = actions.createEl('button', { cls: 'claudian-action-btn claudian-delete-btn' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runConversationAction(
        () => this.runHistoryAction(
          () => this.deleteHistoryConversation(conv.id, options),
          t('chat.history.deleteFailed'),
        ),
        t('chat.history.deleteFailed'),
      );
    });
  }

  private isHistoryNewTabModifierClick(event: MouseEvent): boolean {
    return !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey);
  }

  private async runHistoryAction(
    action: () => Promise<void> | void,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(errorMessage);
    }
  }

  private showHistoryContextMenu(
    item: HTMLElement,
    conversationId: string,
    title: string,
    isCurrent: boolean,
    options: HistoryRenderOptions,
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    const openState = options.getConversationOpenState?.(conversationId) ?? (isCurrent ? 'current' : 'closed');

    if (!isCurrent) {
      if (openState === 'closed' && options.onOpenConversationInNewTab) {
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in new tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, true),
              'Failed to load conversation',
            );
          }));
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in background tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, false),
              'Failed to load conversation',
            );
          }));
      } else if (openState === 'open') {
        menu.addItem((menuItem) => menuItem
          .setTitle('Switch to open session')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onSelectConversation(conversationId),
              'Failed to load conversation',
            );
          }));
      }
    }

    menu.addItem((menuItem) => menuItem
      .setTitle('Rename')
      .onClick(() => {
        this.showRenameInput(item, conversationId, title);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle('Delete')
      .onClick(() => {
        void this.runHistoryAction(
          () => this.deleteHistoryConversation(conversationId, options),
          'Failed to delete conversation',
        );
      }));

    menu.showAtMouseEvent(event);
  }

  private async deleteHistoryConversation(
    conversationId: string,
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    if (state.isStreaming) return;

    await plugin.deleteConversation(conversationId);
    options.onRerender();

    if (conversationId === state.currentConversationId) {
      await this.deps.onReloadAfterActiveDelete();
    }
  }

  /** Shows inline rename input for a conversation. */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string): void {
    const titleEl = item.querySelector('.claudian-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = (item.ownerDocument ?? window.document).createElement('input');
    input.type = 'text';
    input.className = 'claudian-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      try {
        const newTitle = input.value.trim() || currentTitle;
        await this.deps.plugin.renameConversation(convId, newTitle);
        this.updateHistoryDropdown();
      } catch {
        new Notice(t('chat.history.renameFailed'));
      }
    };

    input.addEventListener('blur', () => {
      runConversationAction(finishRename, t('chat.history.renameFailed'));
    });
    input.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;

    // Title generation is delegated to the active provider service
    const fullConv = await plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 1) return;

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateConversation(conversationId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      conversationId,
      userContent,
      async (convId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(convId, result.title);
          await plugin.updateConversation(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Renders the history dropdown content to a provided container.
   * Used by ClaudianView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: Omit<HistoryRenderOptions, 'onRerender'>,
  ): void {
    this.renderHistoryItems(container, {
      ...options,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
