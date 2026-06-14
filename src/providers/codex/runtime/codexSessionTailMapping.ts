import { buildUsageInfo as sharedBuildUsageInfo } from '../../../core/providers/usage';
import type { StreamChunk } from '../../../core/types/chat';
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
import type { SessionTailState } from './codexSessionTailState';
import {
  emitDelta,
  extractResponseItemMessageText,
  extractResponseItemReasoningText,
  getNonEmptyString,
  isRecord,
  numericField,
  resolveTurnId,
  stringifyPayloadValue,
} from './codexSessionTailState';

// ---------------------------------------------------------------------------
// event_msg handler
// ---------------------------------------------------------------------------

export function mapEventMsgEvent(
  payload: Record<string, unknown>,
  sessionId: string,
  state: SessionTailState,
): StreamChunk[] {
  const payloadType = payload.type as string | undefined;
  const info = isRecord(payload.info) ? payload.info : {};

  switch (payloadType) {
    case 'task_started':
      return mapTaskStarted(payload, info, state);
    case 'task_complete':
      return mapTaskComplete(sessionId, state);
    case 'turn_aborted':
      return mapTurnAborted(state);
    case 'agent_message':
      return mapAgentMessage(payload, state);
    case 'agent_reasoning':
      return mapAgentReasoning(payload, state);
    case 'token_count':
      return mapTokenCount(info, state);
    default:
      return mapEnrichmentEventMsg(payloadType, payload, state);
  }
}

function mapEnrichmentEventMsg(
  payloadType: string | undefined,
  payload: Record<string, unknown>,
  state: SessionTailState,
): StreamChunk[] {
  switch (payloadType) {
    case 'exec_command_end':
      return mapExecCommandEnd(payload, state);
    case 'patch_apply_end':
      return mapPatchApplyEnd(payload, state);
    case 'mcp_tool_call_end':
      return mapMcpToolCallEnd(payload, state);
    default:
      // user_message, web_search_end, view_image_tool_call, and the collab_*
      // lifecycle events carry nothing to render.
      return [];
  }
}

function mapTaskStarted(
  payload: Record<string, unknown>,
  info: Record<string, unknown>,
  state: SessionTailState,
): StreamChunk[] {
  const turnId = getNonEmptyString(
    info.id,
    getNonEmptyString(payload.turn_id, `synthetic-turn-${state.syntheticTurnCounter++}`),
  );
  state.currentTurnId = turnId;
  state.modelContextWindowIsAuthoritative = false;
  if (typeof payload.model_context_window === 'number' && payload.model_context_window > 0) {
    state.modelContextWindow = payload.model_context_window;
    state.modelContextWindowIsAuthoritative = true;
  }
  return [];
}

function buildPendingUsageChunk(
  state: SessionTailState,
  turnId: string,
  sessionId: string,
): StreamChunk | null {
  const pending = state.pendingUsageByTurn.get(turnId);
  const model = state.getActiveModel?.().trim() ?? '';
  if (!pending || !model) {
    return null;
  }

  // Route through the shared builder so every emitted UsageInfo
  // satisfies the cross-provider contract matrix (model truthy,
  // percentage clamped, optional fields finite/non-negative).
  const usage = sharedBuildUsageInfo({
    model,
    inputTokens: pending.inputTokens,
    outputTokens: pending.outputTokens > 0 ? pending.outputTokens : undefined,
    reasoningOutputTokens: pending.reasoningOutputTokens > 0 ? pending.reasoningOutputTokens : undefined,
    cacheReadInputTokens: pending.cacheReadInputTokens > 0 ? pending.cacheReadInputTokens : undefined,
    contextTokens: pending.contextTokens,
    contextWindow: pending.contextWindow,
    contextWindowIsAuthoritative: pending.contextWindowIsAuthoritative,
  });
  return { type: 'usage', usage, sessionId };
}

function mapTaskComplete(sessionId: string, state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const chunks: StreamChunk[] = [];

  if (!state.emittedUsageByTurn.has(turnId)) {
    const usageChunk = buildPendingUsageChunk(state, turnId, sessionId);
    if (usageChunk) {
      chunks.push(usageChunk);
      state.emittedUsageByTurn.add(turnId);
    }
  }

  if (!state.emittedDoneByTurn.has(turnId)) {
    chunks.push({ type: 'done' });
    state.emittedDoneByTurn.add(turnId);
  }

  return chunks;
}

function mapTurnAborted(state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const chunks: StreamChunk[] = [];

  if (!state.emittedDoneByTurn.has(turnId)) {
    chunks.push({ type: 'done' });
    state.emittedDoneByTurn.add(turnId);
  }

  return chunks;
}

function mapAgentMessage(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const fullText = typeof payload.text === 'string'
    ? payload.text
    : typeof payload.message === 'string'
      ? payload.message
      : '';
  return emitDelta(fullText, state.lastTextByTurn, turnId, 'text');
}

function mapAgentReasoning(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const fullText = typeof payload.text === 'string' ? payload.text : '';
  return emitDelta(fullText, state.lastThinkingByTurn, turnId, 'thinking');
}

function mapTokenCount(info: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const lastTokenUsage = isRecord(info.last_token_usage) ? info.last_token_usage : {};
  const inputTokens = numericField(lastTokenUsage, ['input_tokens', 'input']) ?? 0;
  const cachedInputTokens = numericField(lastTokenUsage, ['cached_input_tokens', 'cached_input']) ?? 0;
  const outputTokens = numericField(lastTokenUsage, ['output_tokens', 'output']) ?? 0;
  const reasoningOutputTokens = numericField(lastTokenUsage, ['reasoning_output_tokens', 'reasoning_output']) ?? 0;
  // contextTokens = input + output + reasoning. cached_input_tokens is part of input_tokens
  // on the wire, so do NOT add it again.
  const contextTokens = inputTokens + outputTokens + reasoningOutputTokens;

  state.pendingUsageByTurn.set(turnId, {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadInputTokens: cachedInputTokens,
    contextTokens,
    contextWindow: state.modelContextWindow,
    contextWindowIsAuthoritative: state.modelContextWindowIsAuthoritative,
  });
  return [];
}

function mapExecCommandEnd(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
  if (callId) {
    const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code : undefined;
    state.callEnrichment.set(callId, {
      ...state.callEnrichment.get(callId),
      exitCode,
    });
  }
  return [];
}

function mapPatchApplyEnd(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
  if (callId && typeof payload.success === 'boolean' && !payload.success) {
    state.callEnrichment.set(callId, {
      ...state.callEnrichment.get(callId),
      exitCode: 1,
    });
  }
  return [];
}

function mapMcpToolCallEnd(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
  const invocation = isRecord(payload.invocation) ? payload.invocation : {};
  if (callId && typeof invocation.server === 'string' && typeof invocation.tool === 'string') {
    state.callEnrichment.set(callId, {
      ...state.callEnrichment.get(callId),
      mcpServer: invocation.server,
      mcpTool: invocation.tool,
    });
    // Update the known call's tool name so the tool_result uses the MCP-prefixed name
    const known = state.responseItemState.knownCalls.get(callId);
    if (known) {
      known.toolName = `mcp__${invocation.server}__${invocation.tool}`;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// response_item handler
// ---------------------------------------------------------------------------

export function mapResponseItemEvent(
  event: Record<string, unknown>,
  sessionId: string,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const payload = isRecord(event.payload) ? event.payload : {};
  const payloadType = payload.type as string | undefined;

  switch (payloadType) {
    case 'message':
      return mapResponseItemMessage(payload, state);
    case 'reasoning':
      return mapResponseItemReasoning(payload, state);
    case 'function_call':
    case 'custom_tool_call':
      return mapResponseItemToolCall(payload, lineIndex, state);
    case 'web_search_call':
      return mapResponseItemWebSearchCall(payload, lineIndex, state);
    case 'mcp_tool_call':
      return mapResponseItemMcpToolCall(payload, lineIndex, state);
    case 'function_call_output':
    case 'custom_tool_call_output':
      return mapResponseItemToolOutput(payload, lineIndex, state);
    default:
      return [];
  }
}

function mapResponseItemMessage(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  if (payload.role !== 'assistant') return [];

  const turnId = resolveTurnId(state, undefined);
  const fullText = extractResponseItemMessageText(payload.content);
  return emitDelta(fullText, state.lastTextByTurn, turnId, 'text');
}

function mapResponseItemReasoning(payload: Record<string, unknown>, state: SessionTailState): StreamChunk[] {
  const turnId = resolveTurnId(state, undefined);
  const fullText = extractResponseItemReasoningText(payload);
  return emitDelta(fullText, state.lastThinkingByTurn, turnId, 'thinking');
}

/**
 * Claims a response-item call id for first emission: returns the resolved id, or
 * null when this tail line's tool_use was already emitted (so the caller skips
 * re-emitting). Shared by the function-call and web-search-call mappers.
 */
function claimResponseItemCallId(
  payload: Record<string, unknown>,
  lineIndex: number,
  state: SessionTailState,
  fallbackPrefix: string,
): string | null {
  const riState = state.responseItemState;
  const callId = getNonEmptyString(payload.call_id, `${fallbackPrefix}-${lineIndex}`);
  if (riState.emittedToolUseIds.has(callId)) return null;
  riState.emittedToolUseIds.add(callId);
  return callId;
}

function mapResponseItemToolCall(
  payload: Record<string, unknown>,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const callId = claimResponseItemCallId(payload, lineIndex, state, 'tail-call');
  if (callId === null) return [];
  const riState = state.responseItemState;

  const rawName = typeof payload.name === 'string' ? payload.name : undefined;
  const rawArgs = typeof payload.arguments === 'string'
    ? payload.arguments
    : typeof payload.input === 'string'
      ? payload.input
      : undefined;
  const parsedArgs = parseCodexArguments(rawArgs);

  // Use MCP enrichment if available (mcp_tool_call_end may arrive before function_call)
  const enrichment = state.callEnrichment.get(callId);
  const normalizedName = enrichment?.mcpServer && enrichment?.mcpTool
    ? `mcp__${enrichment.mcpServer}__${enrichment.mcpTool}`
    : normalizeCodexToolName(rawName);
  const normalizedInput = normalizeCodexToolInput(rawName, parsedArgs);

  riState.knownCalls.set(callId, { toolName: normalizedName, toolInput: normalizedInput });

  return [{
    type: 'tool_use',
    id: callId,
    name: normalizedName,
    input: normalizedInput,
  }];
}

function mapResponseItemWebSearchCall(
  payload: Record<string, unknown>,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const callId = claimResponseItemCallId(payload, lineIndex, state, 'tail-ws');
  if (callId === null) return [];
  const riState = state.responseItemState;

  const input = normalizeCodexToolInput('web_search_call', {
    action: payload.action ?? {},
  });

  riState.knownCalls.set(callId, { toolName: 'WebSearch', toolInput: input });

  const chunks: StreamChunk[] = [{
    type: 'tool_use',
    id: callId,
    name: 'WebSearch',
    input,
  }];

  // Persisted web_search_call includes final status — emit tool_result immediately
  if (payload.status) {
    riState.emittedToolResultIds.add(callId);
    chunks.push({
      type: 'tool_result',
      id: callId,
      content: 'Search complete',
      isError: payload.status === 'failed' || payload.status === 'error',
    });
  }

  return chunks;
}

function mapResponseItemMcpToolCall(
  payload: Record<string, unknown>,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const riState = state.responseItemState;
  const callId = getNonEmptyString(payload.call_id, `tail-mcp-${lineIndex}`);
  const normalizedName = normalizeCodexMcpToolName(payload.server, payload.tool);
  const normalizedInput = normalizeCodexMcpToolInput(payload.arguments);
  const normalizedState = normalizeCodexMcpToolState(payload.status, payload.result, payload.error);
  const chunks: StreamChunk[] = [];

  riState.knownCalls.set(callId, { toolName: normalizedName, toolInput: normalizedInput });

  if (!riState.emittedToolUseIds.has(callId)) {
    riState.emittedToolUseIds.add(callId);
    chunks.push({
      type: 'tool_use',
      id: callId,
      name: normalizedName,
      input: normalizedInput,
    });
  }

  if (normalizedState.isTerminal && !riState.emittedToolResultIds.has(callId)) {
    riState.emittedToolResultIds.add(callId);
    chunks.push({
      type: 'tool_result',
      id: callId,
      content: normalizedState.result ?? (normalizedState.isError ? 'Failed' : 'Completed'),
      isError: normalizedState.isError,
    });
  }

  return chunks;
}

function mapResponseItemToolOutput(
  payload: Record<string, unknown>,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const riState = state.responseItemState;
  const callId = getNonEmptyString(payload.call_id, `tail-out-${lineIndex}`);
  if (riState.emittedToolResultIds.has(callId)) return [];
  riState.emittedToolResultIds.add(callId);

  const known = riState.knownCalls.get(callId);
  const normalizedName = known?.toolName ?? 'tool';
  const enrichment = state.callEnrichment.get(callId);

  // Image content: view_image returns array of {type: "input_image", image_url: "data:..."}
  if (Array.isArray(payload.output)) {
    return [{
      type: 'tool_result',
      id: callId,
      content: readImageOutputPath(known?.toolInput),
      isError: false,
    }];
  }

  const rawOutput = typeof payload.output === 'string' ? payload.output : stringifyPayloadValue(payload.output);
  const content = normalizeCodexToolResult(normalizedName, rawOutput);

  // Prefer enrichment exit_code over regex-based error detection
  const isError = enrichment?.exitCode !== undefined
    ? enrichment.exitCode !== 0
    : isCodexToolOutputError(rawOutput);

  return [{
    type: 'tool_result',
    id: callId,
    content,
    isError,
  }];
}

function readImageOutputPath(toolInput: unknown): string {
  const filePath = isRecord(toolInput) ? toolInput.file_path : undefined;
  return typeof filePath === 'string' ? filePath : 'Image loaded';
}
