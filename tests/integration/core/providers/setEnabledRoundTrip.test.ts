// Force all four provider registrations to load before the suite runs.
import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';

describe('ProviderSettingsReconciler.setEnabled — round trip', () => {
  const providers: ProviderId[] = ['claude', 'codex', 'cursor', 'opencode'];

  it.each(providers)('%s: setEnabled(true) then isEnabled returns true', (id) => {
    const settings: Record<string, unknown> = { providerConfigs: { [id]: { enabled: false } } };
    const reconciler = ProviderRegistry.getSettingsReconciler(id);
    reconciler.setEnabled?.(settings, true);
    expect(ProviderRegistry.isEnabled(id, settings)).toBe(true);
  });

  it.each(providers)('%s: setEnabled(false) then isEnabled returns false', (id) => {
    const settings: Record<string, unknown> = { providerConfigs: { [id]: { enabled: true } } };
    const reconciler = ProviderRegistry.getSettingsReconciler(id);
    reconciler.setEnabled?.(settings, false);
    expect(ProviderRegistry.isEnabled(id, settings)).toBe(false);
  });

  it.each(providers)('%s: setEnabled is defined (Phase 0 contract)', (id) => {
    expect(ProviderRegistry.getSettingsReconciler(id).setEnabled).toBeDefined();
  });
});
