import { buildContextEnvelope, renderContextEnvelopeXml } from '../../../core/context/contextEnvelope';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import type { AcpContentBlock } from '../../acp';

export function buildOpencodePromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
  const contextBlocks = renderContextEnvelopeXml(buildContextEnvelope(request));
  let prompt = [request.text, ...contextBlocks].join('\n\n');

  if (conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  return prompt;
}

export function buildOpencodePromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  boundAgentPrompt?: string,
): AcpContentBlock[] {
  let promptText = buildOpencodePromptText(request, conversationHistory);

  if (boundAgentPrompt) {
    // Append per-turn via connection.prompt(); minor redundancy of re-sending
    // each turn is acceptable for MVP (no session restart required).
    promptText += `\n\n# Agent Instructions\n\n${boundAgentPrompt}`;
  }

  const blocks: AcpContentBlock[] = [
    { type: 'text', text: promptText },
  ];

  for (const image of request.images ?? []) {
    if (!image.data) {
      continue;
    }

    blocks.push({
      data: image.data,
      mimeType: image.mediaType,
      type: 'image',
    });
  }

  return blocks;
}
