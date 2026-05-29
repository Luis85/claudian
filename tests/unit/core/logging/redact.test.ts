import { redactArgs, truncateBody } from '../../../../src/core/logging/redact';

describe('redactArgs', () => {
  it('masks secret-shaped keys', () => {
    const [out] = redactArgs([{ token: 'abc', apiKey: 'x', name: 'ok' }]) as [Record<string, unknown>];
    expect(out.token).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.name).toBe('ok');
  });

  it('masks nested secret keys', () => {
    const [out] = redactArgs([{ auth: { authorization: 'Bearer z', ok: 1 } }]) as [{ auth: Record<string, unknown> }];
    expect(out.auth.authorization).toBe('[redacted]');
    expect(out.auth.ok).toBe(1);
  });

  it('does not mutate the caller object', () => {
    const original = { secret: 's' };
    redactArgs([original]);
    expect(original.secret).toBe('s');
  });

  it('leaves primitives untouched', () => {
    expect(redactArgs(['plain', 42, true])).toEqual(['plain', 42, true]);
  });

  it('handles cycles without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redactArgs([a])).not.toThrow();
  });
});

describe('truncateBody', () => {
  it('returns short strings unchanged', () => {
    expect(truncateBody('short', 100)).toBe('short');
  });

  it('truncates and annotates overflow', () => {
    const out = truncateBody('abcdef', 3);
    expect(out).toBe('abc…[+3]');
  });
});
