import {
  extractEnvBlobSecrets,
  findSecretRefs,
  hasSecretRef,
  isSecretEnvKey,
  isSecretHeaderName,
  normalizeSecretId,
  resolveEnvBlob,
  secretRef,
} from '../../../../src/core/security/secretRefs';

describe('secretRefs — detection', () => {
  it('flags known + suffix-matched secret env keys', () => {
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FOO_TOKEN', 'MY_SECRET', 'X_PASSWORD', 'AWS_SECRET_ACCESS_KEY']) {
      expect(isSecretEnvKey(k)).toBe(true);
    }
  });

  it('does not flag non-secret env keys', () => {
    for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'PATH', 'NODE_ENV']) {
      expect(isSecretEnvKey(k)).toBe(false);
    }
  });

  it('flags credential-bearing MCP header names', () => {
    for (const h of ['Authorization', 'authorization', 'X-Api-Key', 'Proxy-Authorization', 'Cookie']) {
      expect(isSecretHeaderName(h)).toBe(true);
    }
    expect(isSecretHeaderName('Content-Type')).toBe(false);
    expect(isSecretHeaderName('Accept')).toBe(false);
  });
});

describe('secretRefs — ids and tokens', () => {
  it('normalizes ids to lowercase-alphanumeric-dashes', () => {
    expect(normalizeSecretId('env-shared-ANTHROPIC_API_KEY')).toBe('env-shared-anthropic-api-key');
    expect(normalizeSecretId('  weird//name__here  ')).toBe('weird-name-here');
    expect(normalizeSecretId('!!!')).toBe('secret');
  });

  it('builds and detects reference tokens', () => {
    expect(secretRef('abc-1')).toBe('${secret:abc-1}');
    expect(hasSecretRef('KEY=${secret:abc-1}')).toBe(true);
    expect(hasSecretRef('KEY=plain')).toBe(false);
    expect(findSecretRefs('a=${secret:one} b=${secret:two}')).toEqual(['one', 'two']);
  });
});

describe('secretRefs — env blob extract/resolve', () => {
  const makeId = (key: string) => `env-shared-${key}`;

  it('extracts secret values and leaves non-secrets inline', () => {
    const blob = [
      'ANTHROPIC_API_KEY=sk-secret-123',
      'ANTHROPIC_BASE_URL=https://api.example.com',
      'ANTHROPIC_MODEL=custom',
    ].join('\n');

    const { blob: out, secrets } = extractEnvBlobSecrets(blob, makeId);

    expect(out).toContain('ANTHROPIC_API_KEY=${secret:env-shared-anthropic-api-key}');
    expect(out).toContain('ANTHROPIC_BASE_URL=https://api.example.com');
    expect(out).toContain('ANTHROPIC_MODEL=custom');
    expect(secrets).toEqual([{ id: 'env-shared-anthropic-api-key', value: 'sk-secret-123' }]);
  });

  it('is idempotent (already-referenced values are not re-extracted)', () => {
    const once = extractEnvBlobSecrets('OPENAI_API_KEY=sk-abc', makeId);
    const twice = extractEnvBlobSecrets(once.blob, makeId);
    expect(twice.blob).toBe(once.blob);
    expect(twice.secrets).toEqual([]);
  });

  it('skips empty values, comments, and opted-out lines', () => {
    const blob = [
      '# a comment',
      'EMPTY_TOKEN=',
      'MY_TOKEN=keep-me # claudian:plaintext',
    ].join('\n');
    const { blob: out, secrets } = extractEnvBlobSecrets(blob, makeId);
    expect(out).toBe(blob);
    expect(secrets).toEqual([]);
  });

  it('strips surrounding quotes from the stored value', () => {
    const { secrets } = extractEnvBlobSecrets('FOO_TOKEN="quoted-secret"', makeId);
    expect(secrets[0].value).toBe('quoted-secret');
  });

  it('round-trips: resolve(extract(blob)) restores original values into the child env', () => {
    const blob = 'ANTHROPIC_API_KEY=sk-secret-123\nANTHROPIC_MODEL=custom';
    const { blob: refBlob, secrets } = extractEnvBlobSecrets(blob, makeId);
    const map = new Map(secrets.map((s) => [s.id, s.value]));
    const resolved = resolveEnvBlob(refBlob, (id) => map.get(id) ?? null);
    expect(resolved).toBe(blob);
  });

  it('resolves missing references to empty string', () => {
    const resolved = resolveEnvBlob('K=${secret:gone}', () => null);
    expect(resolved).toBe('K=');
  });
});
