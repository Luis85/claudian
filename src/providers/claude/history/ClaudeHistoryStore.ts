import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { buildAsyncSubagentInfo } from './sdkAsyncSubagent';
import { filterActiveBranch } from './sdkBranchFilter';
import type { AsyncSubagentResult, SDKNativeMessage, SDKSessionLoadResult } from './sdkHistoryTypes';
import {
  collectAsyncSubagentResults,
  collectStructuredPatchResults,
  collectToolResults,
  extractXmlTag,
  hydrateFallbackAskUserAnswers,
  hydrateStructuredToolResults,
  isSystemInjectedMessage,
  mergeAssistantMessage,
  parseSDKMessageToChat,
} from './sdkMessageParsing';
import {
  deleteSDKSession,
  encodeVaultPathForSDK,
  getSDKProjectsPath,
  getSDKSessionPath,
  isValidSessionId,
  readSDKSession,
  sdkSessionExists,
} from './sdkSessionPaths';
import {
  isValidAgentId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
} from './sdkSubagentSidecar';

export type {
  AsyncSubagentResult,
  ResolvedAsyncStatus,
  SDKNativeContentBlock,
  SDKNativeMessage,
  SDKSessionLoadResult,
  SDKSessionReadResult,
} from './sdkHistoryTypes';
export {
  collectAsyncSubagentResults,
  deleteSDKSession,
  encodeVaultPathForSDK,
  extractXmlTag,
  filterActiveBranch,
  getSDKProjectsPath,
  getSDKSessionPath,
  isValidSessionId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
  parseSDKMessageToChat,
  readSDKSession,
  sdkSessionExists,
};
export {
  extractAgentIdFromToolUseResult,
  resolveToolUseResultStatus,
} from './sdkAsyncSubagent';

// The merge loop is heavier per-iteration than the JSONL parse loop
// (parseSDKMessageToChat does content-block extraction + tool-result hydration)
// so we yield more often. Same rationale as readSDKSession: PERF-4 — block
// the loop in batches, not in one synchronous sweep.
const YIELD_EVERY_MERGED_ENTRIES = 50;

export async function loadSDKSessionMessages(
  vaultPath: string,
  sessionId: string,
  resumeAtMessageId?: string
): Promise<SDKSessionLoadResult> {
  const result = await readSDKSession(vaultPath, sessionId);

  if (result.error) {
    return { messages: [], skippedLines: result.skippedLines, error: result.error };
  }

  const filteredEntries = filterActiveBranch(result.messages, resumeAtMessageId);

  const toolResults = collectToolResults(filteredEntries);
  const toolUseResults = collectStructuredPatchResults(filteredEntries);
  const asyncSubagentResults = collectAsyncSubagentResults(filteredEntries);

  const chatMessages = await mergeFilteredEntries(filteredEntries, toolResults);

  hydrateStructuredToolResults(chatMessages, toolUseResults);
  hydrateFallbackAskUserAnswers(chatMessages);
  await hydrateAsyncSubagents(chatMessages, toolUseResults, asyncSubagentResults, vaultPath, sessionId);

  chatMessages.sort((a, b) => a.timestamp - b.timestamp);

  return { messages: chatMessages, skippedLines: result.skippedLines };
}

async function mergeFilteredEntries(
  filteredEntries: SDKNativeMessage[],
  toolResults: Map<string, { content: string; isError: boolean }>,
): Promise<ChatMessage[]> {
  const chatMessages: ChatMessage[] = [];
  let pendingAssistant: ChatMessage | null = null;

  // Merge consecutive assistant messages until an actual user message appears
  for (let i = 0; i < filteredEntries.length; i++) {
    // Yield-above-continue (F1): the loop body has three early-continue
    // paths (`isSystemInjectedMessage`, `<synthetic>` assistant, null parse
    // result). A bottom-of-loop yield check would be skipped on any
    // consecutive skip-only run, leaving the event loop blocked when the
    // skip distribution clusters. Checking at the top ties the yield
    // cadence to raw iteration count (the actual wall-time driver) so
    // the contract holds regardless of transcript shape.
    if (i > 0 && i % YIELD_EVERY_MERGED_ENTRIES === 0) {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }

    const sdkMsg = filteredEntries[i];
    if (shouldSkipMergedEntry(sdkMsg)) continue;

    const chatMsg = parseSDKMessageToChat(sdkMsg, toolResults);
    if (!chatMsg) continue;

    pendingAssistant = appendParsedMessage(chatMessages, pendingAssistant, chatMsg);
  }

  if (pendingAssistant) {
    chatMessages.push(pendingAssistant);
  }

  return chatMessages;
}

function shouldSkipMergedEntry(sdkMsg: SDKNativeMessage): boolean {
  if (isSystemInjectedMessage(sdkMsg)) {
    return true;
  }

  // Skip synthetic assistant messages (e.g., "No response requested." after /compact)
  return sdkMsg.type === 'assistant' && sdkMsg.message?.model === '<synthetic>';
}

/** Returns the assistant message still pending merge, or null once flushed. */
function appendParsedMessage(
  chatMessages: ChatMessage[],
  pendingAssistant: ChatMessage | null,
  chatMsg: ChatMessage,
): ChatMessage | null {
  if (chatMsg.role !== 'assistant') {
    if (pendingAssistant) {
      chatMessages.push(pendingAssistant);
    }
    chatMessages.push(chatMsg);
    return null;
  }

  // context_compacted must not merge with previous assistant (it's a standalone separator)
  const isCompactBoundary = chatMsg.contentBlocks?.some(b => b.type === 'context_compacted');
  if (isCompactBoundary) {
    if (pendingAssistant) {
      chatMessages.push(pendingAssistant);
    }
    chatMessages.push(chatMsg);
    return null;
  }

  if (pendingAssistant) {
    mergeAssistantMessage(pendingAssistant, chatMsg);
    return pendingAssistant;
  }
  return chatMsg;
}

// Build SubagentInfo for async Agent tool calls from toolUseResult + queue-operation data
async function hydrateAsyncSubagents(
  chatMessages: ChatMessage[],
  toolUseResults: Map<string, unknown>,
  asyncSubagentResults: Map<string, AsyncSubagentResult>,
  vaultPath: string,
  sessionId: string,
): Promise<void> {
  if (toolUseResults.size === 0 && asyncSubagentResults.size === 0) {
    return;
  }

  const sidecarLoads = collectSidecarLoads(
    chatMessages,
    toolUseResults,
    asyncSubagentResults,
    vaultPath,
    sessionId
  );
  if (sidecarLoads.length === 0) {
    return;
  }

  // Hydrate subagent tool calls from sidecar files
  const results = await Promise.all(sidecarLoads.map(s => s.promise));
  for (let i = 0; i < sidecarLoads.length; i++) {
    const toolCalls = results[i];
    if (toolCalls.length > 0) {
      sidecarLoads[i].subagent.toolCalls = toolCalls;
    }
  }
}

function collectSidecarLoads(
  chatMessages: ChatMessage[],
  toolUseResults: Map<string, unknown>,
  asyncSubagentResults: Map<string, AsyncSubagentResult>,
  vaultPath: string,
  sessionId: string,
): Array<{ subagent: SubagentInfo; promise: Promise<ToolCallInfo[]> }> {
  const sidecarLoads: Array<{ subagent: SubagentInfo; promise: Promise<ToolCallInfo[]> }> = [];

  for (const msg of chatMessages) {
    if (msg.role !== 'assistant' || !msg.toolCalls) continue;
    for (const toolCall of msg.toolCalls) {
      const subagent = attachAsyncSubagentInfo(toolCall, toolUseResults, asyncSubagentResults);

      // Load tool calls from subagent sidecar JSONL in parallel
      if (subagent?.agentId && isValidAgentId(subagent.agentId)) {
        sidecarLoads.push({
          subagent,
          promise: loadSubagentToolCalls(vaultPath, sessionId, subagent.agentId),
        });
      }
    }
  }

  return sidecarLoads;
}

function attachAsyncSubagentInfo(
  toolCall: ToolCallInfo,
  toolUseResults: Map<string, unknown>,
  asyncSubagentResults: Map<string, AsyncSubagentResult>,
): SubagentInfo | null {
  if (!isSubagentToolName(toolCall.name) || toolCall.subagent) return null;
  if (toolCall.input?.run_in_background !== true) return null;

  const toolUseResult = toolUseResults.get(toolCall.id);
  const subagent = buildAsyncSubagentInfo(toolCall, toolUseResult, asyncSubagentResults);
  if (!subagent) return null;

  toolCall.subagent = subagent;
  if (subagent.result !== undefined) {
    toolCall.result = subagent.result;
  }
  toolCall.status = subagent.status;
  return subagent;
}
