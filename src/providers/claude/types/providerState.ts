import type { ForkSource } from '../../../core/types/chat';
import type { SubagentInfo } from '../../../core/types/tools';

export interface ClaudeProviderState {
  providerSessionId?: string;
  previousProviderSessionIds?: string[];
  forkSource?: ForkSource;
  subagentData?: Record<string, SubagentInfo>;
  // Structural index so the type assigns to `Record<string, unknown>`, which
  // the registry-erased `ProviderConversationHistoryService` field demands.
  // Drops the `as unknown as ProviderConversationHistoryService` cast at the
  // registration site without weakening the runtime shape.
  [key: string]: unknown;
}

/** Extracts typed Claude provider state from the opaque bag. */
export function getClaudeState(
  providerState: Record<string, unknown> | undefined,
): ClaudeProviderState {
  return (providerState ?? {});
}
