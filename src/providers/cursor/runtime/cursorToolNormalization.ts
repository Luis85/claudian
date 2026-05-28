/**
 * Cursor tool normalization layer.
 *
 * `cursor-agent` emits `tool_call` envelopes keyed by camelCase tool kinds
 * (`readToolCall`, `editToolCall`, `shellToolCall`, ...). The shared chat
 * renderers expect Claude SDK's PascalCase vocabulary (`Read`, `Write`, `Edit`,
 * `Bash`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`, `TodoWrite`, ...) plus
 * shared input shapes (`file_path`, `command`, `pattern`, `query`, ...).
 *
 * This module sits between the raw NDJSON stream and the renderer so Cursor
 * tool blocks look the same as Claude/Codex blocks instead of dumping the raw
 * envelope JSON into the chat panel.
 */

import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SUBAGENT,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';

interface CursorToolEnvelope {
  kind: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | undefined;
  description: string | undefined;
}

export interface NormalizedCursorTool {
  name: string;
  input: Record<string, unknown>;
}

export interface NormalizedCursorToolResult {
  name: string;
  content: string;
  isError: boolean;
  toolUseResult?: Record<string, unknown>;
}

/** Pulls the inner tool envelope (`{readToolCall: {...}}`) out of the wrapper. */
export function readCursorToolEnvelope(
  toolCall: Record<string, unknown> | undefined,
): CursorToolEnvelope | null {
  if (!toolCall || typeof toolCall !== 'object') {
    return null;
  }

  const description = typeof toolCall.description === 'string' ? toolCall.description : undefined;

  for (const [kind, value] of Object.entries(toolCall)) {
    if (kind === 'description') continue;
    if (!kind.endsWith('ToolCall')) continue;
    if (!value || typeof value !== 'object') continue;

    const inner = value as Record<string, unknown>;
    const args = inner.args && typeof inner.args === 'object' && !Array.isArray(inner.args)
      ? (inner.args as Record<string, unknown>)
      : {};
    const result = inner.result && typeof inner.result === 'object' && !Array.isArray(inner.result)
      ? (inner.result as Record<string, unknown>)
      : undefined;
    return { kind, args, result, description };
  }

  return null;
}

/** Produces a Claude-vocabulary `tool_use` chunk from a started envelope. */
export function normalizeCursorToolStart(
  envelope: CursorToolEnvelope,
): NormalizedCursorTool {
  return {
    name: mapCursorToolName(envelope.kind),
    input: mapCursorToolInput(envelope.kind, envelope.args, envelope.description),
  };
}

/** Produces a `tool_result` payload (textual content + optional rich result). */
export function normalizeCursorToolCompletion(
  envelope: CursorToolEnvelope,
): NormalizedCursorToolResult {
  const name = mapCursorToolName(envelope.kind);
  const result = envelope.result;

  if (!result) {
    return { name, content: '', isError: false };
  }

  const errorPayload = pickErrorPayload(result);
  if (errorPayload !== null) {
    return {
      name,
      content: stringifyResultPayload(errorPayload, name) || 'Error',
      isError: true,
    };
  }

  const success = result.success && typeof result.success === 'object' && !Array.isArray(result.success)
    ? (result.success as Record<string, unknown>)
    : undefined;
  if (!success) {
    return { name, content: stringifyResultPayload(result, name), isError: false };
  }

  const content = formatSuccessContent(envelope.kind, success, envelope.args);
  const toolUseResult = buildToolUseResult(envelope.kind, success, envelope.args);
  return {
    name,
    content,
    isError: false,
    ...(toolUseResult ? { toolUseResult } : {}),
  };
}

/** Public for re-use from the SQLite history store, where Cursor uses the same kind keys. */
export function mapCursorToolName(kind: string): string {
  switch (kind) {
    case 'readToolCall': return TOOL_READ;
    case 'writeToolCall': return TOOL_WRITE;
    case 'editToolCall': return TOOL_WRITE;
    case 'replaceEnvToolCall': return TOOL_EDIT;
    case 'deleteToolCall': return 'delete';
    case 'shellToolCall': return TOOL_BASH;
    case 'writeShellStdinToolCall': return 'write_stdin';
    case 'globToolCall': return TOOL_GLOB;
    case 'grepToolCall': return TOOL_GREP;
    case 'lsToolCall': return TOOL_LS;
    case 'webFetchToolCall': return TOOL_WEB_FETCH;
    case 'fetchToolCall': return TOOL_WEB_FETCH;
    case 'webSearchToolCall': return TOOL_WEB_SEARCH;
    case 'semSearchToolCall': return 'SemanticSearch';
    case 'updateTodosToolCall': return TOOL_TODO_WRITE;
    case 'readTodosToolCall': return TOOL_TODO_WRITE;
    case 'askQuestionToolCall': return TOOL_ASK_USER_QUESTION;
    case 'taskToolCall': return TOOL_SUBAGENT;
    case 'mcpToolCall': return 'Mcp';
    case 'listMcpResourcesToolCall': return 'ListMcpResources';
    case 'readMcpResourceToolCall': return 'ReadMcpResource';
    case 'getMcpToolsToolCall': return 'ListMcpTools';
    case 'createPlanToolCall': return 'CreatePlan';
    case 'switchModeToolCall': return 'SwitchMode';
    case 'reflectToolCall': return 'Reflect';
    case 'awaitToolCall': return 'Await';
    case 'applyAgentDiffToolCall': return 'apply_patch';
    case 'computerUseToolCall': return 'ComputerUse';
    case 'generateImageToolCall': return 'GenerateImage';
    case 'recordScreenToolCall': return 'RecordScreen';
    case 'readLintsToolCall': return 'ReadLints';
    case 'startGrindPlanningToolCall': return 'GrindPlan';
    case 'startGrindExecutionToolCall': return 'GrindExecute';
    case 'reportBugfixResultsToolCall': return 'ReportBugfix';
    case 'setupVmEnvironmentToolCall': return 'SetupVm';
    case 'aiAttributionToolCall': return 'AiAttribution';
    case 'partialToolCall':
    case 'truncatedToolCall':
      return 'tool';
    default:
      return humanizeKind(kind);
  }
}

function mapCursorToolInput(
  kind: string,
  args: Record<string, unknown>,
  description: string | undefined,
): Record<string, unknown> {
  switch (kind) {
    case 'readToolCall':
      return { file_path: stringValue(args.path) };

    case 'writeToolCall':
    case 'editToolCall':
      return {
        file_path: stringValue(args.path),
        content: stringValue(args.streamContent ?? args.content),
      };

    case 'replaceEnvToolCall':
      return {
        file_path: stringValue(args.path),
        old_string: stringValue(args.oldString ?? args.old_string),
        new_string: stringValue(args.newString ?? args.new_string),
      };

    case 'deleteToolCall':
      return { path: stringValue(args.path) };

    case 'shellToolCall': {
      const command = stringValue(args.command);
      const cwd = stringValue(args.workingDirectory);
      const out: Record<string, unknown> = { command };
      if (cwd) out.cwd = cwd;
      if (description) out.description = description;
      return out;
    }

    case 'writeShellStdinToolCall':
      return {
        session_id: stringValue(args.sessionId ?? args.session_id),
        chars: stringValue(args.chars ?? args.text),
      };

    case 'globToolCall': {
      const out: Record<string, unknown> = {
        pattern: stringValue(args.globPattern ?? args.pattern),
      };
      const target = stringValue(args.targetDirectory ?? args.target_directory ?? args.path);
      if (target) out.path = target;
      return out;
    }

    case 'grepToolCall': {
      const out: Record<string, unknown> = {
        pattern: stringValue(args.pattern),
      };
      const target = stringValue(args.path ?? args.targetDirectory);
      if (target) out.path = target;
      if (args.outputMode) out.output_mode = stringValue(args.outputMode);
      if (args.glob) out.glob = stringValue(args.glob);
      if (args.caseInsensitive === true) out['-i'] = true;
      if (args.multiline === true) out.multiline = true;
      return out;
    }

    case 'lsToolCall':
      return { path: stringValue(args.path ?? args.targetDirectory) || '.' };

    case 'webFetchToolCall':
    case 'fetchToolCall':
      return { url: stringValue(args.url ?? args.target) };

    case 'webSearchToolCall': {
      const queries = stringArray(args.queries);
      const query = stringValue(args.query) || queries[0] || '';
      const out: Record<string, unknown> = {};
      if (query) out.query = query;
      if (queries.length > 0) out.queries = queries;
      return out;
    }

    case 'semSearchToolCall':
      return { query: stringValue(args.query) };

    case 'updateTodosToolCall':
    case 'readTodosToolCall':
      return { todos: normalizeTodosArg(args) };

    case 'askQuestionToolCall':
      return { questions: normalizeQuestionsArg(args) };

    case 'taskToolCall': {
      const out: Record<string, unknown> = {
        description: stringValue(args.description),
        prompt: stringValue(args.prompt ?? args.message ?? args.task),
      };
      if (typeof args.run_in_background === 'boolean') {
        out.run_in_background = args.run_in_background;
      } else if (typeof args.runInBackground === 'boolean') {
        out.run_in_background = args.runInBackground;
      }
      const subagent = stringValue(args.subagent_type ?? args.subagentType ?? args.agent);
      if (subagent) out.subagent_type = subagent;
      return out;
    }

    case 'mcpToolCall': {
      const out: Record<string, unknown> = { ...args };
      const server = stringValue(args.server);
      const tool = stringValue(args.tool ?? args.name);
      if (server) out.server = server;
      if (tool) out.tool = tool;
      return out;
    }

    default:
      return { ...args };
  }
}

function formatSuccessContent(
  kind: string,
  success: Record<string, unknown>,
  args: Record<string, unknown>,
): string {
  switch (kind) {
    case 'readToolCall':
      return stringValue(success.content);

    case 'writeToolCall':
    case 'editToolCall': {
      const message = stringValue(success.message);
      const diff = stringValue(success.diffString);
      return diff ? `${message}\n\n${diff}`.trim() : message;
    }

    case 'shellToolCall': {
      const stdout = stringValue(success.interleavedOutput ?? success.stdout);
      const stderr = stringValue(success.stderr);
      const exitCode = numericValue(success.exitCode);
      const lines: string[] = [];
      if (stdout) lines.push(stdout.trimEnd());
      if (stderr && stderr.trim() && stderr !== stdout) {
        lines.push(`[stderr]\n${stderr.trimEnd()}`);
      }
      if (exitCode !== null && exitCode !== 0) {
        lines.push(`Exit code: ${exitCode}`);
      }
      return lines.join('\n').trim();
    }

    case 'writeShellStdinToolCall':
      return stringValue(success.message) || 'Sent';

    case 'globToolCall': {
      const files = stringArray(success.files);
      if (files.length === 0) {
        return `No files matched ${stringValue(args.globPattern ?? args.pattern) || 'pattern'}`;
      }
      const total = numericValue(success.totalFiles) ?? files.length;
      const header = `Found ${total} file${total === 1 ? '' : 's'}:`;
      return `${header}\n${files.join('\n')}`;
    }

    case 'grepToolCall':
      return formatGrepSuccess(success);

    case 'lsToolCall': {
      const entries = stringArray(success.files ?? success.entries);
      return entries.join('\n');
    }

    case 'webFetchToolCall':
    case 'fetchToolCall':
      return stringValue(success.content ?? success.body ?? success.text);

    case 'webSearchToolCall':
      return stringifyResultPayload(success, 'WebSearch');

    case 'semSearchToolCall':
      return stringifyResultPayload(success, 'SemanticSearch');

    case 'updateTodosToolCall':
    case 'readTodosToolCall':
      return stringValue(success.message) || 'Updated todos';

    case 'askQuestionToolCall':
      return stringifyResultPayload(success, 'AskUserQuestion');

    case 'taskToolCall':
      return stringValue(success.result ?? success.output ?? success.message);

    case 'deleteToolCall':
      return stringValue(success.message) || `Deleted ${stringValue(args.path)}`;

    default:
      return stringifyResultPayload(success, kind);
  }
}

function buildToolUseResult(
  kind: string,
  success: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (kind !== 'writeToolCall' && kind !== 'editToolCall') {
    return undefined;
  }

  const filePath = stringValue(success.path) || stringValue(args.path);
  const diffString = stringValue(success.diffString);
  if (!filePath || !diffString) {
    return undefined;
  }

  return {
    filePath,
    unifiedDiff: diffString,
    ...(typeof success.beforeFullFileContent === 'string'
      ? { before: success.beforeFullFileContent }
      : {}),
    ...(typeof success.afterFullFileContent === 'string'
      ? { after: success.afterFullFileContent }
      : {}),
  };
}

function formatGrepSuccess(success: Record<string, unknown>): string {
  const workspaceResults = success.workspaceResults;
  if (!workspaceResults || typeof workspaceResults !== 'object') {
    return '';
  }

  const lines: string[] = [];
  for (const [workspace, payload] of Object.entries(workspaceResults as Record<string, unknown>)) {
    if (!payload || typeof payload !== 'object') continue;
    const content = (payload as { content?: unknown }).content;
    if (!content || typeof content !== 'object') continue;

    const totalLines = numericValue((content as { totalLines?: unknown }).totalLines) ?? 0;
    const totalMatched = numericValue((content as { totalMatchedLines?: unknown }).totalMatchedLines) ?? 0;
    const matches = (content as { matches?: unknown }).matches;

    lines.push(
      Object.keys(workspaceResults).length > 1
        ? `[${workspace}] ${totalMatched} matches across ${totalLines} lines`
        : `${totalMatched} matches across ${totalLines} lines`,
    );

    if (Array.isArray(matches) && matches.length > 0) {
      for (const match of matches) {
        if (!match || typeof match !== 'object') continue;
        const file = stringValue((match as { file?: unknown }).file);
        const line = numericValue((match as { line?: unknown }).line);
        const text = stringValue((match as { text?: unknown }).text);
        const prefix = [file, line].filter(Boolean).join(':');
        lines.push(prefix ? `${prefix}: ${text}` : text);
      }
    }
  }

  return lines.join('\n').trim();
}

function pickErrorPayload(result: Record<string, unknown>): unknown {
  if ('error' in result) return (result as { error?: unknown }).error;
  if ('failure' in result) return (result as { failure?: unknown }).failure;
  if ('failed' in result) return (result as { failed?: unknown }).failed;
  return null;
}

function stringifyResultPayload(value: unknown, _name: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      out.push(entry);
    }
  }
  return out;
}

function normalizeTodosArg(args: Record<string, unknown>): Array<Record<string, unknown>> {
  const source = Array.isArray(args.todos)
    ? args.todos
    : Array.isArray(args.plan)
      ? args.plan
      : [];

  const out: Array<Record<string, unknown>> = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const text = stringValue(item.content ?? item.title ?? item.step ?? item.text);
    if (!text) continue;
    out.push({
      id: stringValue(item.id),
      content: text,
      activeForm: stringValue(item.activeForm) || text,
      status: stringValue(item.status) || 'pending',
    });
  }
  return out;
}

function normalizeQuestionsArg(args: Record<string, unknown>): Array<Record<string, unknown>> {
  const questions = args.questions;
  if (!Array.isArray(questions)) return [];

  const out: Array<Record<string, unknown>> = [];
  questions.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const options: Array<{ label: string; description: string }> = [];
    if (Array.isArray(item.options)) {
      for (const option of item.options) {
        if (typeof option === 'string') {
          options.push({ label: option, description: '' });
          continue;
        }
        if (!option || typeof option !== 'object') continue;
        const raw = option as Record<string, unknown>;
        const label = stringValue(raw.label ?? raw.title);
        if (!label) continue;
        options.push({ label, description: stringValue(raw.description) });
      }
    }

    out.push({
      question: stringValue(item.question) || `Question ${index + 1}`,
      ...(item.id ? { id: stringValue(item.id) } : {}),
      header: stringValue(item.header) || `Q${index + 1}`,
      options,
      multiSelect: Boolean(item.multiSelect ?? item.multi_select),
    });
  });
  return out;
}

function humanizeKind(kind: string): string {
  const stripped = kind.endsWith('ToolCall') ? kind.slice(0, -'ToolCall'.length) : kind;
  if (!stripped) return 'tool';
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}
