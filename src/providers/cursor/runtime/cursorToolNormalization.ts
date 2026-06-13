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
import { cleanToolPathCandidate } from '../../../utils/fileLink';
import { formatCursorGrepSuccess } from './cursorGrepFormatting';
import {
  buildCursorTaskToolUseResult,
  extractCursorTaskResultText,
  parseCursorSubagentType,
} from './cursorTaskPayload';
import { mapCursorToolNameFromKind } from './cursorToolNameMap';

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

// A single tool result (e.g. a whole-vault audit) can be many megabytes.
// Rendering that synchronously in the chat panel freezes Obsidian's UI thread,
// so the displayed content is capped. The agent still receives the full result.
export const MAX_CURSOR_TOOL_RESULT_CHARS = 100_000;

export function capCursorToolResultLength(value: string): string {
  if (value.length <= MAX_CURSOR_TOOL_RESULT_CHARS) {
    return value;
  }
  const omitted = value.length - MAX_CURSOR_TOOL_RESULT_CHARS;
  return `${value.slice(0, MAX_CURSOR_TOOL_RESULT_CHARS)}\n… [truncated ${omitted} characters]`;
}

const CURSOR_SDK_NAME_TO_KIND: Partial<Record<string, string>> = {
  [TOOL_READ]: 'readToolCall',
  [TOOL_BASH]: 'shellToolCall',
  [TOOL_GLOB]: 'globToolCall',
  [TOOL_GREP]: 'grepToolCall',
  [TOOL_LS]: 'lsToolCall',
  [TOOL_WEB_FETCH]: 'webFetchToolCall',
  [TOOL_WEB_SEARCH]: 'webSearchToolCall',
  [TOOL_TODO_WRITE]: 'updateTodosToolCall',
  [TOOL_ASK_USER_QUESTION]: 'askQuestionToolCall',
  [TOOL_SUBAGENT]: 'taskToolCall',
  [TOOL_EDIT]: 'replaceEnvToolCall',
};

/**
 * Canonical tool names Cursor can emit through `resolveCursorToolKind`.
 *
 * Includes every key in `CURSOR_SDK_NAME_TO_KIND` plus `TOOL_WRITE`, which is
 * resolved by argument-shape logic in `resolveCursorToolKind` (oldString /
 * newString → `replaceEnvToolCall`; streamContent / content → `editToolCall`;
 * default → `writeToolCall`) rather than appearing in the direct map. Wired
 * onto `ProviderRegistration.canonicalToolNames` so the seam can enumerate
 * Cursor tools without a provider-id branch (ADR-0001 Phase 1).
 */
export const CURSOR_CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(CURSOR_SDK_NAME_TO_KIND),
  TOOL_WRITE,
]);

/**
 * Resolves the Cursor `*ToolCall` kind key from either a native kind
 * (`readToolCall`) or an already-normalized SDK tool name (`Read`).
 */
export function resolveCursorToolKind(
  toolName: string,
  args: Record<string, unknown> = {},
): string | null {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.endsWith('ToolCall')) {
    return trimmed;
  }

  if (trimmed === TOOL_WRITE) {
    if ('oldString' in args || 'old_string' in args || 'newString' in args || 'new_string' in args) {
      return 'replaceEnvToolCall';
    }
    if ('streamContent' in args || 'content' in args) {
      return 'editToolCall';
    }
    return 'writeToolCall';
  }

  return CURSOR_SDK_NAME_TO_KIND[trimmed] ?? null;
}

/** Normalizes a tool-call row from Cursor's SQLite history blobs. */
export function normalizeCursorPersistedToolCall(
  toolName: string,
  args: Record<string, unknown>,
  description?: string,
): NormalizedCursorTool {
  const kind = resolveCursorToolKind(toolName, args);
  if (!kind) {
    return { name: toolName.trim() || 'tool', input: args };
  }
  return normalizeCursorToolStart({
    kind,
    args,
    result: undefined,
    description,
  });
}

function wrapPersistedToolResultPayload(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if ('success' in obj || 'error' in obj || 'failure' in obj || 'failed' in obj) {
      return obj;
    }
    return { success: obj };
  }
  if (typeof result === 'string') {
    return { success: { content: result } };
  }
  return { success: { message: String(result ?? '') } };
}

/** Normalizes a tool-result row from Cursor's SQLite history blobs. */
export function normalizeCursorPersistedToolResult(
  toolName: string,
  result: unknown,
  args: Record<string, unknown> = {},
  description?: string,
): NormalizedCursorToolResult {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const envelope = readCursorToolEnvelope(result as Record<string, unknown>);
    if (envelope) {
      const normalized = normalizeCursorToolCompletion(envelope);
      return {
        ...normalized,
        content: capCursorToolResultLength(normalized.content),
      };
    }
  }

  const kind = resolveCursorToolKind(toolName, args);
  if (!kind) {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    return {
      name: toolName.trim() || 'tool',
      content: capCursorToolResultLength(content),
      isError: false,
    };
  }

  const normalized = normalizeCursorToolCompletion({
    kind,
    args,
    result: wrapPersistedToolResultPayload(result),
    description,
  });
  return {
    ...normalized,
    content: capCursorToolResultLength(normalized.content),
  };
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
  return mapCursorToolNameFromKind(kind);
}

type CursorInputMapper = (args: Record<string, unknown>, description: string | undefined) => Record<string, unknown>;

const mapWriteInput: CursorInputMapper = (args) => ({
  file_path: stringValue(args.path),
  content: stringValue(args.streamContent ?? args.content),
});

const mapFetchInput: CursorInputMapper = (args) => ({
  url: stringValue(args.url ?? args.target),
});

const mapTodosInput: CursorInputMapper = (args) => ({ todos: normalizeTodosArg(args) });

function mapShellInput(args: Record<string, unknown>, description: string | undefined): Record<string, unknown> {
  const command = stringValue(args.command);
  const cwd = stringValue(args.workingDirectory);
  const out: Record<string, unknown> = { command };
  if (cwd) out.cwd = cwd;
  if (description) out.description = description;
  return out;
}

function mapGlobInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pattern: stringValue(args.globPattern ?? args.pattern),
  };
  const target = stringValue(args.targetDirectory ?? args.target_directory ?? args.path);
  if (target) out.path = target;
  return out;
}

function mapGrepInput(args: Record<string, unknown>): Record<string, unknown> {
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

function mapWebSearchInput(args: Record<string, unknown>): Record<string, unknown> {
  const queries = stringArray(args.queries);
  const query = stringValue(args.query) || queries[0] || '';
  const out: Record<string, unknown> = {};
  if (query) out.query = query;
  if (queries.length > 0) out.queries = queries;
  return out;
}

function resolveTaskRunInBackground(args: Record<string, unknown>): boolean | undefined {
  if (typeof args.run_in_background === 'boolean') return args.run_in_background;
  if (typeof args.runInBackground === 'boolean') return args.runInBackground;
  const mode = stringValue(args.mode);
  if (mode === 'TASK_MODE_BACKGROUND') return true;
  if (mode === 'TASK_MODE_SYNCHRONOUS' || mode === 'TASK_MODE_SYNC') return false;
  return undefined;
}

function mapTaskInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    description: stringValue(args.description),
    prompt: stringValue(args.prompt ?? args.message ?? args.task),
  };
  const runInBackground = resolveTaskRunInBackground(args);
  if (runInBackground !== undefined) out.run_in_background = runInBackground;
  const subagent =
    parseCursorSubagentType(args.subagentType ?? args.subagent_type)
    ?? stringValue(args.subagent_type ?? args.subagentType ?? args.agent);
  if (subagent) out.subagent_type = subagent;
  return out;
}

function mapMcpInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  const server = stringValue(args.server);
  const tool = stringValue(args.tool ?? args.name);
  if (server) out.server = server;
  if (tool) out.tool = tool;
  return out;
}

const CURSOR_TOOL_INPUT_MAPPERS: Partial<Record<string, CursorInputMapper>> = {
  readToolCall: (args) => ({ file_path: stringValue(args.path) }),
  writeToolCall: mapWriteInput,
  editToolCall: mapWriteInput,
  replaceEnvToolCall: (args) => ({
    file_path: stringValue(args.path),
    old_string: stringValue(args.oldString ?? args.old_string),
    new_string: stringValue(args.newString ?? args.new_string),
  }),
  deleteToolCall: (args) => ({ path: stringValue(args.path) }),
  shellToolCall: mapShellInput,
  writeShellStdinToolCall: (args) => ({
    session_id: stringValue(args.sessionId ?? args.session_id),
    chars: stringValue(args.chars ?? args.text),
  }),
  globToolCall: mapGlobInput,
  grepToolCall: mapGrepInput,
  lsToolCall: (args) => ({ path: stringValue(args.path ?? args.targetDirectory) || '.' }),
  webFetchToolCall: mapFetchInput,
  fetchToolCall: mapFetchInput,
  webSearchToolCall: mapWebSearchInput,
  semSearchToolCall: (args) => ({ query: stringValue(args.query) }),
  updateTodosToolCall: mapTodosInput,
  readTodosToolCall: mapTodosInput,
  askQuestionToolCall: (args) => ({ questions: normalizeQuestionsArg(args) }),
  taskToolCall: mapTaskInput,
  mcpToolCall: mapMcpInput,
};

function mapCursorToolInput(
  kind: string,
  args: Record<string, unknown>,
  description: string | undefined,
): Record<string, unknown> {
  const mapper = CURSOR_TOOL_INPUT_MAPPERS[kind];
  return mapper ? mapper(args, description) : { ...args };
}

type CursorSuccessFormatter = (success: Record<string, unknown>, args: Record<string, unknown>) => string;

const formatWriteSuccess: CursorSuccessFormatter = (success) => {
  const message = stringValue(success.message);
  const diff = stringValue(success.diffString);
  return diff ? `${message}\n\n${diff}`.trim() : message;
};

const formatFetchSuccess: CursorSuccessFormatter = (success) =>
  stringValue(success.content ?? success.body ?? success.text);

const formatTodosSuccess: CursorSuccessFormatter = (success) =>
  stringValue(success.message) || 'Updated todos';

function formatShellSuccess(success: Record<string, unknown>): string {
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

function formatGlobSuccess(success: Record<string, unknown>, args: Record<string, unknown>): string {
  const files = stringArray(success.files).map(cleanToolPathCandidate).filter(Boolean);
  if (files.length === 0) {
    return `No files matched ${stringValue(args.globPattern ?? args.pattern) || 'pattern'}`;
  }
  const total = numericValue(success.totalFiles) ?? files.length;
  const header = `Found ${total} file${total === 1 ? '' : 's'}:`;
  return `${header}\n${files.join('\n')}`;
}

function formatTaskSuccess(success: Record<string, unknown>): string {
  const structured = extractCursorTaskResultText(success);
  if (structured) return structured;
  return stringValue(success.result ?? success.output ?? success.message);
}

const CURSOR_SUCCESS_FORMATTERS: Partial<Record<string, CursorSuccessFormatter>> = {
  readToolCall: (success) => stringValue(success.content),
  writeToolCall: formatWriteSuccess,
  editToolCall: formatWriteSuccess,
  shellToolCall: formatShellSuccess,
  writeShellStdinToolCall: (success) => stringValue(success.message) || 'Sent',
  globToolCall: formatGlobSuccess,
  grepToolCall: (success) => formatCursorGrepSuccess(success, { stringValue, numericValue }),
  lsToolCall: (success) => stringArray(success.files ?? success.entries).join('\n'),
  webFetchToolCall: formatFetchSuccess,
  fetchToolCall: formatFetchSuccess,
  webSearchToolCall: (success) => stringifyResultPayload(success, 'WebSearch'),
  semSearchToolCall: (success) => stringifyResultPayload(success, 'SemanticSearch'),
  updateTodosToolCall: formatTodosSuccess,
  readTodosToolCall: formatTodosSuccess,
  askQuestionToolCall: (success) => stringifyResultPayload(success, 'AskUserQuestion'),
  taskToolCall: formatTaskSuccess,
  deleteToolCall: (success, args) => stringValue(success.message) || `Deleted ${stringValue(args.path)}`,
};

function formatSuccessContent(
  kind: string,
  success: Record<string, unknown>,
  args: Record<string, unknown>,
): string {
  const formatter = CURSOR_SUCCESS_FORMATTERS[kind];
  return formatter ? formatter(success, args) : stringifyResultPayload(success, kind);
}

function buildToolUseResult(
  kind: string,
  success: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (kind === 'taskToolCall') {
    return buildCursorTaskToolUseResult(success, args);
  }

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
