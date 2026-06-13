import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import {
  isCodexToolOutputError,
  normalizeCodexMcpToolInput,
  normalizeCodexMcpToolName,
  normalizeCodexMcpToolState,
  normalizeCodexToolInput,
  normalizeCodexToolName,
  normalizeCodexToolResult,
  parseCodexArguments,
} from '../normalization/codexToolNormalization';
import { flushBubbleTurnMessages } from './codexBubbleFlush';
import { type PersistedEventPayload,processEventMsg } from './codexEventMsg';
import type { CodexItem } from './codexLegacyItemMapping';
import {
  processLegacyItem,
  processLegacyItemInModernContext,
} from './codexLegacyItemMapping';
import {
  type PersistedItemTextExtractors,
  processPersistedMessagePayload,
  processPersistedReasoningPayload,
} from './codexPersistedItems';
import type { CodexTurnState, PersistedParseContext } from './codexTurnState';
import {
  closeAssistantBubble,
  createPersistedParseContext,
  ensureAssistantBubble,
  ensureTurn,
  findPersistedToolCallById,
  flushTurn,
  newTurn,
  nextTurnId,
  pushToolInvocation,
} from './codexTurnState';

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
  error?: { message: string };
  message?: string;
}

interface PersistedMessagePart {
  type?: string;
  text?: string;
}

interface PersistedMessagePayload {
  type: 'message';
  role?: string;
  content?: PersistedMessagePart[];
}

interface PersistedReasoningPayload {
  type: 'reasoning';
  summary?: Array<{ type?: string; text?: string } | string>;
  content?: Array<{ type?: string; text?: string } | string>;
  text?: string;
}

interface PersistedToolCallPayload {
  type: 'function_call' | 'custom_tool_call';
  name?: string;
  arguments?: string;
  call_id?: string;
  input?: string;
}

interface PersistedToolCallOutputPayload {
  type: 'function_call_output' | 'custom_tool_call_output';
  call_id?: string;
  output?: string | unknown[];
}

interface PersistedWebSearchCallPayload {
  type: 'web_search_call';
  action?: {
    type?: string;
    query?: string;
    queries?: string[];
    url?: string;
    pattern?: string;
  };
  status?: string;
  call_id?: string;
}

interface PersistedMcpToolCallPayload {
  type: 'mcp_tool_call';
  server?: string;
  tool?: string;
  call_id?: string;
  status?: string;
  arguments?: string | Record<string, unknown>;
  result?: { content?: Array<{ type?: string; text?: string }> } | null;
  error?: string | null;
  duration_ms?: number | null;
}

interface PersistedCompactionPayload {
  type: 'compaction';
  encrypted_content?: string;
}

interface PersistedCompactedPayload {
  message?: string;
  replacement_history?: PersistedPayload[];
}

interface ParsedSessionRecord {
  timestamp: number;
  type?: string;
  event?: CodexEvent;
  payload?: PersistedPayload;
}

type PersistedPayload =
  | PersistedMessagePayload
  | PersistedReasoningPayload
  | PersistedToolCallPayload
  | PersistedToolCallOutputPayload
  | PersistedWebSearchCallPayload
  | PersistedMcpToolCallPayload
  | PersistedCompactionPayload
  | PersistedEventPayload
  | undefined;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSessionRecord(line: string): ParsedSessionRecord | null {
  let parsed: {
    timestamp?: string;
    type?: string;
    event?: CodexEvent;
    payload?: PersistedPayload;
  };

  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }

  return {
    timestamp: parseTimestamp(parsed.timestamp),
    type: parsed.type,
    event: parsed.event,
    payload: parsed.payload,
  };
}

const CODEX_SYSTEM_MESSAGE_PREFIXES = [
  '# AGENTS.md instructions',
  '<environment_context>',
  '<subagent_notification>',
  '<skill>',
];

const CODEX_BRACKET_CONTEXT_PATTERN = /\n\[(?:Current note|Editor selection from|Browser selection from|Canvas selection from)\b/;

function isCodexSystemMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return CODEX_SYSTEM_MESSAGE_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

function extractCodexDisplayContent(text: string): string | undefined {
  if (!text) return undefined;

  const bracketMatch = text.match(CODEX_BRACKET_CONTEXT_PATTERN);
  if (bracketMatch?.index !== undefined) {
    return text.substring(0, bracketMatch.index).trim();
  }

  return undefined;
}

function extractMessageText(content: PersistedMessagePart[] | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function joinTextParts(parts: Array<{ text?: string } | string>): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    })
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function extractReasoningText(payload: PersistedReasoningPayload | PersistedEventPayload): string {
  if ('summary' in payload && Array.isArray(payload.summary) && payload.summary.length > 0) {
    return joinTextParts(payload.summary);
  }

  if ('content' in payload && Array.isArray(payload.content) && payload.content.length > 0) {
    return joinTextParts(payload.content);
  }

  return typeof payload.text === 'string' ? payload.text.trim() : '';
}

// Text extraction stays owned here; the persisted message/reasoning handlers in
// codexPersistedItems.ts receive these so that module never imports the store.
const persistedItemTextExtractors: PersistedItemTextExtractors = {
  extractMessageText: (content) => extractMessageText(content as PersistedMessagePart[] | undefined),
  isCodexSystemMessage,
  extractReasoningText: (payload) =>
    extractReasoningText(payload as PersistedReasoningPayload | PersistedEventPayload),
};

// ---------------------------------------------------------------------------
// Persisted-format (response_item) processing — with bubble model
// ---------------------------------------------------------------------------

function processPersistedToolCall(
  payload: PersistedToolCallPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  if (payload.name === 'write_stdin') {
    const parsedArgs = parseCodexArguments(payload.arguments ?? payload.input);
    if (isSilentWriteStdinInput(parsedArgs)) {
      const terminalSessionId = readTerminalSessionIdArgument(parsedArgs);
      const parentCallId = terminalSessionId
        ? ctx.terminalSessionToCommandId.get(terminalSessionId)
        : undefined;
      if (parentCallId) {
        ctx.stdinCallToCommandId.set(callId, parentCallId);
      }
      ctx.suppressedToolOutputIds.add(callId);
      return;
    }
  }

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);

  const rawArgs = payload.arguments ?? payload.input;
  const parsedArgs = parseCodexArguments(rawArgs);
  const normalizedName = normalizeCodexToolName(payload.name);
  const normalizedInput = normalizeCodexToolInput(payload.name, parsedArgs);

  const toolCall: ToolCallInfo = {
    id: callId,
    name: normalizedName,
    input: normalizedInput,
    status: 'running',
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.activeBubbleIndex!,
  });
}

function processPersistedToolOutput(
  payload: PersistedToolCallOutputPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  // output can be a string or an array (e.g. view_image returns image objects)
  const rawOutput = typeof payload.output === 'string'
    ? payload.output
    : Array.isArray(payload.output)
      ? JSON.stringify(payload.output)
      : '';

  const parentCommandId = ctx.stdinCallToCommandId.get(callId);
  if (parentCommandId) {
    const parentToolCall = findPersistedToolCallById(ctx, parentCommandId);
    if (parentToolCall) {
      applyPersistedToolOutput(parentToolCall, payload.output, rawOutput, ctx, {
        allowImplicitCommandCompletion: false,
      });
    }
    ctx.stdinCallToCommandId.delete(callId);
    ctx.suppressedToolOutputIds.delete(callId);
    return;
  }

  if (ctx.suppressedToolOutputIds.delete(callId)) {
    return;
  }

  // Cross-turn resolution: look up where the tool call was originally pushed
  const origin = ctx.toolCallToTurn.get(callId);
  if (origin) {
    const originTurn = ctx.turns.get(origin.turnId);
    if (originTurn && origin.bubbleIndex < originTurn.assistantBubbles.length) {
      const originBubble = originTurn.assistantBubbles[origin.bubbleIndex];
      const existing = originBubble.toolCalls.find(tool => tool.id === callId);
      if (existing) {
        applyPersistedToolOutput(existing, payload.output, rawOutput, ctx);
        return;
      }
    }
  }

  if (payload.type === 'custom_tool_call_output') {
    return;
  }

  // Fallback: push orphan entry into current turn
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  const normalizedResult = normalizeCodexToolResult('tool', rawOutput);

  pushToolInvocation(bubble, {
    id: callId,
    name: 'tool',
    input: {},
    status: isCodexToolOutputError(rawOutput) ? 'error' : 'completed',
    result: normalizedResult,
  });
}

function readTerminalSessionIdArgument(input: Record<string, unknown>): string | undefined {
  const value = input.session_id ?? input.sessionId;
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isSilentWriteStdinInput(input: Record<string, unknown>): boolean {
  return typeof input.chars !== 'string' || input.chars.length === 0;
}

function appendCommandOutput(previous: string | undefined, next: string): string {
  if (!next) return previous ?? '';
  if (!previous) return next;
  if (previous.endsWith('\n') || next.startsWith('\n')) return previous + next;
  return `${previous}\n${next}`;
}

function readPersistedCommandToolResult(rawOutputText: string): {
  output: string;
  status: 'running' | 'completed' | 'unknown';
  exitCode?: number;
  terminalSessionId?: string;
} {
  const output = normalizeCodexToolResult('Bash', rawOutputText);
  const exitCodeMatch = rawOutputText.match(/(?:Exit code:|Process exited with code)\s*(-?\d+)/i);
  const runningMatch = rawOutputText.match(/Process running with session ID\s*([^\n]+)/i);

  return {
    output,
    status: exitCodeMatch ? 'completed' : runningMatch ? 'running' : 'unknown',
    ...(exitCodeMatch ? { exitCode: Number(exitCodeMatch[1] ?? 0) } : {}),
    ...(runningMatch ? { terminalSessionId: (runningMatch[1] ?? '').trim() } : {}),
  };
}

function applyPersistedToolOutput(
  toolCall: ToolCallInfo,
  rawOutputValue: string | unknown[] | undefined,
  rawOutputText: string,
  ctx: PersistedParseContext,
  options: { allowImplicitCommandCompletion?: boolean } = {},
): void {
  if (toolCall.name === 'Bash') {
    const commandResult = readPersistedCommandToolResult(rawOutputText);
    toolCall.result = appendCommandOutput(toolCall.result, commandResult.output);
    if (commandResult.terminalSessionId) {
      ctx.terminalSessionToCommandId.set(commandResult.terminalSessionId, toolCall.id);
    }
    if (commandResult.status === 'running') {
      toolCall.status = 'running';
      return;
    }
    if (commandResult.status === 'unknown' && options.allowImplicitCommandCompletion === false) {
      return;
    }
    toolCall.status = commandResult.exitCode !== undefined
      ? commandResult.exitCode === 0 ? 'completed' : 'error'
      : isCodexToolOutputError(rawOutputText) ? 'error' : 'completed';
    return;
  }

  toolCall.result = normalizePersistedToolOutput(toolCall, rawOutputValue, rawOutputText);
  toolCall.status = isCodexToolOutputError(rawOutputText) ? 'error' : 'completed';
}

function normalizePersistedToolOutput(
  toolCall: ToolCallInfo,
  rawOutputValue: string | unknown[] | undefined,
  rawOutputText: string,
): string {
  if (Array.isArray(rawOutputValue) && toolCall.name === 'Read') {
    const filePath = toolCall.input.file_path;
    if (typeof filePath === 'string' && filePath) {
      return filePath;
    }
  }

  return normalizeCodexToolResult(toolCall.name, rawOutputText);
}

function processPersistedWebSearchCall(
  payload: PersistedWebSearchCallPayload,
  timestamp: number,
  lineIndex: number,
  ctx: PersistedParseContext,
): void {
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);

  // Persisted web_search_call entries commonly omit call_id. Use transcript line index
  // so live tailing and history reload reconstruct the same visible tool sequence.
  const callId = payload.call_id || `tail-ws-${lineIndex}`;

  if (bubble.toolIndexesById.has(callId)) return;

  const input = normalizeCodexToolInput('web_search_call', {
    action: payload.action ?? {},
  });

  const isTerminal = payload.status === 'completed' || payload.status === 'failed'
    || payload.status === 'error' || payload.status === 'cancelled';

  const toolCall: ToolCallInfo = {
    id: callId,
    name: 'WebSearch',
    input,
    status: isTerminal ? (payload.status === 'completed' ? 'completed' : 'error') : 'running',
    ...(isTerminal ? { result: 'Search complete' } : {}),
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.assistantBubbles.indexOf(bubble),
  });
}

function processPersistedMcpToolCall(
  payload: PersistedMcpToolCallPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);

  if (bubble.toolIndexesById.has(callId)) return;

  const normalizedInput = normalizeCodexMcpToolInput(payload.arguments);
  const normalizedState = normalizeCodexMcpToolState(payload.status, payload.result, payload.error);

  const toolCall: ToolCallInfo = {
    id: callId,
    name: normalizeCodexMcpToolName(payload.server, payload.tool),
    input: normalizedInput,
    status: normalizedState.status,
    ...(normalizedState.result ? { result: normalizedState.result } : {}),
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.activeBubbleIndex!,
  });
}

// Dispatch by persisted-item type instead of a switch so the fan-out stays flat
// (low cyclomatic). Types absent from the table — e.g. `compaction` — are no-ops,
// matching the original switch's empty/`default` arms.
type PersistedPayloadHandler = (
  payload: PersistedPayload,
  timestamp: number,
  lineIndex: number,
  ctx: PersistedParseContext,
) => void;

const PERSISTED_PAYLOAD_HANDLERS: Record<string, PersistedPayloadHandler> = {
  message: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedMessagePayload(payload as PersistedMessagePayload, timestamp, ctx, persistedItemTextExtractors),
  reasoning: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedReasoningPayload(payload as PersistedReasoningPayload, timestamp, ctx, persistedItemTextExtractors),
  function_call: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedToolCall(payload as PersistedToolCallPayload, timestamp, ctx),
  custom_tool_call: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedToolCall(payload as PersistedToolCallPayload, timestamp, ctx),
  function_call_output: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedToolOutput(payload as PersistedToolCallOutputPayload, timestamp, ctx),
  custom_tool_call_output: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedToolOutput(payload as PersistedToolCallOutputPayload, timestamp, ctx),
  web_search_call: (payload, timestamp, lineIndex, ctx) =>
    processPersistedWebSearchCall(payload as PersistedWebSearchCallPayload, timestamp, lineIndex, ctx),
  mcp_tool_call: (payload, timestamp, _lineIndex, ctx) =>
    processPersistedMcpToolCall(payload as PersistedMcpToolCallPayload, timestamp, ctx),
};

function processPersistedPayload(
  payload: PersistedPayload,
  timestamp: number,
  lineIndex: number,
  ctx: PersistedParseContext,
): void {
  const handler = payload?.type ? PERSISTED_PAYLOAD_HANDLERS[payload.type] : undefined;
  handler?.(payload, timestamp, lineIndex, ctx);
}

function applyCompactedReplacementHistory(
  payload: PersistedCompactedPayload | undefined,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  ctx.turns.clear();
  ctx.turnOrder.length = 0;
  ctx.currentTurnId = null;
  ctx.toolCallToTurn.clear();
  ctx.suppressedToolOutputIds.clear();
  ctx.terminalSessionToCommandId.clear();
  ctx.stdinCallToCommandId.clear();
  ctx.turnCounter = 0;

  const replacementHistory = Array.isArray(payload?.replacement_history)
    ? payload.replacement_history
    : [];

  for (const [index, item] of replacementHistory.entries()) {
    processPersistedPayload(item, timestamp + index, index, ctx);
  }

  if (ctx.currentTurnId) {
    const turn = ctx.turns.get(ctx.currentTurnId);
    if (turn) {
      closeAssistantBubble(turn);
    }
    ctx.currentTurnId = null;
  }
}



// ---------------------------------------------------------------------------
// Session file discovery
// ---------------------------------------------------------------------------

const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function getPathModuleForSessionPath(sessionPath: string): typeof path.posix {
  return sessionPath.includes('\\') || /^[A-Za-z]:/.test(sessionPath)
    ? path.win32
    : path.posix;
}

export function deriveCodexSessionsRootFromSessionPath(
  sessionFilePath: string | null | undefined,
): string | null {
  if (!sessionFilePath) {
    return null;
  }

  const pathModule = getPathModuleForSessionPath(sessionFilePath);
  let current = pathModule.dirname(pathModule.normalize(sessionFilePath));
  let previous: string | null = null;

  while (current && current !== previous) {
    if (pathModule.basename(current).toLowerCase() === 'sessions') {
      return current;
    }
    previous = current;
    current = pathModule.dirname(current);
  }

  return null;
}

export function deriveCodexMemoriesDirFromSessionsRoot(
  sessionsDir: string | null | undefined,
): string | null {
  if (!sessionsDir) {
    return null;
  }

  const pathModule = getPathModuleForSessionPath(sessionsDir);
  return pathModule.join(pathModule.dirname(sessionsDir), 'memories');
}

export function findCodexSessionFile(
  threadId: string,
  root: string = path.join(os.homedir(), '.codex', 'sessions'),
): string | null {
  if (!threadId || !SAFE_SESSION_ID_PATTERN.test(threadId) || !fs.existsSync(root)) {
    return null;
  }

  const directPath = path.join(root, `${threadId}.jsonl`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
        return fullPath;
      }
    }
  }

  return null;
}

export function parseCodexSessionFile(filePath: string): ChatMessage[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  return parseCodexSessionContent(content);
}

export interface CodexParsedTurn {
  turnId: string | null;
  messages: ChatMessage[];
}

export function parseCodexSessionContent(content: string): ChatMessage[] {
  const turns = parseCodexSessionTurns(content);
  return turns.flatMap(t => t.messages);
}

export function parseCodexSessionTurns(content: string): CodexParsedTurn[] {
  const records = content
    .split('\n')
    .filter(line => line.trim())
    .map(parseSessionRecord)
    .filter((record): record is ParsedSessionRecord => record !== null);

  // Detect format: legacy uses type=event, modern uses event_msg/response_item
  let hasLegacy = false;
  let hasModern = false;
  for (const record of records) {
    if (record.type === 'event') hasLegacy = true;
    else if (record.type === 'event_msg' || record.type === 'response_item' || record.type === 'compacted') hasModern = true;
    if (hasLegacy && hasModern) break;
  }

  // Pure legacy sessions use the old flat accumulator (no turn-level structure)
  if (hasLegacy && !hasModern) {
    const messages = parseLegacySession(records);
    return messages.length > 0 ? [{ turnId: null, messages }] : [];
  }

  // Modern or mixed sessions use the bubble model with turn-level grouping
  return parseModernSessionTurns(records);
}

// ---------------------------------------------------------------------------
// Legacy (event wrapper) parser — preserved for backward compat
// ---------------------------------------------------------------------------

function parseLegacySession(records: ParsedSessionRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let turn = newTurn();
  let msgIndex = 0;

  for (const parsed of records) {
    if (parsed.type === 'event' && parsed.event) {
      const event = parsed.event;

      switch (event.type) {
        case 'turn.started':
          if (turn.assistantText || turn.thinkingText || turn.toolCalls.length > 0) {
            msgIndex = flushTurn(turn, messages, msgIndex);
          }
          turn = newTurn();
          break;

        case 'item.started':
        case 'item.updated':
        case 'item.completed':
          if (event.item) {
            processLegacyItem(event.type, event.item, turn);
          }
          break;

        case 'turn.completed':
          msgIndex = flushTurn(turn, messages, msgIndex);
          turn = newTurn();
          break;

        case 'turn.failed':
          turn.interrupted = true;
          msgIndex = flushTurn(turn, messages, msgIndex);
          turn = newTurn();
          break;

        default:
          break;
      }
    }
  }

  flushTurn(turn, messages, msgIndex);
  return messages;
}

// ---------------------------------------------------------------------------
// Modern (response_item + event_msg) parser — bubble model
// ---------------------------------------------------------------------------

function parseModernSessionTurns(records: ParsedSessionRecord[]): CodexParsedTurn[] {
  const ctx = createPersistedParseContext();

  for (const [lineIndex, parsed] of records.entries()) {
    const timestamp = parsed.timestamp;

    // Legacy event records can appear in mixed sessions
    if (parsed.type === 'event' && parsed.event) {
      processLegacyEventInModernContext(parsed.event, timestamp, ctx);
      continue;
    }

    if (parsed.type === 'event_msg') {
      processEventMsg(parsed.payload as PersistedEventPayload, timestamp, ctx, { extractReasoningText });
      continue;
    }

    if (parsed.type === 'compacted') {
      applyCompactedReplacementHistory(parsed.payload as PersistedCompactedPayload | undefined, timestamp, ctx);
      continue;
    }

    if (parsed.type === 'response_item') {
      processPersistedPayload(parsed.payload, timestamp, lineIndex, ctx);
    }
  }

  return flushBubbleTurnsGrouped(ctx.turns, ctx.turnOrder);
}

function flushBubbleTurnsGrouped(
  turns: Map<string, CodexTurnState>,
  turnOrder: string[],
): CodexParsedTurn[] {
  const result: CodexParsedTurn[] = [];
  let messageOffset = 0;

  for (const turnId of turnOrder) {
    const turn = turns.get(turnId);
    if (!turn) continue;
    const { messages: turnMessages, nextMsgIndex } = flushBubbleTurnMessages(turn, messageOffset, {
      extractCodexDisplayContent,
      isCodexSystemMessage,
    });
    if (turnMessages.length === 0) continue;
    messageOffset = nextMsgIndex;

    result.push({
      turnId: turn.serverTurnId ?? null,
      messages: turnMessages,
    });
  }

  return result;
}

function processLegacyEventInModernContext(
  event: CodexEvent,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  switch (event.type) {
    case 'turn.started': {
      if (ctx.currentTurnId) {
        const previousTurn = ctx.turns.get(ctx.currentTurnId);
        if (previousTurn) {
          closeAssistantBubble(previousTurn);
        }
      }
      const id = nextTurnId(ctx);
      ensureTurn(ctx.turns, ctx.turnOrder, id, null, timestamp);
      ctx.currentTurnId = id;
      break;
    }

    case 'turn.completed': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) closeAssistantBubble(turn);
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'turn.failed': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) {
          const bubble = ensureAssistantBubble(turn, timestamp);
          bubble.interrupted = true;
          closeAssistantBubble(turn);
        }
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      if (event.item) {
        processLegacyItemInModernContext(event.type, event.item, timestamp, ctx);
      }
      break;

    default:
      break;
  }
}
