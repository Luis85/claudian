import {
  isSecretEnvKey,
  isSecretHeaderName,
  migratedEnvSecretId,
  migratedMcpHeaderSecretId,
  normalizeSecretId,
  uniquifySecretId,
} from '../../../../src/core/security/secretIds';

describe('secretIds — normalization', () => {
  it('normalizes ids to lowercase-alphanumeric-dashes', () => {
    expect(normalizeSecretId('specorator-env-ANTHROPIC_API_KEY')).toBe('specorator-env-anthropic-api-key');
    expect(normalizeSecretId('  weird//name__here  ')).toBe('weird-name-here');
    expect(normalizeSecretId('!!!')).toBe('secret');
  });
});

describe('secretIds — namespaced derivation', () => {
  it('derives namespaced, valid env ids', () => {
    expect(migratedEnvSecretId('shared', 'ANTHROPIC_API_KEY')).toBe('specorator-env-shared-anthropic-api-key');
    expect(migratedEnvSecretId('snippet-1', 'OPENAI_API_KEY')).toBe('specorator-env-snippet-1-openai-api-key');
  });

  it('derives namespaced, valid MCP header ids', () => {
    expect(migratedMcpHeaderSecretId('my-server', 'Authorization')).toBe('specorator-mcp-my-server-header-authorization');
  });

  it('every derived id satisfies the SecretStorage id rule (lowercase alnum + dashes)', () => {
    for (const id of [
      migratedEnvSecretId('shared', 'FOO__BAR_TOKEN'),
      migratedMcpHeaderSecretId('Weird Server!', 'X-Api-Key'),
    ]) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('secretIds — collision-proofing', () => {
  it('suffixes colliding ids', () => {
    const used = new Set<string>();
    const a = uniquifySecretId('specorator-env-shared-foo-token', used);
    used.add(a);
    const b = uniquifySecretId('specorator-env-shared-foo-token', used);
    expect(a).toBe('specorator-env-shared-foo-token');
    expect(b).toBe('specorator-env-shared-foo-token-2');
  });
});

describe('secretIds — migration detection (advisory)', () => {
  it('flags known + suffix-matched secret env keys (incl. AUTH)', () => {
    for (const k of [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FOO_TOKEN', 'MY_SECRET',
      'X_PASSWORD', 'AWS_SECRET_ACCESS_KEY', 'BASIC_AUTH', 'NPM_CONFIG__AUTH',
      'GOOGLE_PRIVATE_KEY', 'JWT_PRIVATE_KEY', 'SSH_PRIVATE_KEY', 'MY_PRIVATE-KEY',
    ]) {
      expect(isSecretEnvKey(k)).toBe(true);
    }
  });

  it('does not flag non-secret env keys (incl. generic *_KEY that is not private)', () => {
    for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'PATH', 'NODE_ENV', 'CACHE_KEY', 'PARTITION_KEY']) {
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
