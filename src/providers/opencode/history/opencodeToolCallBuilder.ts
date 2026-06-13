import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeOpencodeToolInput,
  normalizeOpencodeToolName,
  normalizeOpencodeToolUseResult,
} from '../normalization/opencodeToolNormalization';
import { getObject, getString, mapToolStatus, type StoredRow } from './opencodeStoredRow';

// Resolve the answers surfaced by an AskUserQuestion tool call, preferring the structured
// answers from the normalized result and falling back to parsing the raw result text.
function resolveAskUserAnswers(
  toolUseResult: ReturnType<typeof normalizeOpencodeToolUseResult>,
  result: string | undefined,
): ToolCallInfo['resolvedAnswers'] {
  return (toolUseResult?.answers as ToolCallInfo['resolvedAnswers'])
    ?? extractResolvedAnswersFromResultText(result);
}

interface ToolPartIdentity {
  id: string;
  rawName: string;
  state: StoredRow | null;
  status: NonNullable<ToolCallInfo['status']>;
}

// Validate the identifying fields of a stored `tool` part. Returns null for any
// part that is not a recognizable tool call (matching the original early-outs).
function resolveToolPartIdentity(part: StoredRow): ToolPartIdentity | null {
  if (getString(part.type) !== 'tool') {
    return null;
  }

  const id = getString(part.callID);
  const rawName = getString(part.tool);
  const state = getObject(part.state);
  const status = mapToolStatus(getString(state?.status));
  if (!id || !rawName || !status) {
    return null;
  }

  return { id, rawName, state, status };
}

function getToolResultText(state: StoredRow | null): string | undefined {
  return getString(state?.output) ?? getString(state?.error) ?? undefined;
}

function buildToolUseResult(
  rawName: string,
  input: Record<string, unknown>,
  state: StoredRow | null,
): ReturnType<typeof normalizeOpencodeToolUseResult> {
  const result = getToolResultText(state);
  const metadata = getObject(state?.metadata);
  return normalizeOpencodeToolUseResult(rawName, input, {
    ...(result ? { output: result } : {}),
    ...(metadata ? { metadata } : {}),
  });
}

// Attach the tool-specific enrichments (AskUserQuestion answers, write/edit diffs)
// in place, mirroring the original per-part mapping.
function enrichToolCall(
  toolCall: ToolCallInfo,
  toolUseResult: ReturnType<typeof normalizeOpencodeToolUseResult>,
): void {
  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    toolCall.resolvedAnswers = resolveAskUserAnswers(toolUseResult, toolCall.result);
  }

  if (toolCall.status === 'completed' && isWriteEditTool(toolCall.name)) {
    const diffData = extractDiffData(toolUseResult, toolCall);
    if (diffData) {
      toolCall.diffData = diffData;
    }
  }
}

function buildToolCallFromPart(part: StoredRow): ToolCallInfo | null {
  const identity = resolveToolPartIdentity(part);
  if (!identity) {
    return null;
  }

  const { id, rawName, state, status } = identity;
  const input = normalizeOpencodeToolInput(rawName, getObject(state?.input) ?? {});
  const toolUseResult = buildToolUseResult(rawName, input, state);
  const toolCall: ToolCallInfo = {
    id,
    input,
    name: normalizeOpencodeToolName(rawName),
    result: getToolResultText(state),
    status,
  };

  enrichToolCall(toolCall, toolUseResult);
  return toolCall;
}

export function buildAssistantToolCalls(parts: StoredRow[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = [];
  for (const part of parts) {
    const toolCall = buildToolCallFromPart(part);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }
  return toolCalls;
}
