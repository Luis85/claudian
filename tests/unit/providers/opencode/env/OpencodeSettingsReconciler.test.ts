import { opencodeSettingsReconciler } from '@/providers/opencode/env/OpencodeSettingsReconciler';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

describe('opencodeSettingsReconciler.setEnabled', () => {
  it('writes enabled=true into providerConfigs.opencode', () => {
    const settings: Record<string, unknown> = { providerConfigs: { opencode: { enabled: false } } };
    opencodeSettingsReconciler.setEnabled?.(settings, true);
    expect(getOpencodeProviderSettings(settings).enabled).toBe(true);
  });

  it('writes enabled=false into providerConfigs.opencode', () => {
    const settings: Record<string, unknown> = { providerConfigs: { opencode: { enabled: true } } };
    opencodeSettingsReconciler.setEnabled?.(settings, false);
    expect(getOpencodeProviderSettings(settings).enabled).toBe(false);
  });
});
