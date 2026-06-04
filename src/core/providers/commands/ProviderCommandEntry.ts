import type { SlashCommandSource } from '../../types/settings';
import type { ProviderId } from '../types';

export type ProviderCommandKind = 'command' | 'skill';
export type ProviderCommandScope = 'builtin' | 'vault' | 'user' | 'system' | 'runtime';

export interface ProviderCommandEntry {
  id: string;
  providerId: ProviderId;
  kind: ProviderCommandKind;
  name: string;
  description?: string;
  content: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  scope: ProviderCommandScope;
  source: SlashCommandSource;
  isEditable: boolean;
  isDeletable: boolean;
  displayPrefix: string;
  insertPrefix: string;
  /**
   * Opaque provider-owned persistence token used to preserve storage location
   * across edits, renames, and deletes in shared settings UIs.
   */
  persistenceKey?: string;
  /**
   * Absolute or vault-relative path to the file that defines this command/skill.
   * Set for entries backed by an editable file on disk — vault SKILL.md
   * (`.claude/skills/<name>/SKILL.md`), home-scope skills (`~/.codex/skills/...`),
   * etc. Undefined for runtime-discovered entries (e.g. Opencode skills) and
   * SDK built-ins. Consumers use it to surface an "open file" affordance or
   * jump to provider settings pre-focused on this entry.
   */
  sourceFilePath?: string;
}
