/**
 * Pure helpers over Cursor Task tool payloads. Leaf module by design: both
 * `cursorTaskSubagent` and `cursorToolNormalization` consume these, so keeping
 * them dependency-free breaks the import cycle between those two.
 */

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
