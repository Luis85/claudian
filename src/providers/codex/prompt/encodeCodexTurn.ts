import { encodeSectionedTurn } from '../../../core/prompt/sectionedTurn';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';

export function encodeCodexTurn(request: ChatTurnRequest): PreparedChatTurn {
  return encodeSectionedTurn(request, (req) => (
    req.currentNotePath ? [`\n[Current note: ${req.currentNotePath}]`] : []
  ));
}
