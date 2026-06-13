import { isSubagentToolName, TOOL_TASK } from '../../../core/tools/toolNames';
import type {
  AsyncSubagentStatus,
  ChatMessage,
  SubagentInfo,
  ToolCallInfo,
} from '../../../core/types';
import { loadSubagentToolCalls } from './ClaudeHistoryStore';

function chooseRicherResult(sdkResult?: string, cachedResult?: string): string | undefined {
  const sdkText = typeof sdkResult === 'string' ? sdkResult.trim() : '';
  const cachedText = typeof cachedResult === 'string' ? cachedResult.trim() : '';

  if (sdkText.length === 0 && cachedText.length === 0) return undefined;
  if (sdkText.length === 0) return cachedResult;
  if (cachedText.length === 0) return sdkResult;

  return sdkText.length >= cachedText.length ? sdkResult : cachedResult;
}

function chooseRicherToolCalls(
  sdkToolCalls: ToolCallInfo[] = [],
  cachedToolCalls: ToolCallInfo[] = [],
): ToolCallInfo[] {
  if (sdkToolCalls.length >= cachedToolCalls.length) {
    return sdkToolCalls;
  }

  return cachedToolCalls;
}

function normalizeAsyncStatus(
  subagent: SubagentInfo | undefined,
  modeOverride?: SubagentInfo['mode'],
): AsyncSubagentStatus | undefined {
  if (!subagent) return undefined;

  const mode = modeOverride ?? subagent.mode;
  if (mode === 'sync') return undefined;
  if (mode === 'async') return subagent.asyncStatus ?? subagent.status;
  return subagent.asyncStatus;
}

function isTerminalAsyncStatus(status: AsyncSubagentStatus | undefined): boolean {
  return status === 'completed' || status === 'error' || status === 'orphaned';
}

function mergeSubagentInfo(
  taskToolCall: ToolCallInfo,
  cachedSubagent: SubagentInfo,
): SubagentInfo {
  const sdkSubagent = taskToolCall.subagent;
  const cachedAsyncStatus = normalizeAsyncStatus(cachedSubagent);
  if (!sdkSubagent) {
    return {
      ...cachedSubagent,
      asyncStatus: cachedAsyncStatus,
      result: chooseRicherResult(taskToolCall.result, cachedSubagent.result),
    };
  }

  const sdkAsyncStatus = normalizeAsyncStatus(sdkSubagent);
  const sdkIsTerminal = isTerminalAsyncStatus(sdkAsyncStatus);
  const cachedIsTerminal = isTerminalAsyncStatus(cachedAsyncStatus);
  const sdkResult = taskToolCall.result ?? sdkSubagent.result;

  const preferred = (!sdkIsTerminal && cachedIsTerminal) ? cachedSubagent : sdkSubagent;

  const mergedMode = sdkSubagent.mode
    ?? cachedSubagent.mode
    ?? (taskToolCall.input?.run_in_background === true ? 'async' : undefined);
  const fallbackResult = chooseRicherResult(sdkResult, cachedSubagent.result);
  const mergedResult = preferred === cachedSubagent
    ? (cachedSubagent.result ?? fallbackResult)
    : fallbackResult;
  const mergedAsyncStatus = normalizeAsyncStatus(preferred, mergedMode);

  return {
    ...cachedSubagent,
    ...sdkSubagent,
    description: sdkSubagent.description || cachedSubagent.description,
    prompt: sdkSubagent.prompt || cachedSubagent.prompt,
    mode: mergedMode,
    status: preferred.status,
    asyncStatus: mergedAsyncStatus,
    result: mergedResult,
    toolCalls: chooseRicherToolCalls(sdkSubagent.toolCalls, cachedSubagent.toolCalls),
    agentId: sdkSubagent.agentId || cachedSubagent.agentId,
    outputToolId: sdkSubagent.outputToolId || cachedSubagent.outputToolId,
    startedAt: sdkSubagent.startedAt ?? cachedSubagent.startedAt,
    completedAt: sdkSubagent.completedAt ?? cachedSubagent.completedAt,
    isExpanded: sdkSubagent.isExpanded ?? cachedSubagent.isExpanded,
  };
}

function ensureTaskToolCall(
  msg: ChatMessage,
  subagentId: string,
  subagent: SubagentInfo,
): ToolCallInfo {
  msg.toolCalls = msg.toolCalls || [];
  let taskToolCall = msg.toolCalls.find(
    tc => tc.id === subagentId && isSubagentToolName(tc.name),
  );

  if (!taskToolCall) {
    taskToolCall = {
      id: subagentId,
      name: TOOL_TASK,
      input: {
        description: subagent.description,
        prompt: subagent.prompt || '',
        ...(subagent.mode === 'async' ? { run_in_background: true } : {}),
      },
      status: subagent.status,
      result: subagent.result,
      isExpanded: false,
      subagent,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  if (!taskToolCall.input.description) {
    taskToolCall.input.description = subagent.description;
  }
  if (!taskToolCall.input.prompt) {
    taskToolCall.input.prompt = subagent.prompt || '';
  }
  if (subagent.mode === 'async') {
    taskToolCall.input.run_in_background = true;
  }
  const mergedSubagent = mergeSubagentInfo(taskToolCall, subagent);
  taskToolCall.status = mergedSubagent.status;
  if (mergedSubagent.mode === 'async') {
    taskToolCall.input.run_in_background = true;
  }
  if (mergedSubagent.result !== undefined) {
    taskToolCall.result = mergedSubagent.result;
  }
  taskToolCall.subagent = mergedSubagent;
  return taskToolCall;
}

export async function enrichAsyncSubagentToolCalls(
  subagentData: Record<string, SubagentInfo>,
  vaultPath: string,
  sessionIds: string[],
): Promise<void> {
  const uniqueSessionIds = [...new Set(sessionIds)];
  if (uniqueSessionIds.length === 0) return;

  const loaderCache = new Map<string, ReturnType<typeof loadSubagentToolCalls>>();

  for (const subagent of Object.values(subagentData)) {
    if (subagent.mode !== 'async') continue;
    if (!subagent.agentId) continue;
    if ((subagent.toolCalls?.length ?? 0) > 0) continue;

    for (const sessionId of uniqueSessionIds) {
      const cacheKey = `${sessionId}:${subagent.agentId}`;

      let loader = loaderCache.get(cacheKey);
      if (!loader) {
        loader = loadSubagentToolCalls(vaultPath, sessionId, subagent.agentId);
        loaderCache.set(cacheKey, loader);
      }

      const recoveredToolCalls = await loader;
      if (recoveredToolCalls.length === 0) continue;

      subagent.toolCalls = recoveredToolCalls.map(toolCall => ({
        ...toolCall,
        input: { ...toolCall.input },
      }));
      break;
    }
  }
}

function messageReferencesSubagent(msg: ChatMessage, subagentId: string): {
  hasSubagentBlock: boolean;
  hasTaskToolCall: boolean;
} {
  const hasSubagentBlock = msg.contentBlocks?.some(
    block => (block.type === 'subagent' && block.subagentId === subagentId)
      || (block.type === 'tool_use' && block.toolId === subagentId),
  ) ?? false;
  const hasTaskToolCall = msg.toolCalls?.some(tc => tc.id === subagentId) ?? false;
  return { hasSubagentBlock, hasTaskToolCall };
}

/** Normalize an existing block to a subagent block. Returns true if it matched the id. */
function normalizeSubagentBlock(
  blocks: NonNullable<ChatMessage['contentBlocks']>,
  index: number,
  subagentId: string,
  mode: SubagentInfo['mode'],
): boolean {
  const block = blocks[index];
  if (block.type === 'tool_use' && block.toolId === subagentId) {
    blocks[index] = { type: 'subagent', subagentId, mode };
    return true;
  }
  if (block.type === 'subagent' && block.subagentId === subagentId) {
    if (!block.mode) block.mode = mode;
    return true;
  }
  return false;
}

function appendSubagentBlock(
  blocks: NonNullable<ChatMessage['contentBlocks']>,
  subagentId: string,
  mode: SubagentInfo['mode'],
): void {
  blocks.push({ type: 'subagent', subagentId, mode });
}

/** Attach a subagent to a message that already references it, normalizing its blocks. */
function attachSubagentToMessage(
  msg: ChatMessage,
  subagentId: string,
  subagent: SubagentInfo,
  hasTaskToolCall: boolean,
): void {
  ensureTaskToolCall(msg, subagentId, subagent);
  msg.contentBlocks = msg.contentBlocks || [];

  let hasNormalizedSubagentBlock = false;
  for (let i = 0; i < msg.contentBlocks.length; i++) {
    if (normalizeSubagentBlock(msg.contentBlocks, i, subagentId, subagent.mode)) {
      hasNormalizedSubagentBlock = true;
    }
  }

  if (!hasNormalizedSubagentBlock && hasTaskToolCall) {
    appendSubagentBlock(msg.contentBlocks, subagentId, subagent.mode);
  }
}

/** Recover a subagent with no host message by anchoring it to the latest assistant turn. */
function attachOrphanSubagent(
  messages: ChatMessage[],
  subagentId: string,
  subagent: SubagentInfo,
): void {
  let anchor = [...messages].reverse().find((msg): msg is ChatMessage => msg.role === 'assistant');
  if (!anchor) {
    anchor = {
      id: `subagent-recovery-${subagentId}`,
      role: 'assistant',
      content: '',
      timestamp: subagent.completedAt ?? subagent.startedAt ?? Date.now(),
      contentBlocks: [],
    };
    messages.push(anchor);
  }

  ensureTaskToolCall(anchor, subagentId, subagent);
  anchor.contentBlocks = anchor.contentBlocks || [];

  const hasSubagentBlock = anchor.contentBlocks.some(
    block => block.type === 'subagent' && block.subagentId === subagentId,
  );
  if (!hasSubagentBlock) {
    appendSubagentBlock(anchor.contentBlocks, subagentId, subagent.mode);
  }
}

export function applySubagentData(
  messages: ChatMessage[],
  subagentData: Record<string, SubagentInfo>,
): void {
  const attachedSubagentIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;

    for (const [subagentId, subagent] of Object.entries(subagentData)) {
      const { hasSubagentBlock, hasTaskToolCall } = messageReferencesSubagent(msg, subagentId);
      if (!hasSubagentBlock && !hasTaskToolCall) continue;

      attachSubagentToMessage(msg, subagentId, subagent, hasTaskToolCall);
      attachedSubagentIds.add(subagentId);
    }
  }

  for (const [subagentId, subagent] of Object.entries(subagentData)) {
    if (attachedSubagentIds.has(subagentId)) continue;
    attachOrphanSubagent(messages, subagentId, subagent);
  }
}

export function buildPersistedSubagentData(messages: ChatMessage[]): Record<string, SubagentInfo> {
  const result: Record<string, SubagentInfo> = {};

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.toolCalls) continue;

    for (const toolCall of msg.toolCalls) {
      if (!isSubagentToolName(toolCall.name) || !toolCall.subagent) continue;
      result[toolCall.subagent.id] = toolCall.subagent;
    }
  }

  return result;
}
