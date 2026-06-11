import { wrapUntrustedExternalData } from '../context/untrustedContent';
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

  const sections: string[] = [request.text, ...buildContextHints(request)];

  if (request.editorSelection?.selectedText) {
    sections.push(
      `\n[Editor selection from ${request.editorSelection.notePath || 'current note'}:\n${request.editorSelection.selectedText}\n]`,
    );
  }

  if (request.browserSelection?.selectedText) {
    // Web content crosses the trust boundary: demarcate it so the model
    // treats it as quoted data, mirroring the XML providers' envelope.
    const wrapped = wrapUntrustedExternalData(
      request.browserSelection.selectedText,
    );
    sections.push(
      `\n[Browser selection from ${request.browserSelection.url ?? 'unknown page'}:\n${wrapped}\n]`,
    );
  }

  if (request.canvasSelection) {
    const nodeList = request.canvasSelection.nodeIds.join(', ');
    if (nodeList) {
      sections.push(
        `\n[Canvas selection from ${request.canvasSelection.canvasPath}:\n${nodeList}\n]`,
      );
    }
  }

  return {
    request,
    persistedContent: request.text,
    prompt: sections.join(''),
    isCompact: false,
    mcpMentions: new Set(),
  };
}
