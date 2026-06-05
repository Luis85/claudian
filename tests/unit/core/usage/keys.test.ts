import { parseKey, serializeKey } from '@/core/usage/keys';

describe('usage keys', () => {
  it('serializes a quick-action key with placeholder providerId slot', () => {
    expect(serializeKey({ kind: 'quickAction', name: 'summarize' })).toBe(
      'quickAction:_:summarize',
    );
  });

  it('serializes a skill key with provider', () => {
    expect(
      serializeKey({ kind: 'skill', providerId: 'claude', name: 'deep-research' }),
    ).toBe('skill:claude:deep-research');
  });

  it('round-trips quick-action keys', () => {
    const key = { kind: 'quickAction', name: 'a:weird:name' } as const;
    expect(parseKey(serializeKey(key))).toEqual(key);
  });

  it('round-trips skill keys', () => {
    const key = { kind: 'skill', providerId: 'codex', name: 'do:stuff' } as const;
    expect(parseKey(serializeKey(key))).toEqual(key);
  });

  it('returns null for malformed serialized keys', () => {
    expect(parseKey('garbage')).toBeNull();
    expect(parseKey('quickAction:only')).toBeNull();
    expect(parseKey('badKind:_:x')).toBeNull();
  });
});
