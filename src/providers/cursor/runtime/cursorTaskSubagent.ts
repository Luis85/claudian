import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeCursorToolCompletion,
  normalizeCursorToolStart,
  readCursorToolEnvelope,
} from './cursorToolNormalization';

/** Cursor encodes subagent type as `{ explore: {} }` rather than a plain string. */
export function parseCursorSubagentType(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== 'unspecified' ? trimmed : undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1) {
    return undefined;
  }

  const key = keys[0];
  if (key === 'unspecified') {
    return undefined;
  }

  return key;
}

export function readCursorTaskSuccess(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!result) {
    return undefined;
  }

  const success = result.success;
  if (!success || typeof success !== 'object' || Array.isArray(success)) {
    return undefined;
  }

  return success as Record<string, unknown>;
}

export function isCursorTaskBackground(
  success: Record<string, unknown> | undefined,
  args: Record<string, unknown> = {},
): boolean {
  if (success?.isBackground === true) {
    return true;
  }

  const mode = typeof args.mode === 'string' ? args.mode : '';
  return mode === 'TASK_MODE_BACKGROUND';
}

export function extractCursorTaskResultText(success: Record<string, unknown> | undefined): string {
  if (!success) {
    return '';
  }

  const steps = success.conversationSteps;
  if (!Array.isArray(steps)) {
    return '';
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || typeof step !== 'object') {
      continue;
    }

    const assistantMessage = (step as Record<string, unknown>).assistantMessage;
    if (assistantMessage && typeof assistantMessage === 'object') {
      const text = (assistantMessage as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return '';
}

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

export function buildCursorTaskToolUseResult(
  success: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};

  const agentId =
    (typeof success.agentId === 'string' && success.agentId)
    || (typeof args.agentId === 'string' && args.agentId);
  if (agentId) {
    payload.agentId = agentId;
  }

  if (success.isBackground === true) {
    payload.isBackground = true;
  }

  if (Array.isArray(success.conversationSteps)) {
    payload.conversationSteps = success.conversationSteps;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
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

