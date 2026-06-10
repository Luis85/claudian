import type { App } from 'obsidian';

import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatTurnMetadata, ChatTurnRequest } from '../../../core/runtime/types';
import { TOOL_EXIT_PLAN_MODE } from '../../../core/tools/toolNames';
import type { ChatMessage } from '../../../core/types';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { formatDurationMmSs } from '../../../utils/date';
import type { EditorSelectionContext } from '../../../utils/editor';
import { COMPLETION_FLAVOR_WORDS } from '../constants';
import type { PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';

/** Composer snapshot resolved once per send and threaded through every phase. */
export interface ComposerSendContext {
  content: string;
  shouldUseInput: boolean;
  hasImages: boolean;
  imageOverride?: ChatMessage['images'];
  inputEl: HTMLTextAreaElement;
  imageContextManager: ImageContextManager | null;
  fileContextManager: FileContextManager | null;
}

/** Per-send overrides accepted by `sendMessage` and threaded into turn building. */
export interface ComposerTurnOptions {
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
  turnRequestOverride?: ChatTurnRequest;
}

export interface OutgoingTurn {
  displayContent: string;
  turnRequest: ChatTurnRequest;
  imagesForMessage?: ChatMessage['images'];
  isCompact: boolean;
}

/** Everything a dispatched turn carries through streaming and finalization. */
export interface DispatchedTurnContext {
  agentService: ChatRuntime;
  send: ComposerSendContext;
  turnRequest: ChatTurnRequest;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  streamGeneration: number;
  tabModelOverride: string | null;
  deferredAiTitleGeneration: (() => void) | null;
}

/** Consumed turn metadata plus the resolved final assistant message. */
export interface FinishedTurn {
  finalAssistantMsg: ChatMessage;
  turnMetadata: ChatTurnMetadata;
  didEnqueueToSdk: boolean;
  planCompleted: boolean;
  wasInterrupted: boolean;
}

export interface PlanApprovalOutcome {
  autoSendContent: string | null;
  invalidated: boolean;
  shouldProcessQueuedMessage: boolean;
}

export function resolveComposerSend(args: {
  inputEl: HTMLTextAreaElement;
  imageContextManager: ImageContextManager | null;
  fileContextManager: FileContextManager | null;
  overrides?: { content?: string; images?: ChatMessage['images'] };
}): ComposerSendContext {
  const contentOverride = args.overrides?.content;
  const imageOverride = args.overrides?.images;
  const shouldUseInput = contentOverride === undefined;
  const content = (contentOverride ?? args.inputEl.value).trim();
  const hasImages = imageOverride !== undefined
    ? imageOverride.length > 0
    : (args.imageContextManager?.hasImages() ?? false);

  return {
    content,
    shouldUseInput,
    hasImages,
    imageOverride,
    inputEl: args.inputEl,
    imageContextManager: args.imageContextManager,
    fileContextManager: args.fileContextManager,
  };
}

export function resolveComposerSourceImages(
  send: ComposerSendContext,
): NonNullable<ChatMessage['images']> {
  return send.imageOverride ?? send.imageContextManager?.getAttachedImages() ?? [];
}

export function normalizeTabModelOverride(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function beginStreamingTurnState(
  state: ChatState,
  send: ComposerSendContext,
  ui: {
    plugin: { settings: { enableAutoScroll?: boolean } };
    getSubagentManager: () => { resetSpawnedCount: () => void };
    getWelcomeEl: () => HTMLElement | null;
  },
): number {
  state.isStreaming = true;
  state.cancelRequested = false;
  state.ignoreUsageUpdates = false; // Allow usage updates for new query
  ui.getSubagentManager().resetSpawnedCount();
  state.autoScrollEnabled = ui.plugin.settings.enableAutoScroll ?? true; // Reset auto-scroll based on setting
  const streamGeneration = state.bumpStreamGeneration();

  // Hide welcome message when sending first message
  const welcomeEl = ui.getWelcomeEl();
  if (welcomeEl) {
    welcomeEl.addClass('claudian-hidden');
  }

  send.fileContextManager?.startSession();
  return streamGeneration;
}

export function createOutgoingUserMessage(
  id: string,
  displayContent: string,
  imagesForMessage: ChatMessage['images'],
): ChatMessage {
  return {
    id,
    role: 'user',
    content: displayContent,
    displayContent,                // Original user input (for UI display)
    timestamp: Date.now(),
    images: imagesForMessage,
  };
}

export function createAssistantPlaceholderMessage(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };
}

/** Restore pendingResumeAt from persisted conversation state (survives plugin reload). */
export async function restoreResumeCheckpointIfNeeded(
  agentService: ChatRuntime,
  state: ChatState,
  conversations: {
    getConversationSync: (id: string) => { resumeAtMessageId?: string } | null | undefined;
    updateConversation: (id: string, updates: { resumeAtMessageId?: string }) => Promise<unknown>;
  },
): Promise<void> {
  const conversationIdForSend = state.currentConversationId;
  if (!conversationIdForSend) {
    return;
  }
  const conv = conversations.getConversationSync(conversationIdForSend);
  if (!conv?.resumeAtMessageId) {
    return;
  }
  if (isResumeSessionAtStillNeeded(conv.resumeAtMessageId, state.messages.slice(0, -2))) {
    agentService.setResumeCheckpoint(conv.resumeAtMessageId);
  } else {
    try {
      await conversations.updateConversation(conversationIdForSend, { resumeAtMessageId: undefined });
    } catch {
      // Best-effort — don't block send
    }
  }
}

export function isResumeSessionAtStillNeeded(
  resumeUuid: string,
  previousMessages: ChatMessage[],
): boolean {
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    if (previousMessages[i].role === 'assistant' && previousMessages[i].assistantMessageId === resumeUuid) {
      // Still needed only if no messages follow the resume point
      return i === previousMessages.length - 1;
    }
  }
  return false;
}

/** Bakes the response-duration footer into the message and live DOM (skips interrupted responses and compaction). */
export function bakeResponseDurationFooter(
  state: ChatState,
  finalAssistantMsg: ChatMessage,
  didCancelThisTurn: boolean,
): void {
  const hasCompactBoundary = finalAssistantMsg.contentBlocks?.some(b => b.type === 'context_compacted');
  if (didCancelThisTurn || hasCompactBoundary) {
    return;
  }

  const durationSeconds = state.responseStartTime
    ? Math.floor((performance.now() - state.responseStartTime) / 1000)
    : 0;
  if (durationSeconds <= 0) {
    return;
  }

  const flavorWord =
    COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
  finalAssistantMsg.durationSeconds = durationSeconds;
  finalAssistantMsg.durationFlavorWord = flavorWord;
  // Add footer to live message in DOM
  if (state.currentContentEl) {
    const footerEl = state.currentContentEl.createDiv({ cls: 'claudian-response-footer' });
    footerEl.createSpan({
      text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
      cls: 'claudian-baked-duration',
    });
  }
}

/**
 * approve-new-session: the tool_result chunk is dropped because cancelRequested
 * was set before the stream loop could process it — manually set the result so
 * the saved conversation renders correctly when revisited.
 */
export function completeApprovedNewSessionPlanToolCalls(
  app: App,
  state: ChatState,
  finalAssistantMsg: ChatMessage,
): void {
  if (!state.pendingNewSessionPlan || !finalAssistantMsg.toolCalls) {
    return;
  }

  for (const tc of finalAssistantMsg.toolCalls) {
    if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
      tc.status = 'completed';
      tc.result = 'User approved the plan and started a new session.';
      updateToolCallResult(app, tc.id, tc, state.toolCallElements);
    }
  }
}

export function applyPlanApprovalDecision(
  decision: PlanApprovalDecision | null,
  turnMetadata: ChatTurnMetadata,
  controls: {
    getInputEl: () => HTMLTextAreaElement;
    restorePrePlanPermissionModeIfNeeded?: () => void;
  },
): PlanApprovalOutcome {
  if (decision?.type === 'implement') {
    controls.restorePrePlanPermissionModeIfNeeded?.();
    return {
      autoSendContent: turnMetadata.autoFollowUpText
        ? `${turnMetadata.autoFollowUpText}\n\nImplement the plan.`
        : 'Implement the plan.',
      invalidated: false,
      shouldProcessQueuedMessage: true,
    };
  }
  if (decision?.type === 'revise') {
    // Keep plan mode active, populate input with feedback text
    controls.getInputEl().value = decision.text;
    return { autoSendContent: null, invalidated: false, shouldProcessQueuedMessage: false };
  }
  // cancel or null (dismissed)
  controls.restorePrePlanPermissionModeIfNeeded?.();
  return { autoSendContent: null, invalidated: false, shouldProcessQueuedMessage: true };
}
