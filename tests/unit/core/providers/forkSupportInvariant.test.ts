import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { hasForkSupport } from '@/core/providers/typeGuards';
import type { ProviderId } from '@/core/providers/types';

describe('history service fork-support invariant', () => {
  const providers: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];
  const forkCapableProviders = providers.filter(
    id => ProviderRegistry.getCapabilities(id).supportsFork,
  );

  it.each(providers)('%s: capabilities.supportsFork agrees with !!service.forkSupport', (id) => {
    const capabilities = ProviderRegistry.getCapabilities(id);
    const service = ProviderRegistry.getConversationHistoryService(id);
    expect(capabilities.supportsFork).toBe(!!service.forkSupport);
  });

  it.each(forkCapableProviders)('%s: hasForkSupport guard narrows the slot when capability is true', (id) => {
    const service = ProviderRegistry.getConversationHistoryService(id);
    // Guard returns true; the assertion below pins the narrowing for tooling.
    expect(hasForkSupport(service)).toBe(true);
    if (!hasForkSupport(service)) throw new Error('unreachable per assertion above');
    expect(typeof service.forkSupport.isPendingForkConversation).toBe('function');
    expect(typeof service.forkSupport.buildForkProviderState).toBe('function');
  });
});
