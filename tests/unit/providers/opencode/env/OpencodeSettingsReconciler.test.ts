import { opencodeSettingsReconciler } from '@/providers/opencode/env/OpencodeSettingsReconciler';
import {
  OPENCODE_PLAN_MODE_ID,
  OPENCODE_SAFE_MODE_ID,
} from '@/providers/opencode/modes';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

describe('opencodeSettingsReconciler.normalizeOnLoad', () => {
  it('rewrites plan-mode selection to safe on load', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { opencode: { selectedMode: OPENCODE_PLAN_MODE_ID } },
    };
    const changed = opencodeSettingsReconciler.normalizeOnLoad?.(settings);
    expect(changed).toBe(true);
    expect((settings.providerConfigs as { opencode: { selectedMode: string } }).opencode.selectedMode)
      .toBe(OPENCODE_SAFE_MODE_ID);
  });

  it('returns false when selectedMode is not plan', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { opencode: { selectedMode: OPENCODE_SAFE_MODE_ID } },
    };
    expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
  });

  it('returns false when providerConfigs.opencode is missing', () => {
    expect(opencodeSettingsReconciler.normalizeOnLoad?.({})).toBe(false);
  });

  it('returns false when providerConfigs is an array (malformed)', () => {
    const settings: Record<string, unknown> = { providerConfigs: [] };
    expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
  });

  it('returns false when providerConfigs is null', () => {
    const settings: Record<string, unknown> = { providerConfigs: null };
    expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
  });

  it('returns false when providerConfigs.opencode is an array (malformed)', () => {
    const settings: Record<string, unknown> = { providerConfigs: { opencode: [] } };
    expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
  });

  it('returns false when providerConfigs.opencode is null', () => {
    const settings: Record<string, unknown> = { providerConfigs: { opencode: null } };
    expect(opencodeSettingsReconciler.normalizeOnLoad?.(settings)).toBe(false);
  });
});

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
