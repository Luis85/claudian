import { buildContextEnvelope, renderContextEnvelopeSectioned } from '../context/contextEnvelope';
import type { ChatTurnRequest, PreparedChatTurn } from '../runtime/types';

function isCompactCommand(text: string): boolean {
  return /^\/compact(\s|$)/i.test(text);
}

/**
 * Shared turn encoding for providers that take a single plain-text prompt with
 * bracketed context sections (Codex, Cursor). `/compact` passes through
 * untouched so the provider recognizes the built-in command. Provider-specific
 * hints (images, current-note phrasing) slot in between the user text and the
 * shared selection sections.
 */
export function encodeSectionedTurn(
  request: ChatTurnRequest,
  buildContextHints: (request: ChatTurnRequest) => string[],
): PreparedChatTurn {
  if (isCompactCommand(request.text)) {
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: true,
      mcpMentions: new Set(),
    };
  }

  const sections: string[] = [
    request.text,
    ...buildContextHints(request),
    ...renderContextEnvelopeSectioned(buildContextEnvelope(request)),
  ];

  return {
    request,
    persistedContent: request.text,
    prompt: sections.join(''),
    isCompact: false,
    mcpMentions: new Set(),
  };
}
