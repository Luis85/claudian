import type {
  CanUseTool,
  PermissionMode as SDKPermissionMode,
  PermissionResult,
  PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';

import type { RuntimeHost } from '../../../core/runtime/RuntimeHost';
import { getActionDescription } from '../../../core/security/ApprovalManager';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_EXIT_PLAN_MODE,
  TOOL_SKILL,
} from '../../../core/tools/toolNames';
import type {
  ApprovalDecision,
  ExitPlanModeDecision,
} from '../../../core/types';
import type { PermissionMode } from '../../../core/types/settings';
import { buildPermissionUpdates } from '../security/ClaudePermissionUpdates';

export interface ClaudeApprovalHandlerDeps {
  getAllowedTools: () => string[] | null;
  host: Pick<RuntimeHost, 'approval' | 'askUser' | 'exitPlanMode'>;
  getPermissionMode: () => PermissionMode;
  resolveSDKPermissionMode: (mode: PermissionMode) => SDKPermissionMode;
  syncPermissionMode: (mode: PermissionMode, sdkMode: SDKPermissionMode) => void;
}

type ToolInput = Parameters<CanUseTool>[1];
type CallOptions = Parameters<CanUseTool>[2];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Enforce the per-query allow list. Returns a deny result, or null to fall through. */
function checkAllowedTools(
  allowedTools: string[] | null,
  toolName: string,
): PermissionResult | null {
  if (allowedTools === null) return null;
  if (allowedTools.includes(toolName) || toolName === TOOL_SKILL) return null;

  const allowedList = allowedTools.length > 0
    ? ` Allowed tools: ${allowedTools.join(', ')}.`
    : ' No tools are allowed for this query type.';
  return {
    behavior: 'deny',
    message: `Tool "${toolName}" is not allowed for this query.${allowedList}`,
  };
}

function buildExitPlanAllow(
  deps: ClaudeApprovalHandlerDeps,
  input: ToolInput,
): PermissionResult {
  const permissionMode = deps.getPermissionMode();
  const sdkMode = deps.resolveSDKPermissionMode(permissionMode);
  deps.syncPermissionMode(permissionMode, sdkMode);
  return {
    behavior: 'allow',
    updatedInput: input,
    updatedPermissions: [
      { type: 'setMode', mode: sdkMode, destination: 'session' },
    ],
  };
}

async function handleExitPlanMode(
  deps: ClaudeApprovalHandlerDeps,
  input: ToolInput,
  options: CallOptions,
): Promise<PermissionResult> {
  try {
    const decision: ExitPlanModeDecision | null = await deps.host.exitPlanMode(input, options.signal);
    if (decision === null) {
      return { behavior: 'deny', message: 'User cancelled.', interrupt: true };
    }
    if (decision.type === 'feedback') {
      return { behavior: 'deny', message: decision.text, interrupt: false };
    }
    return buildExitPlanAllow(deps, input);
  } catch (error) {
    return {
      behavior: 'deny',
      message: `Failed to handle plan mode exit: ${errorMessage(error)}`,
      interrupt: true,
    };
  }
}

/**
 * The SDK's JSDoc says "Other will be provided automatically" but the SDK
 * doesn't inject isOther into the canUseTool input. Specorator intercepts at
 * canUseTool and renders its own UI, so we must inject isOther here to match
 * the Claude Code CLI's built-in behavior.
 */
function injectIsOther(input: ToolInput): void {
  const questions = (input as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return;
  for (const q of questions) {
    if (q && typeof q === 'object' && !('isOther' in q)) {
      (q as Record<string, unknown>).isOther = true;
    }
  }
}

async function handleAskUserQuestion(
  deps: ClaudeApprovalHandlerDeps,
  input: ToolInput,
  options: CallOptions,
): Promise<PermissionResult> {
  try {
    injectIsOther(input);
    const answers = await deps.host.askUser(input, options.signal);
    if (answers === null) {
      return { behavior: 'deny', message: 'User declined to answer.', interrupt: true };
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  } catch (error) {
    return {
      behavior: 'deny',
      message: `Failed to get user answers: ${errorMessage(error)}`,
      interrupt: true,
    };
  }
}

function resolveApprovalResult(
  decision: ApprovalDecision,
  toolName: string,
  input: ToolInput,
  suggestions: PermissionUpdate[] | undefined,
): PermissionResult {
  if (decision === 'cancel') {
    return { behavior: 'deny', message: 'User interrupted.', interrupt: true };
  }
  if (decision === 'allow' || decision === 'allow-always') {
    const updatedPermissions = buildPermissionUpdates(toolName, input, decision, suggestions);
    return { behavior: 'allow', updatedInput: input, updatedPermissions };
  }
  return { behavior: 'deny', message: 'User denied this action.', interrupt: false };
}

async function handleDefaultApproval(
  deps: ClaudeApprovalHandlerDeps,
  toolName: string,
  input: ToolInput,
  options: CallOptions,
): Promise<PermissionResult> {
  try {
    const { decisionReason, blockedPath, agentID } = options;
    const description = getActionDescription(toolName, input);
    const decision: ApprovalDecision = await deps.host.approval(
      toolName,
      input,
      description,
      { decisionReason, blockedPath, agentID },
    );
    return resolveApprovalResult(decision, toolName, input, options.suggestions);
  } catch (error) {
    return {
      behavior: 'deny',
      message: `Approval request failed: ${errorMessage(error)}`,
      interrupt: false,
    };
  }
}

export function createClaudeApprovalCallback(
  deps: ClaudeApprovalHandlerDeps,
): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const denied = checkAllowedTools(deps.getAllowedTools(), toolName);
    if (denied) return denied;

    if (toolName === TOOL_EXIT_PLAN_MODE) {
      return handleExitPlanMode(deps, input, options);
    }
    if (toolName === TOOL_ASK_USER_QUESTION) {
      return handleAskUserQuestion(deps, input, options);
    }
    return handleDefaultApproval(deps, toolName, input, options);
  };
}
