import os from 'os';

import { redactArgs, scrubString, truncateBody } from '../../../../src/core/logging/redact';

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

describe('redactArgs value-level scrubbing', () => {
  it('scrubs a bearer token embedded in a non-secret key value', () => {
    const [out] = redactArgs([
      { message: 'Authorization: Bearer abc123def456ghi789jkl' },
    ]) as [Record<string, unknown>];
    expect(out.message).not.toContain('abc123def456ghi789jkl');
    expect(out.message).toBe('Authorization: Bearer [redacted]');
  });

  it('redacts an entire long bearer token (>512 chars) with no tail leak', () => {
    const longToken = `eyJ${'a1B2c3D4'.repeat(80)}`; // ~640 chars, JWT-shaped
    const [out] = redactArgs([
      { message: `Authorization: Bearer ${longToken}` },
    ]) as [Record<string, unknown>];
    expect(out.message).toBe('Authorization: Bearer [redacted]');
    // No suffix of the token may survive past the cap.
    expect(out.message).not.toContain('a1B2c3D4');
  });

  it('scrubs token=/api_key=/api-key= kv patterns inside values', () => {
    const [out] = redactArgs([
      {
        url: 'https://host/cb?token=abc123def456ghi&x=1',
        a: 'api_key=secretValue1234567',
        b: 'api-key=anotherSecret987654',
      },
    ]) as [Record<string, unknown>];
    expect(out.url).not.toContain('abc123def456ghi');
    expect(out.url).toContain('token=[redacted]');
    expect(out.url).toContain('x=1');
    expect(out.a).not.toContain('secretValue1234567');
    expect(out.b).not.toContain('anotherSecret987654');
  });

  it('scrubs sk-/provider-prefixed key shapes inside values', () => {
    const [out] = redactArgs([
      {
        endpoint: 'configured key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        err: new Error('failed with sk-proj-ZZZ1234567890abcdefghij').message,
      },
    ]) as [Record<string, unknown>];
    expect(out.endpoint).not.toContain('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(out.endpoint).toContain('[redacted]');
    expect(out.err).not.toContain('sk-proj-ZZZ1234567890abcdefghij');
  });

  it('scrubs user:pass@host credentials in URL/command strings', () => {
    const [out] = redactArgs([
      { cmd: 'git clone https://user:secrettoken123@host.example/repo.git' },
    ]) as [Record<string, unknown>];
    expect(out.cmd).not.toContain('secrettoken123');
    expect(out.cmd).toContain('host.example/repo.git');
  });

  it('normalizes the home directory to ~ in values', () => {
    const home = os.homedir();
    const [out] = redactArgs([
      { path: `${home}/Documents/vault/note.md` },
    ]) as [Record<string, unknown>];
    expect(out.path).toBe('~/Documents/vault/note.md');
    expect(out.path).not.toContain(home);
  });

  it('leaves ordinary prose untouched', () => {
    const [out] = redactArgs([
      { message: 'Saved 3 files to the vault and resolved 2 conflicts.' },
    ]) as [Record<string, unknown>];
    expect(out.message).toBe('Saved 3 files to the vault and resolved 2 conflicts.');
  });
});

describe('scrubString', () => {
  it('is a no-op for plain text', () => {
    expect(scrubString('hello world')).toBe('hello world');
  });

  it('scrubs a bearer token in a free-form message', () => {
    expect(scrubString('got Bearer abc123def456ghi789')).toBe('got Bearer [redacted]');
  });

  it('normalizes the home directory', () => {
    const home = os.homedir();
    expect(scrubString(`reading ${home}/x`)).toBe('reading ~/x');
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
