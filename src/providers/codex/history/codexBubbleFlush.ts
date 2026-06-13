import type { ChatMessage, ContentBlock } from '../../../core/types';
import type { CodexTurnState } from './codexTurnState';

interface BubbleState {
  contentChunks: string[];
  thinkingChunks: string[];
  toolCalls: CodexTurnState['assistantBubbles'][number]['toolCalls'];
  contentBlocks: ContentBlock[];
  interrupted?: boolean;
  startedAt?: number;
  lastEventAt: number;
}

interface CodexSystemMessageGuard {
  isCodexSystemMessage(text: string): boolean;
  extractCodexDisplayContent(text: string): string | undefined;
}

function buildUserMessage(
  turn: CodexTurnState,
  msgIndex: number,
  guard: CodexSystemMessageGuard,
): ChatMessage | null {
  const userText = turn.userChunks.join('\n').trim();
  if (!userText || guard.isCodexSystemMessage(userText)) {
    return null;
  }

  const displayContent = guard.extractCodexDisplayContent(userText);
  return {
    id: `codex-msg-${msgIndex}`,
    role: 'user',
    content: userText,
    ...(displayContent !== undefined ? { displayContent } : {}),
    ...(turn.serverTurnId ? { userMessageId: turn.serverTurnId } : {}),
    timestamp: turn.userTimestamp || turn.startedAt || Date.now(),
  };
}

function buildInterruptMessage(
  bubble: BubbleState,
  turn: CodexTurnState,
  msgIndex: number,
): ChatMessage {
  return {
    id: `codex-msg-${msgIndex}`,
    role: 'assistant',
    content: '',
    timestamp: bubble.startedAt || turn.startedAt || Date.now(),
    isInterrupt: true,
  };
}

function buildAssistantContentBlocks(
  bubble: BubbleState,
  thinkingText: string,
  contentText: string,
): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];
  if (thinkingText.trim().length > 0) {
    contentBlocks.push({ type: 'thinking', content: thinkingText.trim() });
  }
  contentBlocks.push(...bubble.contentBlocks);
  if (contentText.trim().length > 0) {
    contentBlocks.push({ type: 'text', content: contentText.trim() });
  }
  return contentBlocks;
}

function buildAssistantMessage(
  bubble: BubbleState,
  turn: CodexTurnState,
  msgIndex: number,
): ChatMessage {
  const contentText = bubble.contentChunks.join('\n\n');
  const thinkingText = bubble.thinkingChunks.join('\n\n');
  const hasToolCalls = bubble.toolCalls.length > 0;
  const contentBlocks = buildAssistantContentBlocks(bubble, thinkingText, contentText);

  const msg: ChatMessage = {
    id: `codex-msg-${msgIndex}`,
    role: 'assistant',
    content: contentText.trim(),
    timestamp: bubble.startedAt || turn.startedAt || Date.now(),
    toolCalls: hasToolCalls ? bubble.toolCalls : undefined,
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
  };

  if (bubble.interrupted) {
    msg.isInterrupt = true;
  }

  return msg;
}

function isBubbleEmpty(bubble: BubbleState): boolean {
  const hasContent = bubble.contentChunks.join('\n\n').trim().length > 0;
  const hasThinking = bubble.thinkingChunks.join('\n\n').trim().length > 0;
  const hasToolCalls = bubble.toolCalls.length > 0;
  const hasCompactBoundary = bubble.contentBlocks.some(b => b.type === 'context_compacted');
  return !hasContent && !hasThinking && !hasToolCalls && !hasCompactBoundary;
}

function applyTurnDuration(
  assistantMessages: ChatMessage[],
  turn: CodexTurnState,
  lastAssistantTimestamp: number,
): void {
  if (assistantMessages.length > 0 && turn.userTimestamp && lastAssistantTimestamp > turn.userTimestamp) {
    const durationMs = lastAssistantTimestamp - turn.userTimestamp;
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    lastMsg.durationSeconds = Math.round(durationMs / 1000);
  }

  if (turn.serverTurnId && turn.completed && assistantMessages.length > 0) {
    const lastNonInterrupt = [...assistantMessages].reverse().find(m => !m.isInterrupt);
    if (lastNonInterrupt) {
      lastNonInterrupt.assistantMessageId = turn.serverTurnId;
    }
  }
}

export function flushBubbleTurnMessages(
  turn: CodexTurnState,
  msgIndex: number,
  guard: CodexSystemMessageGuard,
): { messages: ChatMessage[]; nextMsgIndex: number } {
  const messages: ChatMessage[] = [];

  const userMessage = buildUserMessage(turn, msgIndex, guard);
  if (userMessage) {
    messages.push(userMessage);
    msgIndex += 1;
  }

  let lastAssistantTimestamp = 0;
  const assistantMessages: ChatMessage[] = [];

  for (const bubble of turn.assistantBubbles) {
    if (isBubbleEmpty(bubble)) {
      if (bubble.interrupted) {
        messages.push(buildInterruptMessage(bubble, turn, msgIndex));
        msgIndex += 1;
      }
      continue;
    }

    const msg = buildAssistantMessage(bubble, turn, msgIndex);
    if (bubble.lastEventAt > lastAssistantTimestamp) {
      lastAssistantTimestamp = bubble.lastEventAt;
    }

    assistantMessages.push(msg);
    messages.push(msg);
    msgIndex += 1;
  }

  applyTurnDuration(assistantMessages, turn, lastAssistantTimestamp);

  return { messages, nextMsgIndex: msgIndex };
}
