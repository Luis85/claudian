import {
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_BASH_OUTPUT,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_KILL_SHELL,
  TOOL_LIST_MCP_RESOURCES,
  TOOL_LS,
  TOOL_MCP,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_READ_MCP_RESOURCE,
  TOOL_SKILL,
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../core/tools/toolNames';

/**
 * Canonical tool names the Claude provider can emit.
 *
 * Claude routes through `@anthropic-ai/claude-agent-sdk`, whose native tool
 * vocabulary is already in Specorator's canonical form — no normalization map.
 * This set enumerates the SDK tools Specorator's UI is aware of (has icons,
 * dedicated renderers, or approval flows for). It backs
 * `ProviderRegistration.canonicalToolNames` so the seam can enumerate Claude
 * tools without a provider-id branch (ADR-0001 Phase 1).
 *
 * MCP-namespaced tools (`mcp__server__tool`) are not enumerated here — they
 * are user-attached and disambiguated at use time; the generic `TOOL_MCP`
 * catch-all stands in for the family.
 */
export const CLAUDE_CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  TOOL_BASH,
  TOOL_BASH_OUTPUT,
  TOOL_KILL_SHELL,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_SKILL,
  TOOL_TOOL_SEARCH,
  TOOL_LIST_MCP_RESOURCES,
  TOOL_READ_MCP_RESOURCE,
  TOOL_MCP,
]);
