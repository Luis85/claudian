import type { ApprovalDecisionOption } from '../../../core/runtime/types';
import type { ApprovalDecision } from '../../../core/types';
import type { AcpRequestPermissionResponse } from '../../acp';

export type OpencodePermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export interface OpencodePermissionOption {
  kind: OpencodePermissionOptionKind;
  name: string;
  optionId: string;
}

export interface OpencodePermissionPresentation {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
}

export function normalizeApprovalInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (rawInput === undefined) {
    return {};
  }
  return { value: rawInput };
}

/**
 * Static presentations for permission ids whose copy never depends on the tool
 * input or a blocked path. Dynamic ids (doom_loop, edit, read, …) are handled by
 * dedicated builders below.
 */
const STATIC_PERMISSION_PRESENTATIONS: Record<string, OpencodePermissionPresentation> = {
  bash: {
    decisionReason: 'Command execution permission required',
    description: 'OpenCode wants to run a shell command.',
    toolName: 'bash',
  },
  codesearch: {
    description: 'OpenCode wants to search indexed code outside the active buffer.',
    toolName: 'codesearch',
  },
  glob: {
    description: 'OpenCode wants to scan file paths with a glob pattern.',
    toolName: 'glob',
  },
  grep: {
    description: 'OpenCode wants to search file contents with a pattern.',
    toolName: 'grep',
  },
  lsp: {
    description: 'OpenCode wants to query language server data.',
    toolName: 'lsp',
  },
  plan_enter: {
    description: 'OpenCode wants to switch this session into planning mode.',
    toolName: 'Enter Plan Mode',
  },
  plan_exit: {
    description: 'OpenCode wants to leave planning mode and resume implementation.',
    toolName: 'Exit Plan Mode',
  },
  question: {
    description: 'OpenCode wants to ask you a direct question before continuing.',
    toolName: 'Ask Question',
  },
  skill: {
    description: 'OpenCode wants to load a skill into the current session.',
    toolName: 'skill',
  },
  todowrite: {
    description: 'OpenCode wants to update the shared task list.',
    toolName: 'todowrite',
  },
  webfetch: {
    description: 'OpenCode wants to fetch content from a URL.',
    toolName: 'webfetch',
  },
  websearch: {
    description: 'OpenCode wants to search the web.',
    toolName: 'websearch',
  },
};

function buildDoomLoopPresentation(input: Record<string, unknown>): OpencodePermissionPresentation {
  const repeatedTool = typeof input.tool === 'string' ? input.tool.trim() : '';
  return {
    decisionReason: 'OpenCode detected repeated identical tool calls',
    description: repeatedTool
      ? `Allow another repeated \`${repeatedTool}\` call.`
      : 'Allow another repeated tool call.',
    toolName: 'Doom Loop Guard',
  };
}

function buildEditPresentation(blockedPath: string | undefined): OpencodePermissionPresentation {
  return {
    ...(blockedPath ? { blockedPath } : {}),
    decisionReason: 'File write permission required',
    description: blockedPath
      ? 'OpenCode wants to modify this file.'
      : 'OpenCode wants to apply file changes.',
    toolName: 'edit',
  };
}

function buildExternalDirectoryPresentation(
  blockedPath: string | undefined,
): OpencodePermissionPresentation {
  return {
    ...(blockedPath ? { blockedPath } : {}),
    decisionReason: 'Path is outside the session working directory',
    description: blockedPath
      ? 'OpenCode wants to access a path outside the working directory.'
      : 'OpenCode wants to access files outside the working directory.',
    toolName: 'External Directory',
  };
}

function buildReadPresentation(blockedPath: string | undefined): OpencodePermissionPresentation {
  return {
    ...(blockedPath ? { blockedPath } : {}),
    description: blockedPath
      ? 'OpenCode wants to read this path.'
      : 'OpenCode wants to read project files.',
    toolName: 'read',
  };
}

function buildWorkflowApprovalPresentation(
  input: Record<string, unknown>,
): OpencodePermissionPresentation {
  const summary = summarizeWorkflowTools(input);
  return {
    decisionReason: 'Session-level workflow approval requested',
    description: summary
      ? `Pre-approve workflow tools for this session: ${summary}.`
      : 'Pre-approve workflow tools for this session.',
    toolName: 'Workflow Approval',
  };
}

function buildDefaultPresentation(
  permissionId: string,
  blockedPath: string | undefined,
): OpencodePermissionPresentation {
  const label = formatPermissionLabel(permissionId);
  return {
    ...(blockedPath ? { blockedPath } : {}),
    description: blockedPath
      ? `OpenCode wants permission to use ${label} on this path.`
      : `OpenCode wants permission to use ${label}.`,
    toolName: label,
  };
}

export function buildOpencodePermissionPresentation(
  rawTitle: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): OpencodePermissionPresentation {
  const permissionId = normalizePermissionId(rawTitle);
  const blockedPath = extractPermissionPath(input, locations);

  const staticPresentation = STATIC_PERMISSION_PRESENTATIONS[permissionId];
  if (staticPresentation) {
    // Fresh object per call so callers never observe a shared table reference.
    return { ...staticPresentation };
  }

  switch (permissionId) {
    case 'doom_loop':
      return buildDoomLoopPresentation(input);
    case 'edit':
      return buildEditPresentation(blockedPath);
    case 'external_directory':
      return buildExternalDirectoryPresentation(blockedPath);
    case 'read':
      return buildReadPresentation(blockedPath);
    case 'workflow_tool_approval':
      return buildWorkflowApprovalPresentation(input);
    default:
      return buildDefaultPresentation(permissionId, blockedPath);
  }
}

export function mapApprovalDecision(
  decision: ApprovalDecision,
  options: readonly Pick<OpencodePermissionOption, 'kind' | 'optionId'>[],
): AcpRequestPermissionResponse {
  if (decision === 'allow') {
    return selectPermissionOption(options, ['allow_once', 'allow_always']);
  }

  if (decision === 'allow-always') {
    return selectPermissionOption(options, ['allow_always', 'allow_once']);
  }

  if (decision === 'deny') {
    return selectPermissionOption(options, ['reject_once', 'reject_always']);
  }

  if (typeof decision === 'object' && decision.type === 'select-option') {
    return {
      outcome: {
        optionId: decision.value,
        outcome: 'selected',
      },
    };
  }

  return { outcome: { outcome: 'cancelled' } };
}

export function buildAcpApprovalDecisionOptions(
  options: readonly OpencodePermissionOption[],
): ApprovalDecisionOption[] {
  return options.map((option) => ({
    ...(option.kind === 'allow_once'
      ? { decision: 'allow' as const }
      : option.kind === 'allow_always'
      ? { decision: 'allow-always' as const }
      : {}),
    label: option.name,
    value: option.optionId,
  }));
}

export function selectPermissionOption(
  options: readonly Pick<OpencodePermissionOption, 'kind' | 'optionId'>[],
  preferredKinds: readonly OpencodePermissionOptionKind[],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return {
        outcome: {
          optionId: option.optionId,
          outcome: 'selected',
        },
      };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}

function normalizePermissionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'tool';
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  const candidateKeys = ['filepath', 'filePath', 'path', 'parentDir'];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const locationPath = locations?.find((location) => location.path.trim())?.path;
  return locationPath?.trim() || undefined;
}

function summarizeWorkflowTools(input: Record<string, unknown>): string {
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const names = tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      return [];
    }

    const entry = tool as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return [];
    }

    let title = '';
    if (typeof entry.args === 'string') {
      try {
        const parsedArgs = JSON.parse(entry.args) as Record<string, unknown>;
        title = typeof parsedArgs.title === 'string'
          ? parsedArgs.title.trim()
          : typeof parsedArgs.name === 'string'
          ? parsedArgs.name.trim()
          : '';
      } catch {
        title = '';
      }
    }

    return [title ? `${name}: ${title}` : name];
  });

  if (names.length === 0) {
    return '';
  }

  if (names.length <= 3) {
    return names.join(', ');
  }

  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function formatPermissionLabel(permissionId: string): string {
  return permissionId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
