import type { ProviderId } from '../../../../src/core/providers/types';
import type { ClaudianSettings } from '../../../../src/core/types/settings';
import { resolveAgentBoardDefaultProvider } from '../../../../src/features/tasks/defaultProviderResolver';

function settings(enabled: ProviderId[], stored: ProviderId | null = null): ClaudianSettings {
  const provs = ['claude', 'codex', 'opencode', 'cursor'] as ProviderId[];
  return {
    agentBoardDefaultProvider: stored,
    providerConfigs: Object.fromEntries(
      provs.map((id) => [id, { enabled: enabled.includes(id) }]),
    ),
  } as unknown as ClaudianSettings;
}

describe('resolveAgentBoardDefaultProvider', () => {
  it('returns null when nothing is enabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings([]))).toBeNull();
  });
  it('returns the only enabled provider', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude']))).toBe('claude');
  });
  it('returns tab-strip-first when stored is null', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['codex', 'opencode']))).toBe('codex');
  });
  it('returns stored when stored is enabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude', 'codex'], 'codex'))).toBe('codex');
  });
  it('falls through to tab-strip-first when stored is disabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude'], 'codex'))).toBe('claude');
  });
});
