import {
  getProviderEnvironmentVariables,
  getSharedEnvironmentVariables,
} from '../../../../src/core/providers/providerEnvironment';
import { ProviderRegistry } from '../../../../src/core/providers/ProviderRegistry';
import {
  extractBlobSecretRefs,
  migrateEnvSecrets,
  overlaySecretEnvVars,
  pruneScopeSecretRefs,
  resolveProviderEnvVars,
  resolveSnippetEnvText,
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

describe('secretEnvVars — no secret value leaks into persisted settings', () => {
  it('migrated settings JSON contains the ids but never the secret values', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=sk-super-secret\nANTHROPIC_MODEL=custom',
      providerConfigs: { codex: { environmentVariables: 'OPENAI_API_KEY=op-secret' } },
      secretEnvVars: [],
    };
    const stored = new Map<string, string>();
    migrateEnvSecrets(settings, ['claude', 'codex'], {
      set: (id, v) => stored.set(id, v),
      list: () => [...stored.keys()],
    });

    // What persists to .claudian/claudian-settings.json:
    const json = JSON.stringify(settings);
    expect(json).not.toContain('sk-super-secret');
    expect(json).not.toContain('op-secret');
    expect(json).toContain('claudian-env-shared-anthropic-api-key'); // only the id reference

    // Values live ONLY in the out-of-vault keychain store.
    expect([...stored.values()].sort()).toEqual(['op-secret', 'sk-super-secret']);
  });
});

describe('secretEnvVars — resolveProviderEnvVars precedence', () => {
  it('lets a provider plaintext override win over a same-named shared secret', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_BASE_URL=https://shared',
      providerConfigs: {
        claude: { environmentVariables: 'ANTHROPIC_API_KEY=provider-key' },
      },
      secretEnvVars: [
        { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'shared-sid' },
        { scope: 'provider:claude', name: 'ANTHROPIC_AUTH_TOKEN', secretId: 'prov-sid' },
      ],
    };
    const stored: Record<string, string> = { 'shared-sid': 'shared-secret', 'prov-sid': 'prov-secret' };

    const { env } = resolveProviderEnvVars(settings, 'claude', (id) => stored[id] ?? null);

    // Provider plaintext beats the shared secret of the same name.
    expect(env.ANTHROPIC_API_KEY).toBe('provider-key');
    // Provider-scope secret applies; shared non-secret applies.
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('prov-secret');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://shared');
  });

  it('reports refs whose secret value is absent on this device', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: '',
      providerConfigs: {},
      secretEnvVars: [{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'gone' }],
    };
    const { missing } = resolveProviderEnvVars(settings, 'codex', () => null);
    expect(missing.map((r) => r.name)).toEqual(['OPENAI_API_KEY']);
  });

  it('does not report a missing shared secret when a later source supplies the same name', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: '',
      // Provider plaintext supplies OPENAI_API_KEY, overriding the missing shared secret.
      providerConfigs: { codex: { environmentVariables: 'OPENAI_API_KEY=provider-key' } },
      secretEnvVars: [{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'gone' }],
    };
    const { env, missing } = resolveProviderEnvVars(settings, 'codex', () => null);
    expect(env.OPENAI_API_KEY).toBe('provider-key');
    expect(missing).toEqual([]); // env is complete → not deferred
  });

  it('masks a lower-precedence shared value when the provider secret is missing', () => {
    const settings: Record<string, unknown> = {
      // Shared plaintext supplies OPENAI_API_KEY, but the provider secret (most
      // specific) is the intended value and is missing on this device.
      sharedEnvironmentVariables: 'OPENAI_API_KEY=shared-fallback',
      providerConfigs: {},
      secretEnvVars: [{ scope: 'provider:codex', name: 'OPENAI_API_KEY', secretId: 'gone' }],
    };
    const { env, missing } = resolveProviderEnvVars(settings, 'codex', () => null);
    // The shared value is masked (not silently used) and the provider secret is
    // reported missing so the user re-enters it.
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(missing.map((r) => r.scope)).toEqual(['provider:codex']);
  });

  it('masks a shared plaintext value when its own shared secret is missing', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'OPENAI_API_KEY=stale-plain',
      providerConfigs: {},
      secretEnvVars: [{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'gone' }],
    };
    const { env, missing } = resolveProviderEnvVars(settings, 'codex', () => null);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(missing.map((r) => r.name)).toEqual(['OPENAI_API_KEY']);
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

  it('reuses one ref for a repeated secret key (no duplicate; last value wins)', () => {
    const { refs, stored } = migrate('OPENAI_API_KEY=one\nOPENAI_API_KEY=two');
    expect(refs).toHaveLength(1);
    expect(stored.get(refs[0].secretId)).toBe('two');
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

  it('migrates shared, provider, and snippet blobs, leaving non-secrets', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=sk-a\nHTTP_PROXY=http://p',
      providerConfigs: {
        codex: { environmentVariables: 'OPENAI_API_KEY=sk-o\nOPENAI_MODEL=gpt' },
      },
      envSnippets: [{ id: 's1', name: 'n', description: '', envVars: 'GEMINI_API_KEY=sk-g\nFOO=bar' }],
      secretEnvVars: [],
    };

    const { changed, stored } = run(settings);

    expect(changed).toBe(true);
    expect(getSharedEnvironmentVariables(settings)).toBe('HTTP_PROXY=http://p');
    expect(getProviderEnvironmentVariables(settings, 'codex')).toBe('OPENAI_MODEL=gpt');
    // Snippet secret is moved out; its non-secret line is preserved.
    expect((settings.envSnippets as Array<{ envVars: string }>)[0].envVars).toBe('FOO=bar');

    const refs = settings.secretEnvVars as SecretEnvVarRef[];
    expect(refs).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
      { scope: 'provider:codex', name: 'OPENAI_API_KEY', secretId: 'claudian-env-provider-codex-openai-api-key' },
      { scope: 'snippet:s1', name: 'GEMINI_API_KEY', secretId: 'claudian-env-snippet-s1-gemini-api-key' },
    ]);
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('sk-a');
    expect(stored.get('claudian-env-provider-codex-openai-api-key')).toBe('sk-o');
    expect(stored.get('claudian-env-snippet-s1-gemini-api-key')).toBe('sk-g');
  });

  it('is idempotent for snippet secrets (re-running migrates nothing new)', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: '',
      providerConfigs: {},
      envSnippets: [{ id: 's1', name: 'n', description: '', envVars: 'GEMINI_API_KEY=sk-g' }],
      secretEnvVars: [],
    };
    run(settings);
    expect((settings.envSnippets as Array<{ envVars: string }>)[0].envVars).toBe('');

    // Second pass: nothing to migrate.
    const { changed } = run(settings, {
      'claudian-env-snippet-s1-gemini-api-key': 'sk-g',
    });
    expect(changed).toBe(false);
    expect((settings.secretEnvVars as SecretEnvVarRef[]).length).toBe(1);
  });

  it('preserves provider-owned legacy env lines while migrating a shared secret', () => {
    // Register codex so the legacy blob classifies OPENAI_* as codex-owned.
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['codex']);
    jest.spyOn(ProviderRegistry, 'getEnvironmentKeyPatterns')
      .mockImplementation((id) => (id === 'codex' ? [/^OPENAI_/] : []));

    // Legacy single-blob env: a shared secret + a provider-owned model line.
    const settings: Record<string, unknown> = {
      environmentVariables: 'ANTHROPIC_API_KEY=sk-a\nOPENAI_MODEL=gpt-custom',
      secretEnvVars: [],
    };
    const stored = new Map<string, string>();
    const changed = migrateEnvSecrets(settings, ['codex'], {
      set: (id, v) => stored.set(id, v),
      list: () => [...stored.keys()],
    });

    expect(changed).toBe(true);
    expect(settings.environmentVariables).toBeUndefined(); // legacy field removed
    // The codex-owned line survives (snapshotted before the legacy field was deleted).
    expect(getProviderEnvironmentVariables(settings, 'codex')).toBe('OPENAI_MODEL=gpt-custom');
    // The shared secret migrated out of plaintext.
    expect((settings.secretEnvVars as SecretEnvVarRef[]).map((r) => r.name)).toEqual(['ANTHROPIC_API_KEY']);
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('sk-a');

    jest.restoreAllMocks();
  });

  it('clearing one ref does not remove or clear another that shares the secret id', () => {
    const sharedId = 'claudian-env-shared-openai-api-key';
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'OPENAI_API_KEY=', // cleared in shared scope
      providerConfigs: { claude: { environmentVariables: '' } },
      // Two refs reuse the SAME secret id (the UI allows selecting one entry twice).
      secretEnvVars: [
        { scope: 'shared', name: 'OPENAI_API_KEY', secretId: sharedId },
        { scope: 'provider:claude', name: 'OPENAI_API_KEY', secretId: sharedId },
      ],
    };
    const { changed, stored } = run(settings, { [sharedId]: 'sk-shared' });

    expect(changed).toBe(true);
    // Only the shared ref pruned; the provider ref (still referencing the id) remains.
    expect(settings.secretEnvVars).toEqual([
      { scope: 'provider:claude', name: 'OPENAI_API_KEY', secretId: sharedId },
    ]);
    // Value NOT cleared — still referenced by the provider ref.
    expect(stored.get(sharedId)).toBe('sk-shared');
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

  it('updates an existing ref in place when a migrated key is re-entered (no duplicate, no plaintext)', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=sk-new\nHTTP_PROXY=http://p',
      providerConfigs: {},
      secretEnvVars: [
        { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
      ],
    };
    const { changed, stored } = run(settings, {
      'claudian-env-shared-anthropic-api-key': 'sk-old',
    });

    expect(changed).toBe(true);
    expect(getSharedEnvironmentVariables(settings)).toBe('HTTP_PROXY=http://p'); // re-entered line stripped
    // Same id reused, value updated — no duplicate ref.
    expect(settings.secretEnvVars).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
    ]);
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe('sk-new');
  });

  it('prunes the ref and clears the stored value when a migrated key is cleared (KEY=)', () => {
    const settings: Record<string, unknown> = {
      sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=\nHTTP_PROXY=http://p',
      providerConfigs: {},
      secretEnvVars: [
        { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'claudian-env-shared-anthropic-api-key' },
      ],
    };
    const { changed, stored } = run(settings, { 'claudian-env-shared-anthropic-api-key': 'sk-old' });

    expect(changed).toBe(true);
    expect(settings.secretEnvVars).toEqual([]); // ref pruned so overlay won't re-inject
    expect(stored.get('claudian-env-shared-anthropic-api-key')).toBe(''); // stored value cleared
    expect(getSharedEnvironmentVariables(settings)).toBe('ANTHROPIC_API_KEY=\nHTTP_PROXY=http://p'); // empty line kept
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

describe('secretEnvVars — resolveSnippetEnvText (insertion)', () => {
  const refs: SecretEnvVarRef[] = [
    { scope: 'snippet:s1', name: 'GEMINI_API_KEY', secretId: 'id-g' },
  ];

  it('appends resolved secret lines to the sanitized snippet text', () => {
    const { envText, missing } = resolveSnippetEnvText(
      'FOO=bar',
      refs,
      (id) => (id === 'id-g' ? 'sk-g' : null),
    );
    expect(envText).toBe('FOO=bar\nGEMINI_API_KEY=sk-g');
    expect(missing).toEqual([]);
  });

  it('omits a secret missing on this device and reports it', () => {
    const { envText, missing } = resolveSnippetEnvText('FOO=bar', refs, () => null);
    expect(envText).toBe('FOO=bar'); // never an empty value injected
    expect(missing).toEqual(refs);
  });

  it('produces only the secret lines when the snippet has no plaintext', () => {
    const { envText } = resolveSnippetEnvText('', refs, () => 'sk-g');
    expect(envText).toBe('GEMINI_API_KEY=sk-g');
  });
});

describe('secretEnvVars — pruneScopeSecretRefs', () => {
  it('removes a scope\'s refs and clears values no other ref uses', () => {
    const cleared: string[] = [];
    const settings: Record<string, unknown> = {
      secretEnvVars: [
        { scope: 'snippet:s1', name: 'GEMINI_API_KEY', secretId: 'id-g' },
        { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'id-a' },
      ] satisfies SecretEnvVarRef[],
    };

    const changed = pruneScopeSecretRefs(settings, 'snippet:s1', (id) => cleared.push(id));

    expect(changed).toBe(true);
    expect(settings.secretEnvVars).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'id-a' },
    ]);
    expect(cleared).toEqual(['id-g']);
  });

  it('keeps a stored value still referenced by another scope', () => {
    const cleared: string[] = [];
    const settings: Record<string, unknown> = {
      secretEnvVars: [
        { scope: 'snippet:s1', name: 'KEY', secretId: 'shared-id' },
        { scope: 'provider:codex', name: 'KEY', secretId: 'shared-id' },
      ] satisfies SecretEnvVarRef[],
    };

    const changed = pruneScopeSecretRefs(settings, 'snippet:s1', (id) => cleared.push(id));

    expect(changed).toBe(true);
    expect(settings.secretEnvVars).toEqual([
      { scope: 'provider:codex', name: 'KEY', secretId: 'shared-id' },
    ]);
    expect(cleared).toEqual([]); // value still in use by provider:codex
  });

  it('returns false when the scope has no refs', () => {
    const settings: Record<string, unknown> = {
      secretEnvVars: [{ scope: 'shared', name: 'A', secretId: 'a' }] satisfies SecretEnvVarRef[],
    };
    expect(pruneScopeSecretRefs(settings, 'snippet:none', () => undefined)).toBe(false);
  });
});
