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

  it('masks broadened secret-shaped keys', () => {
    const [out] = redactArgs([
      {
        bearer: 'b',
        passwd: 'p',
        pwd: 'q',
        signature: 'sig',
        privateKey: 'pk',
        'private-key': 'pk2',
        pin: '1234',
        plain: 'ok',
      },
    ]) as [Record<string, unknown>];
    expect(out.bearer).toBe('[redacted]');
    expect(out.passwd).toBe('[redacted]');
    expect(out.pwd).toBe('[redacted]');
    expect(out.signature).toBe('[redacted]');
    expect(out.privateKey).toBe('[redacted]');
    expect(out['private-key']).toBe('[redacted]');
    expect(out.pin).toBe('[redacted]');
    expect(out.plain).toBe('ok');
  });

  it('anchors `pin` so it does not redact innocuous keys containing the substring', () => {
    const [out] = redactArgs([
      { mapping: 'm', shipping: 's', spinner: 'sp', user_pin: '9', 'pin-code': '7' },
    ]) as [Record<string, unknown>];
    expect(out.mapping).toBe('m');
    expect(out.shipping).toBe('s');
    expect(out.spinner).toBe('sp');
    expect(out.user_pin).toBe('[redacted]');
    expect(out['pin-code']).toBe('[redacted]');
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
