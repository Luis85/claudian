import type {
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
} from '../../../core/providers/types';
import type { ToolCallInfo } from '../../../core/types';
import { extractCursorTaskResultText } from './cursorTaskPayload';
import { extractCursorNestedToolCalls } from './cursorTaskSubagent';

function readTaskPayload(toolUseResult: unknown): Record<string, unknown> | null {
  if (!toolUseResult || typeof toolUseResult !== 'object' || Array.isArray(toolUseResult)) {
    return null;
  }
  return toolUseResult as Record<string, unknown>;
}

export class CursorTaskResultInterpreter implements ProviderTaskResultInterpreter {
  hasAsyncLaunchMarker(toolUseResult: unknown): boolean {
    const record = readTaskPayload(toolUseResult);
    if (!record) {
      return false;
    }

    if (record.isBackground === true || record.isAsync === true) {
      return true;
    }

    const steps = record.conversationSteps;
    if (Array.isArray(steps) && steps.length > 0) {
      return false;
    }

    const agentId = typeof record.agentId === 'string' ? record.agentId : '';
    return agentId.length > 0;
  }

  extractAgentId(toolUseResult: unknown): string | null {
    const record = readTaskPayload(toolUseResult);
    if (!record) {
      return null;
    }

    const direct = record.agentId ?? record.agent_id;
    return typeof direct === 'string' && direct.length > 0 ? direct : null;
  }

  extractStructuredResult(toolUseResult: unknown): string | null {
    const record = readTaskPayload(toolUseResult);
    if (!record) {
      return null;
    }

    const fromSteps = extractCursorTaskResultText(record);
    if (fromSteps.length > 0) {
      return fromSteps;
    }

    const result = typeof record.result === 'string' ? record.result.trim() : '';
    if (result.length > 0) {
      return result;
    }

    const output = typeof record.output === 'string' ? record.output.trim() : '';
    return output.length > 0 ? output : null;
  }

  resolveTerminalStatus(
    toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ): ProviderTaskTerminalStatus {
    const record = readTaskPayload(toolUseResult);
    if (!record) {
      return fallbackStatus;
    }

    if (record.isError === true || record.error) {
      return 'error';
    }

    return fallbackStatus;
  }

  extractTagValue(): string | null {
    return null;
  }

  extractNestedToolCalls(toolUseResult: unknown, parentToolUseId: string): ToolCallInfo[] {
    return extractCursorNestedToolCalls(toolUseResult, parentToolUseId);
  }
}
