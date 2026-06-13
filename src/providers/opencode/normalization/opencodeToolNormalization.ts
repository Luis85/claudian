import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { AskUserAnswers, AskUserQuestionItem } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { AcpToolStreamAdapter } from '../../acp';

const TOOL_NAME_MAP: Record<string, string> = {
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  skill: TOOL_SKILL,
  task: TOOL_TASK,
  todowrite: TOOL_TODO_WRITE,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
};

/**
 * Canonical tool names Opencode can emit after normalization.
 *
 * Derived as the value-set of `TOOL_NAME_MAP`. Wired onto
 * `ProviderRegistration.canonicalToolNames` so the seam can enumerate Opencode
 * tools without a provider-id branch (ADR-0001 Phase 1).
 */
export const OPENCODE_CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  Object.values(TOOL_NAME_MAP),
);

type OpencodeKnownToolName = keyof typeof TOOL_NAME_MAP;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKnownToolName(value: unknown): value is OpencodeKnownToolName {
  if (typeof value !== 'string') {
    return false;
  }

  return value.trim().toLowerCase() in TOOL_NAME_MAP;
}

function toKnownToolName(value: string | undefined): OpencodeKnownToolName | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isKnownToolName(normalized)
    ? normalized
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function firstTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string {
  return firstTrimmedString(...values) ?? '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueValues = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    uniqueValues.add(trimmed);
  }

  return [...uniqueValues];
}

function normalizeQuestionOptions(value: unknown): Array<{ description: string; label: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (typeof option === 'string') {
      const label = option.trim();
      return label ? [{ description: '', label }] : [];
    }

    if (!isPlainObject(option)) {
      return [];
    }

    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label) {
      return [];
    }

    return [{
      description: typeof option.description === 'string' ? option.description : '',
      label,
    }];
  });
}

function normalizeQuestionItems(value: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = isPlainObject(item) ? item : {};
    const question = firstTrimmedString(record.question) ?? `Question ${index + 1}`;
    const header = firstTrimmedString(record.header) ?? `Q${index + 1}`;

    return {
      ...(typeof record.id === 'string' && record.id.trim()
        ? { id: record.id }
        : {}),
      header,
      multiSelect: record.multiSelect === true || record.multi_select === true || record.multiple === true,
      options: normalizeQuestionOptions(record.options),
      question,
    };
  });
}

function normalizeTodoStatus(value: unknown): 'completed' | 'in_progress' | 'pending' {
  switch (value) {
    case 'completed':
    case 'cancelled':
      return 'completed';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function normalizeTodos(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }

    const content = firstTrimmedString(item.content, item.title, item.description);
    if (!content) {
      return [];
    }

    return [{
      activeForm: firstTrimmedString(item.activeForm, item.active_form) ?? content,
      content,
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      status: normalizeTodoStatus(item.status),
    }];
  });
}

function normalizeQuestionAnswers(
  rawAnswers: unknown,
  questions: AskUserQuestionItem[],
): AskUserAnswers | undefined {
  if (!Array.isArray(rawAnswers) || questions.length === 0) {
    return undefined;
  }

  const answers: AskUserAnswers = {};

  for (let index = 0; index < Math.min(rawAnswers.length, questions.length); index += 1) {
    const question = questions[index];
    const rawEntry = (rawAnswers as unknown[])[index];
    if (!question) {
      continue;
    }

    const values = Array.isArray(rawEntry)
      ? rawEntry
          .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : typeof rawEntry === 'string' && rawEntry.trim().length > 0
      ? [rawEntry]
      : [];

    if (values.length === 0) {
      continue;
    }

    const normalizedValue = values.length === 1 ? values[0] : values;
    answers[question.question] = normalizedValue;
    if (question.id) {
      answers[question.id] = normalizedValue;
    }
  }

  return Object.keys(answers).length > 0 ? answers : undefined;
}

function extractToolMetadata(rawOutput: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawOutput)) {
    return null;
  }

  return isPlainObject(rawOutput.metadata) ? rawOutput.metadata : null;
}

export function resolveOpencodeRawToolName(
  currentRawName: string | undefined,
  update: {
    kind?: string | null;
    title?: string | null;
  },
): string {
  const titleName = firstTrimmedString(update.title);
  const knownTitleName = titleName && isKnownToolName(titleName)
    ? titleName.trim().toLowerCase()
    : undefined;

  if (knownTitleName) {
    return knownTitleName;
  }

  if (currentRawName) {
    return currentRawName;
  }

  switch (update.kind) {
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'webfetch';
    case 'read':
      return 'read';
    default:
      return titleName ?? 'tool';
  }
}

function normalizeWebSearchInput(input: Record<string, unknown>): Record<string, unknown> {
  const action = isPlainObject(input.action)
    ? input.action
    : {};

  const queries = normalizeStringArray(action.queries ?? input.queries);
  const query = firstNonEmptyString(action.query, input.query, queries[0]);
  const url = firstNonEmptyString(action.url, input.url);
  const pattern = firstNonEmptyString(action.pattern, input.pattern);
  const explicitType = firstNonEmptyString(action.type, input.actionType, input.action_type);

  const actionType = explicitType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  const normalized: Record<string, unknown> = {};
  if (actionType) {
    normalized.actionType = actionType;
  }
  if (query) {
    normalized.query = query;
  }
  if (queries.length > 0) {
    normalized.queries = queries;
  }
  if (url) {
    normalized.url = url;
  }
  if (pattern) {
    normalized.pattern = pattern;
  }

  return normalized;
}

export function normalizeOpencodeToolName(rawName: string | undefined): string {
  const knownName = toKnownToolName(rawName);
  if (!knownName) {
    return rawName?.trim() || 'tool';
  }

  return TOOL_NAME_MAP[knownName];
}

function normalizeQuestionInput(input: Record<string, unknown>): Record<string, unknown> {
  return { questions: normalizeQuestionItems(input.questions) };
}

function normalizeReadInput(input: Record<string, unknown>): Record<string, unknown> {
  const filePath = firstString(input.file_path, input.filePath);
  return {
    ...(filePath ? { file_path: filePath } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
  };
}

function normalizeWriteInput(input: Record<string, unknown>): Record<string, unknown> {
  const filePath = firstString(input.file_path, input.filePath);
  return {
    ...(typeof input.content === 'string' ? { content: input.content } : {}),
    ...(filePath ? { file_path: filePath } : {}),
  };
}

function normalizeReplaceAll(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.replace_all === 'boolean') {
    return { replace_all: input.replace_all };
  }
  if (typeof input.replaceAll === 'boolean') {
    return { replace_all: input.replaceAll };
  }
  return {};
}

function normalizeEditInput(input: Record<string, unknown>): Record<string, unknown> {
  const filePath = firstString(input.file_path, input.filePath);
  const oldString = firstString(input.old_string, input.oldString);
  const newString = firstString(input.new_string, input.newString);
  return {
    ...(filePath ? { file_path: filePath } : {}),
    ...(oldString ? { old_string: oldString } : {}),
    ...(newString ? { new_string: newString } : {}),
    ...normalizeReplaceAll(input),
  };
}

function normalizeTaskInput(input: Record<string, unknown>): Record<string, unknown> {
  const command = firstTrimmedString(input.command);
  const description = firstTrimmedString(input.description);
  const prompt = firstTrimmedString(input.prompt);
  const subagentType = firstTrimmedString(input.subagent_type);
  const taskId = firstTrimmedString(input.task_id);
  return {
    ...(command ? { command } : {}),
    ...(description ? { description } : {}),
    ...(prompt ? { prompt } : {}),
    ...(input.run_in_background === true || input.run_in_background === false
      ? { run_in_background: input.run_in_background }
      : {}),
    ...(subagentType ? { subagent_type: subagentType } : {}),
    ...(taskId ? { task_id: taskId } : {}),
  };
}

function normalizeTodoWriteInput(input: Record<string, unknown>): Record<string, unknown> {
  return { todos: normalizeTodos(input.todos) };
}

function normalizeSkillInput(input: Record<string, unknown>): Record<string, unknown> {
  const skill = firstTrimmedString(input.skill, input.name);
  return skill ? { skill } : {};
}

/**
 * Per-tool input normalizers, keyed by canonical Opencode tool name. Dispatching
 * through this table keeps {@link normalizeOpencodeToolInput} flat: each tool's
 * conditional shaping lives in its own helper instead of one large switch.
 */
const TOOL_INPUT_NORMALIZERS: Partial<
  Record<OpencodeKnownToolName, (input: Record<string, unknown>) => Record<string, unknown>>
> = {
  edit: normalizeEditInput,
  question: normalizeQuestionInput,
  read: normalizeReadInput,
  skill: normalizeSkillInput,
  task: normalizeTaskInput,
  todowrite: normalizeTodoWriteInput,
  websearch: normalizeWebSearchInput,
  write: normalizeWriteInput,
};

export function normalizeOpencodeToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const knownName = toKnownToolName(rawName);
  const normalizer = knownName ? TOOL_INPUT_NORMALIZERS[knownName] : undefined;
  return normalizer ? normalizer(input) : input;
}

export function normalizeOpencodeToolUseResult(
  rawName: string | undefined,
  input: Record<string, unknown>,
  rawOutput: unknown,
): SDKToolUseResult | undefined {
  const knownName = toKnownToolName(rawName);
  const metadata = extractToolMetadata(rawOutput);
  const normalized: SDKToolUseResult = {};

  if (
    (knownName === 'write' || knownName === 'edit')
    && firstString(input.file_path, input.filePath, metadata?.filepath, metadata?.filePath)
  ) {
    normalized.filePath = firstString(input.file_path, input.filePath, metadata?.filepath, metadata?.filePath);
  }

  if (knownName === 'question') {
    const questions = Array.isArray(input.questions)
      ? input.questions as AskUserQuestionItem[]
      : [];
    const answers = normalizeQuestionAnswers(metadata?.answers, questions);
    if (answers) {
      normalized.answers = answers;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createOpencodeToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeOpencodeToolInput,
    normalizeToolName: normalizeOpencodeToolName,
    normalizeToolUseResult: normalizeOpencodeToolUseResult,
    resolveRawToolName: resolveOpencodeRawToolName,
  });
}
