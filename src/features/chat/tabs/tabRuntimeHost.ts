import type { RuntimeHost } from '../../../core/runtime/RuntimeHost';
import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import type { ChatMessage, StreamChunk } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import {
  generateMessageId,
  getTabPermissionMode,
  updatePlanModeUI,
} from './tabShared';
import type { TabData } from './types';

/**
 * Builds the per-tab `RuntimeHost` handed to provider runtimes at construction
 * (ADR-0001 Phase 2 / Move 3). Every member closes over live tab state — it
 * reads `tab.controllers.inputController` at call time, so controller
 * lazy-init or restart cycles never require host re-wiring. Members no-op (or
 * return the neutral answer) while their backing UI is not yet mounted.
 */
export function createTabRuntimeHost(tab: TabData, plugin: ClaudianPlugin): RuntimeHost {
  return {
    approval: async (toolName, input, description, options) =>
      await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
      ?? 'cancel',
    dismissApproval: () => {
      tab.controllers.inputController?.dismissPendingApprovalPrompt();
    },
    askUser: async (input, signal) =>
      await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
      ?? null,
    exitPlanMode: async (input, signal) => {
      const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
      // Revert only on approve; feedback and cancel keep plan mode active.
      if (decision !== null && decision.type !== 'feedback') {
        // Only restore permission mode if still in plan mode — user may have toggled out via Shift+Tab
        if (getTabPermissionMode(tab, plugin) === 'plan') {
          const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
          tab.state.prePlanPermissionMode = null;
          updatePlanModeUI(tab, plugin, restoreMode);
        }
        if (decision.type === 'approve-new-session') {
          tab.state.pendingNewSessionPlan = decision.planContent;
          tab.state.cancelRequested = true;
        }
      }
      return decision;
    },
    permissionModeSync: (sdkMode) => {
      const mode = sdkMode === 'bypassPermissions' || sdkMode === 'yolo'
        ? 'yolo'
        : sdkMode === 'plan'
        ? 'plan'
        : 'normal';
      const currentMode = getTabPermissionMode(tab, plugin);

      if (currentMode !== mode) {
        // Save pre-plan mode when entering plan (for Shift+Tab toggle restore)
        if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
          tab.state.prePlanPermissionMode = currentMode;
        }
        updatePlanModeUI(tab, plugin, mode);
      }
    },
    autoTurn: (result: AutoTurnResult) => renderAutoTriggeredTurn(tab, result),
    getSubagentState: () => ({
      hasRunning: tab.services.subagentManager.hasRunningSubagents(),
    }),
  };
}

function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

/**
 * Renders an auto-triggered turn (e.g., agent response to task-notification)
 * that arrives after the main handler has completed.
 */
async function renderAutoTriggeredTurn(tab: TabData, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) {
    return;
  }

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (contentEl) {
      if (!previousContentEl) {
        tab.state.toolCallElements.clear();
      }
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  // Suppress the runtime-error card's Retry for this background turn: it has no
  // user prompt, and retryLastTurn() would resend the unrelated last chat turn.
  tab.controllers.streamController?.setRenderingAutoTurn(true);
  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    tab.controllers.streamController?.setRenderingAutoTurn(false);
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}
