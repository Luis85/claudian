import {
  isAgentLifecycleTool,
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';

export function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function getInputText(input: Record<string, unknown>, key: string, fallback = ''): string {
  return stringifyToolValue(input[key]) || fallback;
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

export function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export function parseToolSearchQuery(query: string | undefined): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

export function getApplyPatchSummary(input: Record<string, unknown>): string {
  // Extract file paths from patch text markers
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(m => m[1]?.trim() ?? '');

  // Also check changes array
  const changes = input.changes;
  const changeFiles = Array.isArray(changes)
    ? (changes as Array<{ path?: string }>)
        .map(c => c.path)
        .filter((p): p is string => !!p)
    : [];

  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return fileNameOnly(files[0]);
  return `${files.length} files`;
}

export function getWriteStdinSummary(input: Record<string, unknown>): string {
  const sessionId = stringifyToolValue(input.session_id ?? input.sessionId);
  const chars = typeof input.chars === 'string' ? input.chars.replace(/\n/g, '\\n') : '';
  if (chars) {
    const preview = chars.length > 24 ? `${chars.slice(0, 24)}...` : chars;
    return sessionId ? `#${sessionId} ${preview}` : preview;
  }
  return sessionId ? `#${sessionId}` : '';
}

export function getAgentLifecycleSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'spawn_agent': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 50 ? `${msg.slice(0, 50)}...` : msg;
    }
    case 'send_input': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 40 ? `${msg.slice(0, 40)}...` : msg;
    }
    case 'wait': {
      const ids = Array.isArray(input.ids) ? input.ids.length : 0;
      const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
      const parts: string[] = [];
      if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
      if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
      return parts.join(', ');
    }
    case 'resume_agent':
    case 'close_agent':
      return '';
    default:
      return '';
  }
}

export interface WebSearchDisplayData {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
}

export function normalizeWebSearchDisplayData(input: Record<string, unknown>): WebSearchDisplayData {
  const queries = Array.isArray(input.queries)
    ? input.queries
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim())
    : [];

  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : queries[0] ?? '';
  const url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : '';
  const pattern = typeof input.pattern === 'string' && input.pattern.trim() ? input.pattern.trim() : '';

  const explicitActionType = typeof input.actionType === 'string' && input.actionType.trim()
    ? input.actionType.trim()
    : '';
  const actionType = explicitActionType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  return { actionType, query, queries, url, pattern };
}

export function getWebSearchSummary(input: Record<string, unknown>, maxLength: number): string {
  const data = normalizeWebSearchDisplayData(input);

  switch (data.actionType) {
    case 'open_page':
      return truncateText(`Open ${data.url || 'page'}`, maxLength);
    case 'find_in_page': {
      const target = data.pattern ? `Find "${data.pattern}"` : 'Find in page';
      const suffix = data.url ? ` in ${data.url}` : '';
      return truncateText(target + suffix, maxLength);
    }
    case 'search':
      return truncateText(data.query || data.queries[0] || '', maxLength);
    default:
      return truncateText(data.query || data.url || data.pattern || '', maxLength);
  }
}

function getWebSearchLabel(input: Record<string, unknown>, maxLength: number): string {
  const summary = getWebSearchSummary(input, maxLength);
  return `WebSearch: ${summary || 'search'}`;
}

function pathLabel(prefix: string, key: string, fallback: string) {
  return (input: Record<string, unknown>): string =>
    `${prefix}: ${shortenPath(getInputText(input, key)) || fallback}`;
}

function patternLabel(prefix: string, fallback: string) {
  return (input: Record<string, unknown>): string =>
    `${prefix}: ${getInputText(input, 'pattern', fallback)}`;
}

function truncatedLabel(prefix: string, key: string, fallback: string, maxLength: number) {
  return (input: Record<string, unknown>): string => {
    const value = getInputText(input, key, fallback);
    const truncated = value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
    return `${prefix}: ${truncated}`;
  };
}

function constantLabel(label: string) {
  return (): string => label;
}

function todoLabel(input: Record<string, unknown>): string {
  const todos = input.todos as Array<{ status: string }> | undefined;
  if (todos && Array.isArray(todos)) {
    const completed = todos.filter(t => t.status === 'completed').length;
    return `Tasks (${completed}/${todos.length})`;
  }
  return 'Tasks';
}

function skillLabel(input: Record<string, unknown>): string {
  return `Skill: ${getInputText(input, 'skill', 'skill')}`;
}

function toolSearchLabel(input: Record<string, unknown>): string {
  return `ToolSearch: ${parseToolSearchQuery(getInputText(input, 'query')) || 'tools'}`;
}

function summaryLabel(prefix: string, summary: string): string {
  return summary ? `${prefix}: ${summary}` : prefix;
}

type LabelBuilder = (input: Record<string, unknown>) => string;

const LABEL_BUILDERS: Record<string, LabelBuilder> = {
  [TOOL_READ]: pathLabel('Read', 'file_path', 'file'),
  [TOOL_WRITE]: pathLabel('Write', 'file_path', 'file'),
  [TOOL_EDIT]: pathLabel('Edit', 'file_path', 'file'),
  [TOOL_BASH]: truncatedLabel('Bash', 'command', 'command', 40),
  [TOOL_GLOB]: patternLabel('Glob', 'files'),
  [TOOL_GREP]: patternLabel('Grep', 'pattern'),
  [TOOL_WEB_SEARCH]: input => getWebSearchLabel(input, 40),
  [TOOL_WEB_FETCH]: truncatedLabel('WebFetch', 'url', 'url', 40),
  [TOOL_LS]: pathLabel('LS', 'path', '.'),
  [TOOL_TODO_WRITE]: todoLabel,
  [TOOL_SKILL]: skillLabel,
  [TOOL_TOOL_SEARCH]: toolSearchLabel,
  [TOOL_ENTER_PLAN_MODE]: constantLabel('Entering plan mode'),
  [TOOL_EXIT_PLAN_MODE]: constantLabel('Plan complete'),
  [TOOL_APPLY_PATCH]: input => summaryLabel('apply_patch', getApplyPatchSummary(input)),
  [TOOL_WRITE_STDIN]: input => summaryLabel('write_stdin', getWriteStdinSummary(input)),
};

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  const builder = LABEL_BUILDERS[name];
  if (builder) return builder(input);
  if (isAgentLifecycleTool(name)) {
    return summaryLabel(name, getAgentLifecycleSummary(name, input));
  }
  return name;
}
