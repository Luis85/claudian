import { buildContextEnvelope, renderContextEnvelopeXml } from '../../../core/context/contextEnvelope';
import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';

function isCompactCommand(text: string): boolean {
  return /^\/compact(\s|$)/i.test(text);
}

export function encodeClaudeTurn(
  request: ChatTurnRequest,
  mcpManager: Pick<McpServerManager, 'extractMentions' | 'transformMentions'>,
): PreparedChatTurn {
  const isCompact = isCompactCommand(request.text);

  const contextBlocks = isCompact ? [] : renderContextEnvelopeXml(buildContextEnvelope(request));
  const persistedContent = [request.text, ...contextBlocks].join('\n\n');

  const mcpMentions = mcpManager.extractMentions(persistedContent);

  return {
    request,
    persistedContent,
    prompt: mcpManager.transformMentions(persistedContent),
    isCompact,
    mcpMentions,
  };
}
