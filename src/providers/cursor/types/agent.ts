export type CursorAgentSource = 'builtin' | 'vault' | 'global' | 'claude-compat' | 'codex-compat';

export interface CursorAgentDefinition {
  name: string;
  description: string;
  prompt: string;
  source: CursorAgentSource;
  /** Cursor model id (e.g. 'composer-2'); omitted = inherit the chat model. */
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
  persistenceKey?: string;
  extraFrontmatter?: Record<string, unknown>;
}

export const CURSOR_AGENT_KNOWN_KEYS = new Set([
  'name',
  'description',
  'model',
  'readonly',
  'is_background',
]);

/**
 * Cursor's CLI ships these agents (2.4+). They have no definition file and are
 * surfaced read-only for discovery/mentions.
 */
export const CURSOR_BUILTIN_AGENTS: readonly CursorAgentDefinition[] = Object.freeze([
  Object.freeze({
    name: 'Explore',
    description: 'Built-in Cursor subagent for read-only codebase exploration.',
    prompt: '',
    source: 'builtin' as const,
    readonly: true,
  }),
  Object.freeze({
    name: 'Bash',
    description: 'Built-in Cursor subagent for shell command execution.',
    prompt: '',
    source: 'builtin' as const,
  }),
  Object.freeze({
    name: 'Browser',
    description: 'Built-in Cursor subagent for browser-based tasks.',
    prompt: '',
    source: 'builtin' as const,
  }),
]);
