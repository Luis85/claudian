import type { ProviderId } from '@/core/providers/types';
import { resolveAgentBoardProvider } from '@/features/settings/ui/AgentBoardSettingsSection';

describe('resolveAgentBoardProvider', () => {
  it('keeps the stored provider when it is still enabled', () => {
    const enabled: ProviderId[] = ['cursor', 'codex'];
    expect(resolveAgentBoardProvider(enabled, 'codex')).toBe('codex');
  });

  it('falls back to the first enabled provider when the stored one is disabled', () => {
    // Repro: only cursor enabled, but the default stored provider is the now-disabled codex.
    // The displayed provider and the model-populate source must agree on cursor.
    const enabled: ProviderId[] = ['cursor'];
    expect(resolveAgentBoardProvider(enabled, 'codex')).toBe('cursor');
  });

  it('returns empty when no providers are enabled', () => {
    expect(resolveAgentBoardProvider([], 'codex')).toBe('');
  });
});
