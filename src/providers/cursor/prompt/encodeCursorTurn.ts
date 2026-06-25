import { encodeSectionedTurn } from '../../../core/prompt/sectionedTurn';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';

// Matches the composer's agent-mention insertion format: `@<id> (agent) `.
const AGENT_MENTION_PATTERN = /@(\S+) \(agent\)/g;

function collectMentionedAgentNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

function buildCursorContextHints(request: ChatTurnRequest): string[] {
  const hints: string[] = [];

  if (request.images?.length) {
    hints.push(
      `\n[The user attached ${request.images.length} image(s) in Specorator. Use vault paths or ask which files to read if you need the image bytes.]`,
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

  const agentNames = collectMentionedAgentNames(request.text);
  if (agentNames.length > 0) {
    // No path claim: the mention only carries a name, and the agent may be a
    // vault (.cursor/agents/), global (~/.cursor/agents/), or built-in agent —
    // Cursor already knows where its own subagents live.
    hints.push(
      `\n[The user referenced the subagent(s) ${agentNames.map((n) => `"${n}"`).join(', ')}.`
      + ` Delegate the relevant parts of this task to the referenced subagent(s).]`,
    );
  }

  return hints;
}

export function encodeCursorTurn(request: ChatTurnRequest): PreparedChatTurn {
  return encodeSectionedTurn(request, buildCursorContextHints);
}
