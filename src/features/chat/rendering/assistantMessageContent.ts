import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { ChatMessage, ContentBlock, ToolCallInfo } from '../../../core/types';
import { formatDurationMmSs } from '../../../utils/date';
import { classifyRuntimeError } from '../controllers/runtimeErrorClassification';
import { renderInlineRuntimeError } from './InlineRuntimeError';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';

/**
 * Callbacks `MessageRenderer` supplies so block dispatch can stay out of the
 * (LOC-capped) renderer module without duplicating its tool / text pipelines.
 */
export interface AssistantContentHost {
  getProviderId(): string;
  openProviderSettings(providerId: string): void;
  renderMarkdown(el: HTMLElement, markdown: string): Promise<void>;
  renderTextBlock(contentEl: HTMLElement, markdown: string): void;
  renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg: ChatMessage): void;
  renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void;
}

/** Renders assistant message content (content blocks or fallback). */
export function renderAssistantMessageContent(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
): void {
  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    const renderedToolIds = new Set<string>();
    for (const block of msg.contentBlocks) {
      renderContentBlock(host, msg, contentEl, block, renderedToolIds);
    }
    renderLeftoverToolCalls(host, msg, contentEl, renderedToolIds);
  } else {
    renderLegacyContent(host, msg, contentEl);
  }
  renderDurationFooter(msg, contentEl);
}

function renderContentBlock(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
  block: ContentBlock,
  renderedToolIds: Set<string>,
): void {
  switch (block.type) {
    case 'thinking':
      renderStoredThinkingBlock(
        contentEl,
        block.content,
        block.durationSeconds,
        (el, md) => host.renderMarkdown(el, md)
      );
      return;
    case 'text':
      // Skip empty or whitespace-only text blocks to avoid extra gaps
      if (block.content && block.content.trim()) {
        host.renderTextBlock(contentEl, block.content);
      }
      return;
    case 'tool_use':
      renderToolUseBlock(host, msg, contentEl, block.toolId, renderedToolIds);
      return;
    case 'context_compacted': {
      const boundaryEl = contentEl.createDiv({ cls: 'specorator-compact-boundary' });
      boundaryEl.createSpan({ cls: 'specorator-compact-boundary-label', text: 'Conversation compacted' });
      return;
    }
    case 'runtime_error':
      renderRuntimeErrorBlock(host, contentEl, block.content);
      return;
    case 'subagent':
      renderSubagentBlock(host, msg, contentEl, block, renderedToolIds);
      return;
  }
}

function renderToolUseBlock(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
  toolId: string,
  renderedToolIds: Set<string>,
): void {
  const toolCall = msg.toolCalls?.find(tc => tc.id === toolId);
  if (!toolCall) return;
  host.renderToolCall(contentEl, toolCall, msg);
  renderedToolIds.add(toolCall.id);
}

function renderSubagentBlock(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
  block: Extract<ContentBlock, { type: 'subagent' }>,
  renderedToolIds: Set<string>,
): void {
  const taskToolCall = msg.toolCalls?.find(
    tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
  );
  if (!taskToolCall) return;
  host.renderTaskSubagent(contentEl, taskToolCall, block.mode);
  renderedToolIds.add(taskToolCall.id);
}

/**
 * Re-renders the actionable error card from the persisted message. Retry is
 * omitted (no live turn to re-dispatch after a reload); open-settings still
 * works and the card hides the button for non-actionable kinds.
 */
function renderRuntimeErrorBlock(
  host: AssistantContentHost,
  contentEl: HTMLElement,
  content: string,
): void {
  const providerId = host.getProviderId();
  renderInlineRuntimeError(contentEl, {
    kind: classifyRuntimeError(content),
    content,
    providerId,
    onOpenSettings: () => host.openProviderSettings(providerId),
  });
}

/** Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload. */
function renderLeftoverToolCalls(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
  renderedToolIds: Set<string>,
): void {
  if (!msg.toolCalls || msg.toolCalls.length === 0) return;
  for (const toolCall of msg.toolCalls) {
    if (renderedToolIds.has(toolCall.id)) continue;
    host.renderToolCall(contentEl, toolCall, msg);
    renderedToolIds.add(toolCall.id);
  }
}

/** Fallback for old conversations without contentBlocks. */
function renderLegacyContent(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
): void {
  if (msg.content) {
    host.renderTextBlock(contentEl, msg.content);
  }
  if (msg.toolCalls) {
    for (const toolCall of msg.toolCalls) {
      host.renderToolCall(contentEl, toolCall, msg);
    }
  }
}

/** Response duration footer (skipped when the message contains a compaction boundary). */
function renderDurationFooter(msg: ChatMessage, contentEl: HTMLElement): void {
  const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
  if (!msg.durationSeconds || msg.durationSeconds <= 0 || hasCompactBoundary) return;
  const flavorWord = msg.durationFlavorWord || 'Baked';
  const footerEl = contentEl.createDiv({ cls: 'specorator-response-footer' });
  footerEl.createSpan({
    text: `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`,
    cls: 'specorator-baked-duration',
  });
}
