export interface OpencodeProviderState {
  databasePath?: string;
  // Structural index so the type assigns to `Record<string, unknown>`, which
  // the registry-erased `ProviderConversationHistoryService` field demands.
  [key: string]: unknown;
}

export function getOpencodeState(
  providerState?: Record<string, unknown>,
): OpencodeProviderState {
  return (providerState ?? {});
}
