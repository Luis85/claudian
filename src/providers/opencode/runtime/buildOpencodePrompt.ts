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
    // Prepend the persona as a leading directive (re-sent per turn) so the model
    // adopts the role before the user turn rather than as a trailing footnote.
    promptText = `${boundAgentPrompt}\n\n---\n\n${promptText}`;
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
