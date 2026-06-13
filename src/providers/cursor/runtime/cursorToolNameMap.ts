/**
 * Cursor `*ToolCall` kind → Claude-vocabulary tool name lookup.
 *
 * Extracted from `cursorToolNormalization` so the mapping stays a flat,
 * data-driven table instead of a deep switch (which tripped the cyclomatic
 * complexity gate). Add new Cursor kinds here, not in branching code.
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

/**
 * Direct Cursor kind → canonical name pairs. Several Cursor kinds collapse onto
 * the same Claude tool (e.g. `editToolCall`/`writeToolCall` → Write,
 * `partialToolCall`/`truncatedToolCall` → the generic `tool` placeholder).
 */
const CURSOR_KIND_TO_TOOL_NAME: Partial<Record<string, string>> = {
  readToolCall: TOOL_READ,
  writeToolCall: TOOL_WRITE,
  editToolCall: TOOL_WRITE,
  replaceEnvToolCall: TOOL_EDIT,
  deleteToolCall: 'delete',
  shellToolCall: TOOL_BASH,
  writeShellStdinToolCall: 'write_stdin',
  globToolCall: TOOL_GLOB,
  grepToolCall: TOOL_GREP,
  lsToolCall: TOOL_LS,
  webFetchToolCall: TOOL_WEB_FETCH,
  fetchToolCall: TOOL_WEB_FETCH,
  webSearchToolCall: TOOL_WEB_SEARCH,
  semSearchToolCall: 'SemanticSearch',
  updateTodosToolCall: TOOL_TODO_WRITE,
  readTodosToolCall: TOOL_TODO_WRITE,
  askQuestionToolCall: TOOL_ASK_USER_QUESTION,
  taskToolCall: TOOL_SUBAGENT,
  mcpToolCall: 'Mcp',
  listMcpResourcesToolCall: 'ListMcpResources',
  readMcpResourceToolCall: 'ReadMcpResource',
  getMcpToolsToolCall: 'ListMcpTools',
  createPlanToolCall: 'CreatePlan',
  switchModeToolCall: 'SwitchMode',
  reflectToolCall: 'Reflect',
  awaitToolCall: 'Await',
  applyAgentDiffToolCall: 'apply_patch',
  computerUseToolCall: 'ComputerUse',
  generateImageToolCall: 'GenerateImage',
  recordScreenToolCall: 'RecordScreen',
  readLintsToolCall: 'ReadLints',
  startGrindPlanningToolCall: 'GrindPlan',
  startGrindExecutionToolCall: 'GrindExecute',
  reportBugfixResultsToolCall: 'ReportBugfix',
  setupVmEnvironmentToolCall: 'SetupVm',
  aiAttributionToolCall: 'AiAttribution',
  partialToolCall: 'tool',
  truncatedToolCall: 'tool',
};

/** Lowercases the Cursor kind (stripping `ToolCall`) for unrecognized tools. */
function humanizeKind(kind: string): string {
  const stripped = kind.endsWith('ToolCall') ? kind.slice(0, -'ToolCall'.length) : kind;
  if (!stripped) return 'tool';
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

/**
 * Maps a Cursor `*ToolCall` kind to the Claude-vocabulary tool name. Unknown
 * kinds fall back to a humanized form so the renderer still shows a label.
 */
export function mapCursorToolNameFromKind(kind: string): string {
  return CURSOR_KIND_TO_TOOL_NAME[kind] ?? humanizeKind(kind);
}
