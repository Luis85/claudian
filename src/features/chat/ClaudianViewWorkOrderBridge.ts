import type { ChatTabReservation } from '../../core/chatTabReservations';
import type { ProviderId } from '../../core/providers/types';
import type { StreamChunk } from '../../core/types';
import type { ProgrammaticSendResult } from './controllers/InputController';
import type { TabManager } from './tabs/TabManager';
import type { TabId, TaskRunTabHandle, TaskRunTabTerminal } from './tabs/types';

/**
 * The chat view's integration surface with the Agent Board / tasks feature:
 * launching a work-order run in a fresh tab and routing a commit-and-push prompt
 * into a work-order's conversation. Extracted from `ClaudianView` so the view
 * keeps lifecycle/assembly and this owns the work-order-tab wiring. The
 * cross-view conversation lookup (which is `ClaudianView`-specific) is hidden
 * behind the `findConversationTab` callback so this module never imports the
 * view (no cycle); `ClaudianView` keeps thin public delegators so the tasks
 * feature (`ChatTabExecutionSurface`) calls it unchanged.
 */
export interface ClaudianViewWorkOrderBridgeDeps {
  getTabManager: () => TabManager | null;
  /**
   * Resolves the tab hosting a conversation across all open chat views (this
   * view or any split). Returns `null` when no view hosts it; returns a
   * possibly-null `tabManager` when a host is found but its manager is
   * unavailable (so the caller can distinguish "not found" → reopen from
   * "found but unusable" → fall back to a fresh tab, matching the original).
   */
  findConversationTab: (conversationId: string) => { tabManager: TabManager | null; tabId: TabId } | null;
  openConversationInNewTab: (conversationId: string) => Promise<void>;
}

export class ClaudianViewWorkOrderBridge {
  private deps: ClaudianViewWorkOrderBridgeDeps;

  constructor(deps: ClaudianViewWorkOrderBridgeDeps) {
    this.deps = deps;
  }

  async startTaskRunInFreshTab(options: {
    providerId: ProviderId;
    model: string;
    prompt: string;
    tabReservation?: ChatTabReservation;
    /**
     * Vault-relative work-order note path. Pinned onto the new tab so the chat
     * display renders the run's `<claudian_handoff>` as a card. Optional: the
     * commit-turn fallback inside `injectCommitTurnForConversation` has no
     * work-order note path to pass, so a normal (non-work-order) tab is fine.
     */
    workOrderPath?: string;
  }): Promise<TaskRunTabHandle | null> {
    const tabManager = this.deps.getTabManager();
    if (!tabManager) {
      options.tabReservation?.release();
      return null;
    }

    const tab = await tabManager.createTaskRunTab({
      providerId: options.providerId,
      model: options.model,
      workOrderPath: options.workOrderPath,
    });
    // The tab now counts in the live tab count (or creation failed), so this
    // run no longer needs its pending reservation — release it before the turn
    // streams so other panes' gates see the freed/used slot immediately.
    options.tabReservation?.release();
    if (!tab) return null;

    const inputController = tab.controllers.inputController;
    const streamController = tab.controllers.streamController;
    if (!inputController || !streamController) return null;

    // Attach to the stream BEFORE starting the turn so no early chunk (even a
    // fast `done`) is lost in the window before the work-order runner subscribes.
    // Chunks are buffered until the real observer attaches, then replayed in order.
    const buffered: StreamChunk[] = [];
    let liveObserver: ((chunk: StreamChunk) => void) | null = null;
    const emit = (chunk: StreamChunk): void => {
      if (liveObserver) liveObserver(chunk);
      else buffered.push(chunk);
    };
    const detachRaw = streamController.addStreamObserver(emit);

    const toTerminal = (result: ProgrammaticSendResult | undefined): TaskRunTabTerminal => {
      const sendResult: ProgrammaticSendResult = result ?? {
        ok: false,
        finalAssistantContent: '',
        error: 'No result from the chat run.',
      };
      let status: TaskRunTabTerminal['status'] = sendResult.ok ? 'completed' : 'failed';
      if (!sendResult.ok && sendResult.error === 'Canceled') status = 'canceled';
      return {
        status,
        finalAssistantContent: sendResult.finalAssistantContent,
        error: sendResult.ok ? undefined : sendResult.error,
      };
    };

    const terminal = (inputController.sendMessage({ content: options.prompt }) as Promise<
      ProgrammaticSendResult | undefined
    >)
      .then(toTerminal)
      .catch((error) => ({
        status: 'failed' as const,
        finalAssistantContent: '',
        error: error instanceof Error ? error.message : String(error),
      }));

    return {
      // The conversation is created lazily by the first send() above, which
      // mutates tab.conversationId via onConversationIdChanged. Read it live so
      // the run binds the real id once it exists instead of freezing null here.
      get conversationId() {
        return tab.conversationId;
      },
      sidepanelTabId: tab.id,
      subscribe: (observer) => {
        liveObserver = observer;
        if (buffered.length > 0) {
          const replay = buffered.splice(0, buffered.length);
          for (const chunk of replay) observer(chunk);
        }
        return () => {
          if (liveObserver === observer) liveObserver = null;
          detachRaw();
        };
      },
      sendFollowUp: async (content) => {
        // Resolve with the follow-up turn's settlement so the runner can finish a
        // turn that emits no stream `done` (e.g. the provider threw after creating
        // the assistant message and the controller still resolved ok). Reporting
        // it as the return value — rather than a synthetic stream chunk — ties it
        // to this specific send, so a late `done` from the pause turn can't be
        // mistaken for this turn's end. The runner ignores it when a real `done`
        // already finished the turn or the follow-up paused again.
        try {
          const result = (await inputController.sendMessage({ content })) as
            | ProgrammaticSendResult
            | undefined;
          // Queued behind the still-streaming pause turn: it will run and stream
          // its own end next, so report no outcome and let the runner finish from
          // that stream end rather than failing the accepted reply.
          if (result?.queued) return;
          // No result means the turn was not sent and never will be (service
          // init failure, conversation switching, a built-in command, etc.):
          // fail promptly instead of hanging until the stale-heartbeat timeout.
          if (!result) return { ok: false, error: 'Follow-up turn could not be sent.' };
          if (result.ok) return { ok: true, finalAssistantContent: result.finalAssistantContent };
          return { ok: false, error: result.error ?? 'Follow-up turn failed.' };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      cancel: () => inputController.cancelStreaming(),
      terminal,
    };
  }

  /**
   * Routes a commit-and-push prompt into a work-order's chat. Focuses the
   * conversation tab when it's open in any ClaudianView, restores it from
   * history into a fresh tab when no tab currently hosts it, and only falls
   * back to a brand-new task-run tab when the saved conversation is truly
   * unrecoverable (e.g. tab cap reached or no saved conversationId at all).
   */
  async injectCommitTurnForConversation(options: {
    conversationId: string | null;
    fallbackProviderId: ProviderId;
    fallbackModel: string;
    prompt: string;
  }): Promise<void> {
    if (!this.deps.getTabManager()) {
      throw new Error('Chat view is not ready.');
    }

    if (options.conversationId) {
      // findConversationTab covers both this view and any split view that already
      // hosts the work-order tab. When neither does (closed tab, restart, etc.),
      // openConversationInNewTab restores from saved history — it opens a new tab
      // when canCreateTab is true and otherwise reloads the active tab in place.
      // We deliberately skip the canCreateTab guard because startTaskRunInFreshTab
      // would also hit the tab cap, so the user would get a "tab limit reached"
      // failure instead of the commit prompt firing into the conversation they
      // just accepted.
      let cross = this.deps.findConversationTab(options.conversationId);
      if (!cross) {
        await this.deps.openConversationInNewTab(options.conversationId);
        cross = this.deps.findConversationTab(options.conversationId);
      }
      if (cross && cross.tabManager) {
        await cross.tabManager.switchToTab(cross.tabId);
        const ownerTab = cross.tabManager.getTab(cross.tabId);
        const ic = ownerTab?.controllers.inputController;
        if (!ic) {
          throw new Error('Chat tab is missing an input controller.');
        }
        // Drain background hydration first. TabManager.switchToTab → ConversationController.switchTo
        // only awaits Phase A (sync UI swap); Phase B (transcript hydration) is
        // fire-and-forget and leaves `state.isHydrating = true`. InputController.sendMessage
        // early-returns while isHydrating is set, so without this await the
        // commit prompt would silently drop on cold WO tabs (post-restart,
        // post-close, or any tab whose transcript hasn't been hydrated yet).
        await ownerTab?.controllers.conversationController?.whenHydrated?.();
        await ic.sendMessage({ content: options.prompt });
        return;
      }
    }

    const handle = await this.startTaskRunInFreshTab({
      providerId: options.fallbackProviderId,
      model: options.fallbackModel,
      prompt: options.prompt,
    });
    if (!handle) {
      throw new Error('Could not open a work-order tab (work-order tab limit reached).');
    }
    // startTaskRunInFreshTab eagerly registers a stream observer that buffers
    // chunks until a consumer subscribes. The commit flow doesn't consume the
    // stream, so subscribe with a no-op (which drains the buffer and stops
    // further buffering) and dispose it once the turn settles — otherwise the
    // observer stays attached for the tab's lifetime, buffering with no reader.
    const dispose = handle.subscribe(() => {});
    try {
      const terminal = await handle.terminal;
      if (terminal.status === 'failed' && terminal.error) {
        throw new Error(terminal.error);
      }
    } finally {
      dispose();
    }
  }
}
