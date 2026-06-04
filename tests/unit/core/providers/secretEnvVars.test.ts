import {
  getProviderEnvironmentVariables,
  getSharedEnvironmentVariables,
} from '../../../../src/core/providers/providerEnvironment';
import {
  extractBlobSecretRefs,
  migrateEnvSecrets,
  overlaySecretEnvVars,
  secretEnvVarsForScope,
} from '../../../../src/core/providers/secretEnvVars';
import type { SecretEnvVarRef } from '../../../../src/core/types/settings';

describe('secretEnvVars — scope filtering', () => {
  it('returns only refs for the requested scope', () => {
    const refs: SecretEnvVarRef[] = [
      { scope: 'shared', name: 'A', secretId: 'a' },
      { scope: 'provider:claude', name: 'B', secretId: 'b' },
    ];
    expect(secretEnvVarsForScope(refs, 'shared')).toEqual([refs[0]]);
    expect(secretEnvVarsForScope(refs, 'provider:claude')).toEqual([refs[1]]);
  });
});

describe('secretEnvVars — overlay', () => {
  const refs: SecretEnvVarRef[] = [
    { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'id-1' },
    { scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'id-2' },
  ];

  it('injects resolved values and leaves the rest untouched', () => {
    const env: Record<string, string> = { ANTHROPIC_BASE_URL: 'https://x' };
    const store = new Map([['id-1', 'sk-a'], ['id-2', 'sk-b']]);
    const { missing } = overlaySecretEnvVars(env, refs, (id) => store.get(id) ?? null);
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'https://x',
      ANTHROPIC_API_KEY: 'sk-a',
      OPENAI_API_KEY: 'sk-b',
    });
    expect(missing).toEqual([]);
  });

  it('reports missing/cleared secrets and does not inject them', () => {
    const env: Record<string, string> = {};
    const { missing } = overlaySecretEnvVars(env, refs, (id) => (id === 'id-1' ? '' : null));
    expect(env).toEqual({}); // '' (cleared) and null (absent) both skipped
    expect(missing.map((r) => r.secretId).sort()).toEqual(['id-1', 'id-2']);
  });
});

describe('secretEnvVars — migration extraction', () => {
  function migrate(blob: string, scope: Parameters<typeof extractBlobSecretRefs>[1] = 'shared') {
    const stored = new Map<string, string>();
    const used = new Set<string>();
    const result = extractBlobSecretRefs(blob, scope, (id, v) => stored.set(id, v), used);
    return { ...result, stored };
  }

  it('moves secret lines into the store and drops them, keeping non-secrets inline', () => {
    const blob = [
      'ANTHROPIC_API_KEY=sk-secret-123',
      'ANTHROPIC_BASE_URL=https://api.example.com',
      'ANTHROPIC_MODEL=custom',
    ].join('\n');

    const { blob: out, refs, stored } = migrate(blob);

    expect(out).toBe('ANTHROPIC_BASE_URL=https://api.example.com\nANTHROPIC_MODEL=custom');
    expect(refs).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
    ]);
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('sk-secret-123');
  });

  it('namespaces ids per scope', () => {
    const { refs } = migrate('OPENAI_API_KEY=sk-x', 'provider:codex');
    expect(refs[0].secretId).toBe('claudian-env-provider-codex-openai-api-key');
  });

  it('keeps comments, blanks, opted-out lines, and empty values', () => {
    const blob = [
      '# a comment',
      '',
      'EMPTY_TOKEN=',
      'MY_TOKEN=keep-me # claudian:plaintext',
      'NODE_ENV=production',
    ].join('\n');
    const { blob: out, refs } = migrate(blob);
    expect(out).toBe(blob);
    expect(refs).toEqual([]);
  });

  it('is idempotent — re-running on the sanitized blob extracts nothing', () => {
    const first = migrate('OPENAI_API_KEY=sk-x\nFOO=bar');
    const second = migrate(first.blob);
    expect(second.refs).toEqual([]);
    expect(second.blob).toBe(first.blob);
  });

  it('collision-proofs ids when keys normalize alike', () => {
    const blob = 'FOO_TOKEN=one\nFOO__TOKEN=two';
    const { refs, stored } = migrate(blob);
    const ids = refs.map((r) => r.secretId);
    expect(new Set(ids).size).toBe(2);
    expect([...stored.values()].sort()).toEqual(['one', 'two']);
  });
});

describe('secretEnvVars — migrateEnvSecrets (shared + provider blobs)', () => {
  function run(settings: Record<string, unknown>, seed: Record<string, string> = {}) {
    const stored = new Map<string, string>(Object.entries(seed));
    const store = {
      set: (id: string, v: string) => stored.set(id, v),
      list: () => [...stored.keys()],
    };
    const changed = migrateEnvSecrets(settings, ['claude', 'codex'], store);
    return { changed, stored };
  }

  it('migrates shared and provider blobs, leaving non-secrets and not touching snippets', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=sk-a\nHTTP_PROXY=http://p',
      providerConfigs: {
        codex: { environmentVariables: 'OPENAI_API_KEY=sk-o\nOPENAI_MODEL=gpt' },
      },
      envSnippets: [{ id: 's1', name: 'n', description: '', envVars: 'GEMINI_API_KEY=sk-g' }],
      secretEnvVars: [],
    };

    const { changed, stored } = run(settings);

    expect(changed).toBe(true);
    expect(getSharedEnvironmentVariables(settings)).toBe('HTTP_PROXY=http://p');
    expect(getProviderEnvironmentVariables(settings, 'codex')).toBe('OPENAI_MODEL=gpt');
    // Snippet plaintext is intentionally left as-is.
    expect((settings.envSnippets as Array<{ envVars: string }>)[0].envVars).toBe('GEMINI_API_KEY=sk-g');

    const refs = settings.secretEnvVars as SecretEnvVarRef[];
    expect(refs).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
      { scope: 'provider:codex', name: 'OPENAI_API_KEY', secretId: 'claudian-env-provider-codex-openai-api-key' },
    ]);
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('sk-a');
    expect(stored.get('claudian-env-provider-codex-openai-api-key')).toBe('sk-o');
  });

  it('is a no-op (returns false) when there are no plaintext secrets', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'HTTP_PROXY=http://p',
      providerConfigs: {},
      secretEnvVars: [],
    };
    expect(run(settings).changed).toBe(false);
    expect(settings.secretEnvVars).toEqual([]);
  });

  it('does not overwrite an id already present in SecretStorage (seeds usedIds from store.list)', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=sk-new',
      providerConfigs: {},
      secretEnvVars: [],
    };
    // The derived id already holds a foreign/stale value in the keychain.
    const { stored } = run(settings, { 'claudian-env-shared-anthropic-api-key': 'pre-existing' });

    const refs = settings.secretEnvVars as SecretEnvVarRef[];
    expect(refs[0].secretId).toBe('claudian-env-shared-anthropic-api-key-2'); // uniquified
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('pre-existing'); // untouched
    expect(stored.get('claudian-env-shared-anthropic-api-key-2')).toBe('sk-new');
  });
});
