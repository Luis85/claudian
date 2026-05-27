import type { ProviderTaskResultInterpreter } from './types';

/**
 * Neutral interpreter for providers without async subagent tasks. Every method
 * reports "no async task," so the subagent flow falls back to synchronous handling.
 * Providers that lack async-task support omit `taskResultInterpreter` and the registry
 * substitutes this default — no per-provider no-op adapters required.
 */
export const noAsyncTaskInterpreter: ProviderTaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_toolUseResult, fallbackStatus) => fallbackStatus,
  extractTagValue: () => null,
};
