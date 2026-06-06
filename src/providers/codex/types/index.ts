import type { ForkSource } from '../../../core/types/chat';

export interface CodexProviderState {
  threadId?: string;
  sessionFilePath?: string;
  transcriptRootPath?: string;
  forkSourceSessionFilePath?: string;
  forkSourceTranscriptRootPath?: string;
  forkSource?: ForkSource;
  // Structural index so the type assigns to `Record<string, unknown>`, which
  // the registry-erased `ProviderConversationHistoryService` field demands.
  [key: string]: unknown;
}

export function getCodexState(
  providerState?: Record<string, unknown>,
): CodexProviderState {
  return (providerState ?? {});
}
