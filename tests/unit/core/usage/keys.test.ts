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

  it('round-trips quick-action names containing underscores', () => {
    // `_` is the quick-action provider-slot sentinel — round-trip must
    // still resolve the right `kind` and treat the name as opaque.
    const key = { kind: 'quickAction', name: 'deep_research_runner' } as const;
    expect(parseKey(serializeKey(key))).toEqual(key);
  });

  it('round-trips skill names containing underscores across providers', () => {
    const claudeKey = { kind: 'skill', providerId: 'claude', name: 'do_thing_v2' } as const;
    const codexKey  = { kind: 'skill', providerId: 'codex',  name: 'do_thing_v2' } as const;
    expect(parseKey(serializeKey(claudeKey))).toEqual(claudeKey);
    expect(parseKey(serializeKey(codexKey))).toEqual(codexKey);
    // Distinct providers must serialize to distinct keys — guards the
    // multi-provider counter contract for shared skill names.
    expect(serializeKey(claudeKey)).not.toEqual(serializeKey(codexKey));
  });
});
