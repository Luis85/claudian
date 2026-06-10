import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import {
  buildCursorTaskToolUseResult,
  extractCursorTaskResultText,
  isCursorTaskBackground,
  readCursorTaskSuccess,
} from './cursorTaskPayload';
import {
  normalizeCursorToolCompletion,
  normalizeCursorToolStart,
  readCursorToolEnvelope,
} from './cursorToolNormalization';

export function extractCursorNestedToolCalls(
  toolUseResult: unknown,
  parentToolUseId: string,
): ToolCallInfo[] {
  if (!toolUseResult || typeof toolUseResult !== 'object') {
    return [];
  }

  const steps = (toolUseResult as Record<string, unknown>).conversationSteps;
  if (!Array.isArray(steps)) {
    return [];
  }

  const toolCalls: ToolCallInfo[] = [];
  let toolIndex = 0;

  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      continue;
    }

    const toolCallPayload = (step as Record<string, unknown>).toolCall;
    if (!toolCallPayload || typeof toolCallPayload !== 'object') {
      continue;
    }

    const envelope = readCursorToolEnvelope(toolCallPayload as Record<string, unknown>);
    if (!envelope) {
      continue;
    }

    const started = normalizeCursorToolStart(envelope);
    const completed = normalizeCursorToolCompletion(envelope);
    const id = `${parentToolUseId}:step:${toolIndex}`;
    toolIndex += 1;

    const toolCall: ToolCallInfo = {
      id,
      name: completed.name || started.name,
      input: started.input,
      status: completed.isError ? 'error' : 'completed',
      result: completed.content,
      isExpanded: false,
    };
    if (completed.toolUseResult) {
      const diffData = extractDiffData(completed.toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
      }
    }
    toolCalls.push(toolCall);
  }

  return toolCalls;
}

function readTaskSuccessFromPersistedResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const envelope = readCursorToolEnvelope(result as Record<string, unknown>);
  if (envelope?.result) {
    return readCursorTaskSuccess(envelope.result);
  }

  const record = result as Record<string, unknown>;
  if (record.success && typeof record.success === 'object') {
    return readCursorTaskSuccess(record);
  }

  return readCursorTaskSuccess({ success: record });
}

export function attachCursorSubagentToTaskToolCall(
  toolCall: ToolCallInfo,
  rawResult: unknown,
): void {
  if (!isSubagentToolName(toolCall.name)) {
    return;
  }

  const success = readTaskSuccessFromPersistedResult(rawResult);
  const toolUseResult = success
    ? buildCursorTaskToolUseResult(success, toolCall.input)
    : undefined;

  const nested = toolUseResult
    ? extractCursorNestedToolCalls(toolUseResult, toolCall.id)
    : [];

  const description = typeof toolCall.input.description === 'string'
    ? toolCall.input.description
    : 'Subagent';
  const prompt = typeof toolCall.input.prompt === 'string' ? toolCall.input.prompt : '';
  const isBackground = isCursorTaskBackground(success, toolCall.input);
  const resultText = toolCall.result
    ?? extractCursorTaskResultText(success)
    ?? '';

  const subagent: SubagentInfo = {
    id: toolCall.id,
    description,
    prompt,
    mode: isBackground ? 'async' : 'sync',
    isExpanded: false,
    status: toolCall.status === 'error' ? 'error' : 'completed',
    result: resultText,
    toolCalls: nested,
    ...(typeof toolUseResult?.agentId === 'string' ? { agentId: toolUseResult.agentId } : {}),
    ...(isBackground ? { asyncStatus: toolCall.status === 'error' ? 'error' : 'completed' } : {}),
  };

  toolCall.subagent = subagent;
}
