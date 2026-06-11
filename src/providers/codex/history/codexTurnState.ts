import type { ChatMessage, ContentBlock, ToolCallInfo } from '../../../core/types';

// ---------------------------------------------------------------------------
// Multi-bubble turn model — shared by the persisted/modern parsers in
// CodexHistoryStore and the legacy item mapping in codexLegacyItemMapping.
// ---------------------------------------------------------------------------

export interface CodexAssistantBubble {
  contentChunks: string[];
  thinkingChunks: string[];
  toolCalls: ToolCallInfo[];
  toolIndexesById: Map<string, number>;
  contentBlocks: ContentBlock[];
  startedAt: number;
  lastEventAt: number;
  interrupted: boolean;
}

export interface CodexTurnState {
  id: string;
  serverTurnId?: string;
  startedAt: number;
  completedAt?: number;
  completed?: boolean;
  lastEventAt: number;
  userTimestamp?: number;
  userChunks: string[];
  assistantBubbles: CodexAssistantBubble[];
  activeBubbleIndex: number | null;
}

export interface PersistedParseContext {
  turns: Map<string, CodexTurnState>;
  turnOrder: string[];
  currentTurnId: string | null;
  toolCallToTurn: Map<string, { turnId: string; bubbleIndex: number }>;
  suppressedToolOutputIds: Set<string>;
  terminalSessionToCommandId: Map<string, string>;
  stdinCallToCommandId: Map<string, string>;
  turnCounter: number;
}

// ---------------------------------------------------------------------------
// Turn/bubble lifecycle helpers
// ---------------------------------------------------------------------------

function newBubble(timestamp: number): CodexAssistantBubble {
  return {
    contentChunks: [],
    thinkingChunks: [],
    toolCalls: [],
    toolIndexesById: new Map(),
    contentBlocks: [],
    startedAt: timestamp,
    lastEventAt: timestamp,
    interrupted: false,
  };
}

function newTurnState(id: string, timestamp: number): CodexTurnState {
  return {
    id,
    startedAt: timestamp,
    lastEventAt: timestamp,
    userChunks: [],
    assistantBubbles: [],
    activeBubbleIndex: null,
  };
}

export function createPersistedParseContext(): PersistedParseContext {
  return {
    turns: new Map(),
    turnOrder: [],
    currentTurnId: null,
    toolCallToTurn: new Map(),
    suppressedToolOutputIds: new Set(),
    terminalSessionToCommandId: new Map(),
    stdinCallToCommandId: new Map(),
    turnCounter: 0,
  };
}

export function nextTurnId(ctx: PersistedParseContext): string {
  ctx.turnCounter += 1;
  return `turn-${ctx.turnCounter}`;
}

export function ensureTurn(
  turns: Map<string, CodexTurnState>,
  turnOrder: string[],
  preferredTurnId: string,
  currentTurnId: string | null,
  timestamp: number,
): CodexTurnState {
  const id = currentTurnId ?? preferredTurnId;
  const existing = turns.get(id);
  if (existing) {
    if (timestamp > 0 && timestamp > existing.lastEventAt) {
      existing.lastEventAt = timestamp;
    }
    return existing;
  }

  const turn = newTurnState(id, timestamp);
  turns.set(id, turn);
  turnOrder.push(id);
  return turn;
}

export function ensureAssistantBubble(turn: CodexTurnState, timestamp: number): CodexAssistantBubble {
  if (turn.activeBubbleIndex !== null) {
    const bubble = turn.assistantBubbles[turn.activeBubbleIndex];
    if (timestamp > 0 && timestamp > bubble.lastEventAt) {
      bubble.lastEventAt = timestamp;
    }
    return bubble;
  }

  const bubble = newBubble(timestamp);
  turn.assistantBubbles.push(bubble);
  turn.activeBubbleIndex = turn.assistantBubbles.length - 1;
  return bubble;
}

export function closeAssistantBubble(turn: CodexTurnState): void {
  turn.activeBubbleIndex = null;
}

export function pushToolInvocation(bubble: CodexAssistantBubble, toolCall: ToolCallInfo): void {
  const existingIndex = bubble.toolIndexesById.get(toolCall.id);
  if (existingIndex !== undefined) {
    bubble.toolCalls[existingIndex] = toolCall;
    return;
  }

  bubble.toolIndexesById.set(toolCall.id, bubble.toolCalls.length);
  bubble.toolCalls.push(toolCall);
  bubble.contentBlocks.push({ type: 'tool_use', toolId: toolCall.id });
}

export function appendUniqueChunk(chunks: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (chunks[chunks.length - 1] === trimmed) return;
  chunks.push(trimmed);
}

export function replaceLatestChunk(chunks: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  chunks.length = 0;
  chunks.push(trimmed);
}

export function appendUserChunk(turn: CodexTurnState, value: string, timestamp: number): void {
  const chunkCountBefore = turn.userChunks.length;
  appendUniqueChunk(turn.userChunks, value);

  if (turn.userChunks.length > chunkCountBefore && !turn.userTimestamp && timestamp > 0) {
    turn.userTimestamp = timestamp;
  }
}

export function findPersistedToolCallById(ctx: PersistedParseContext, callId: string): ToolCallInfo | null {
  const origin = ctx.toolCallToTurn.get(callId);
  if (!origin) {
    return null;
  }

  const turn = ctx.turns.get(origin.turnId);
  if (!turn || origin.bubbleIndex >= turn.assistantBubbles.length) {
    return null;
  }

  return turn.assistantBubbles[origin.bubbleIndex].toolCalls.find(tool => tool.id === callId) ?? null;
}

// ---------------------------------------------------------------------------
// Legacy TurnAccumulator — kept for the `event` wrapper format
// ---------------------------------------------------------------------------

export interface TurnAccumulator {
  assistantText: string;
  thinkingText: string;
  toolCalls: ToolCallInfo[];
  contentBlocks: ContentBlock[];
  interrupted: boolean;
  timestamp: number;
}

export function newTurn(timestamp = 0): TurnAccumulator {
  return {
    assistantText: '',
    thinkingText: '',
    toolCalls: [],
    contentBlocks: [],
    interrupted: false,
    timestamp,
  };
}

export function flushTurn(turn: TurnAccumulator, messages: ChatMessage[], msgIndex: number): number {
  if (
    !turn.assistantText &&
    !turn.thinkingText &&
    turn.toolCalls.length === 0
  ) {
    return msgIndex;
  }

  const msg: ChatMessage = {
    id: `codex-msg-${msgIndex}`,
    role: 'assistant',
    content: turn.assistantText,
    timestamp: turn.timestamp || Date.now(),
    toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
    contentBlocks: turn.contentBlocks.length > 0 ? turn.contentBlocks : undefined,
  };

  if (turn.interrupted) {
    msg.isInterrupt = true;
  }

  messages.push(msg);
  return msgIndex + 1;
}

export function setTextBlock(turn: TurnAccumulator, content: string): void {
  const index = turn.contentBlocks.findIndex(block => block.type === 'text');
  if (index === -1) {
    turn.contentBlocks.push({ type: 'text', content });
    return;
  }

  turn.contentBlocks[index] = { type: 'text', content };
}

export function setThinkingBlock(turn: TurnAccumulator, content: string): void {
  const normalized = content.trim();
  if (!normalized) {
    return;
  }

  turn.thinkingText = normalized;

  const index = turn.contentBlocks.findIndex(block => block.type === 'thinking');
  if (index === -1) {
    turn.contentBlocks.push({ type: 'thinking', content: normalized });
    return;
  }

  turn.contentBlocks[index] = { type: 'thinking', content: normalized };
}
