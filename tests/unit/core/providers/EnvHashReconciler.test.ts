import {
  computeEnvHash,
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '@/core/providers/EnvHashReconciler';
import type { Conversation } from '@/core/types';

jest.mock('@/core/providers/providerEnvironment', () => {
  const actual = jest.requireActual('@/core/providers/providerEnvironment');
  return {
    ...actual,
    getRuntimeEnvironmentText: jest.fn(
      (settings: Record<string, unknown>) => (settings.__envText as string | undefined) ?? '',
    ),
  };
});

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return { id: 'c', providerId: 'claude', sessionId: null, ...overrides } as Conversation;
}

describe('computeEnvHash', () => {
  it('keeps only watched keys, sorts, and joins with a pipe', () => {
    const hash = computeEnvHash('B=2\nA=1\nUNWATCHED=9', ['A', 'B']);
    expect(hash).toBe('A=1|B=2');
  });

  it('ignores watched keys that are unset', () => {
    expect(computeEnvHash('A=1', ['A', 'B'])).toBe('A=1');
  });

  it('returns an empty string when no watched keys are present', () => {
    expect(computeEnvHash('OTHER=1', ['A', 'B'])).toBe('');
  });
});

describe('reconcileEnvironmentHash', () => {
  function makeSpec(overrides: Partial<EnvHashReconcilerSpec> = {}): EnvHashReconcilerSpec {
    return {
      providerId: 'claude',
      watchedKeys: ['A'],
      getSavedHash: jest.fn(() => ''),
      saveHash: jest.fn(),
      invalidateConversation: jest.fn(() => false),
      ...overrides,
    };
  }

  it('reports no change when the hash matches the saved hash', () => {
    const spec = makeSpec({ getSavedHash: () => 'A=1' });
    const result = reconcileEnvironmentHash(spec, { __envText: 'A=1' }, []);

    expect(result).toEqual({ changed: false, invalidatedConversations: [] });
    expect(spec.saveHash).not.toHaveBeenCalled();
  });

  // SEC-A: when a watched key is migrated out of the plaintext blob into
  // SecretStorage, resolveEnvText re-injects its value so the hash is unchanged
  // and sessions are NOT invalidated.
  it('uses resolveEnvText so a migrated watched secret keeps the hash stable', () => {
    const spec = makeSpec({ watchedKeys: ['API_KEY'], getSavedHash: () => 'API_KEY=sk-1' });
    const result = reconcileEnvironmentHash(
      spec,
      { __envText: '' }, // plaintext blob no longer has the key (migrated)
      [makeConversation({ sessionId: 's1' })],
      () => ({ text: 'API_KEY=sk-1', hasMissingSecrets: false }), // re-injected from SecretStorage
    );

    expect(result.changed).toBe(false);
    expect(spec.invalidateConversation).not.toHaveBeenCalled();
    expect(spec.saveHash).not.toHaveBeenCalled();
  });

  it('defers invalidation when a referenced secret is missing on this device', () => {
    const spec = makeSpec({ watchedKeys: ['API_KEY'], getSavedHash: () => 'API_KEY=sk-1' });
    // Resolved env is incomplete (secret absent locally): even though the hash
    // would differ, sessions must NOT be invalidated until re-entry.
    const result = reconcileEnvironmentHash(
      spec,
      { __envText: '' },
      [makeConversation({ sessionId: 's1' })],
      () => ({ text: '', hasMissingSecrets: true }),
    );

    expect(result).toEqual({ changed: false, invalidatedConversations: [] });
    expect(spec.invalidateConversation).not.toHaveBeenCalled();
    expect(spec.saveHash).not.toHaveBeenCalled();
  });

  it('without a resolver, a stripped watched key changes the hash (the regression this guards)', () => {
    const spec = makeSpec({ watchedKeys: ['API_KEY'], getSavedHash: () => 'API_KEY=sk-1' });
    const result = reconcileEnvironmentHash(spec, { __envText: '' }, []);
    expect(result.changed).toBe(true);
  });

  it('persists the new hash and returns the invalidated conversations on change', () => {
    const stale = makeConversation({ id: 'stale', sessionId: 's1' });
    const live = makeConversation({ id: 'live', sessionId: null });
    const invalidate = jest.fn((conv: Conversation) => {
      if (conv.sessionId) {
        conv.sessionId = null;
        return true;
      }
      return false;
    });
    const saveHash = jest.fn();
    const spec = makeSpec({ getSavedHash: () => 'old', saveHash, invalidateConversation: invalidate });

    const result = reconcileEnvironmentHash(spec, { __envText: 'A=1' }, [stale, live]);

    expect(result.changed).toBe(true);
    expect(result.invalidatedConversations).toEqual([stale]);
    expect(stale.sessionId).toBeNull();
    expect(saveHash).toHaveBeenCalledWith({ __envText: 'A=1' }, 'A=1');
  });

  it('runs the optional model reconciliation with the freshly read env text', () => {
    const reconcileModel = jest.fn();
    const spec = makeSpec({ getSavedHash: () => 'old', reconcileModel });

    reconcileEnvironmentHash(spec, { __envText: 'A=1' }, []);

    expect(reconcileModel).toHaveBeenCalledWith({ __envText: 'A=1' }, 'A=1');
  });

  it('does not require a model reconciliation hook', () => {
    const spec = makeSpec({ getSavedHash: () => 'old' });
    expect(() => reconcileEnvironmentHash(spec, { __envText: 'A=1' }, [])).not.toThrow();
  });
});
