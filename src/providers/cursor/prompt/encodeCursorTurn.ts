import { encodeSectionedTurn } from '../../../core/prompt/sectionedTurn';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';

function buildCursorContextHints(request: ChatTurnRequest): string[] {
  const hints: string[] = [];

  if (request.images?.length) {
    hints.push(
      `\n[The user attached ${request.images.length} image(s) in Claudian. Use vault paths or ask which files to read if you need the image bytes.]`,
    );
  }

  if (request.currentNotePath) {
    // A bare "[Current note: path]" hint is ignored by the agent. Give it an
    // explicit, actionable instruction; the path is relative to the working
    // directory (the vault root), which the agent can read with its file tools.
    hints.push(
      `\n[The user is currently viewing the note "${request.currentNotePath}" in Obsidian.`
      + ` This path is relative to your current working directory.`
      + ` Read it with your file tools and use it as context when it is relevant to the request.]`,
    );
  }

  return hints;
}

export function encodeCursorTurn(request: ChatTurnRequest): PreparedChatTurn {
  return encodeSectionedTurn(request, buildCursorContextHints);
}
