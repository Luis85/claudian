import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';

/**
 * Provider-boundary regression test.
 *
 * Asserts the ProviderRegistry seam (ADR 0001) at runtime, *data-driven* over
 * whatever `getRegisteredProviderIds()` returns — so a newly registered
 * provider is automatically held to the same contract, and a provider that
 * registers an incomplete `ProviderRegistration` fails here instead of at some
 * distant call site. Complements the example-based assertions in
 * ProviderRegistry.test.ts; this one is the "every provider, every required
 * surface" sweep.
 */
describe('provider registration contract', () => {
  const providerIds = ProviderRegistry.getRegisteredProviderIds();

  beforeEach(() => {
    // Some runtimes read workspace services at construction. Register inert
    // stubs for every provider so the data-driven create loop stays decoupled
    // from any one provider's workspace wiring.
    ProviderWorkspaceRegistry.clear();
    for (const id of providerIds) {
      ProviderWorkspaceRegistry.setServices(id, {
        mcpManager: {} as never,
        mcpServerManager: {} as never,
      } as never);
    }
  });

  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
  });

  it('registers the built-in providers (subset check; a new provider needs no edit here)', () => {
    // Assert the built-ins are present rather than an exact set: an exact-list
    // toEqual would itself be a hardcoded provider list that a 5th provider
    // forces someone to edit — the very thing noHardcodedProviderList forbids.
    // A subset check still catches an accidentally dropped built-in.
    expect(providerIds).toEqual(
      expect.arrayContaining(['claude', 'codex', 'cursor', 'opencode']),
    );
    expect(providerIds.length).toBeGreaterThanOrEqual(4);
  });

  it.each(providerIds)('"%s" exposes a structurally complete registration', (id) => {
    expect(ProviderRegistry.getProviderDisplayName(id)).toBeTruthy();

    const caps = ProviderRegistry.getCapabilities(id);
    expect(caps.providerId).toBe(id);
    expect(typeof caps.supportsPlanMode).toBe('boolean');
    expect(typeof caps.supportsFork).toBe('boolean');
    expect(typeof caps.supportsRewind).toBe('boolean');

    const tools = ProviderRegistry.getCanonicalToolNames(id);
    expect(tools).toBeInstanceOf(Set);
    expect(tools.size).toBeGreaterThan(0);

    const ui = ProviderRegistry.getChatUIConfig(id) as unknown as Record<string, unknown>;
    for (const method of ['getModelOptions', 'getCustomModelIds', 'ownsModel']) {
      expect(typeof ui[method]).toBe('function');
    }

    const reconciler = ProviderRegistry.getSettingsReconciler(id) as unknown as Record<string, unknown>;
    for (const method of ['reconcileModelWithEnvironment', 'normalizeModelVariantSettings']) {
      expect(typeof reconciler[method]).toBe('function');
    }

    const history = ProviderRegistry.getConversationHistoryService(id) as unknown as Record<string, unknown>;
    expect(typeof history.hydrateConversationHistory).toBe('function');

    // taskResultInterpreter is optional on the registration; the registry
    // substitutes a neutral default, so the accessor must always resolve one.
    expect(typeof ProviderRegistry.getTaskResultInterpreter(id).resolveTerminalStatus).toBe('function');

    expect(ProviderRegistry.getDefaultProviderConfigs()[id]).toBeDefined();
  });

  it.each(providerIds)('"%s" createChatRuntime yields a runtime tagged with its own id', (id) => {
    const runtime = ProviderRegistry.createChatRuntime({ providerId: id, plugin: {} as never });
    expect(runtime.providerId).toBe(id);
    expect(typeof runtime.query).toBe('function');
    expect(typeof runtime.getCapabilities).toBe('function');
    expect(typeof runtime.cleanup).toBe('function');
    expect(runtime.getCapabilities().providerId).toBe(id);
  });

  it('routes an unknown provider id to a clear error rather than a silent default', () => {
    expect(() => ProviderRegistry.getCapabilities('ghost' as never)).toThrow(
      'Provider "ghost" is not registered.',
    );
  });
});
