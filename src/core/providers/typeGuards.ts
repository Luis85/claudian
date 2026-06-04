import type {
  ProviderConversationHistoryService,
  ProviderForkSupport,
} from './types';

/**
 * Narrows a history service to one that owns a `forkSupport` slot. Use this at
 * every call site that needs to read `service.forkSupport.*` so the optional
 * slot is type-level non-null inside the guard — no runtime throw needed.
 *
 * Registry invariant (forkSupportInvariant.test.ts): the guard returns true if
 * and only if `capabilities.supportsFork === true`. Code paths that already
 * gated on the capability flag can swap the runtime check for this guard.
 */
export function hasForkSupport(
  service: ProviderConversationHistoryService,
): service is ProviderConversationHistoryService & { forkSupport: ProviderForkSupport } {
  return !!service.forkSupport;
}
