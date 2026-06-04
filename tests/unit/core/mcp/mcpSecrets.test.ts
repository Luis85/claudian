import {
  collectMissingMcpSecrets,
  extractMcpServerSecrets,
  MCP_SECRET_PLACEHOLDER,
  reconcileEditedMcpSecrets,
  resolveMcpServerConfig,
} from '@/core/mcp/mcpSecrets';
import type { ManagedMcpServer, McpHttpServerConfig, McpStdioServerConfig } from '@/core/types';

function urlServer(over: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'remote',
    config: { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer secret', Accept: 'application/json' } },
    enabled: true,
    contextSaving: false,
    ...over,
  };
}

function stdioServer(over: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'local',
    config: { command: 'run', env: { API_KEY: 'sk-x', LOG_LEVEL: 'debug' } },
    enabled: true,
    contextSaving: false,
    ...over,
  };
}

function makeStore(seed: Record<string, string> = {}) {
  const stored = new Map<string, string>(Object.entries(seed));
  return {
    stored,
    set: (id: string, v: string) => stored.set(id, v),
    list: () => [...stored.keys()],
  };
}

describe('mcpSecrets — extractMcpServerSecrets', () => {
  it('moves a secret-shaped header into the store and strips plaintext', () => {
    const store = makeStore();
    const server = urlServer();

    const changed = extractMcpServerSecrets([server], store);

    expect(changed).toBe(true);
    const config = server.config as McpHttpServerConfig;
    expect(config.headers).toEqual({ Accept: 'application/json' }); // secret stripped, non-secret kept
    expect(server.secretHeaders).toEqual({ Authorization: 'claudian-mcp-remote-header-authorization' });
    expect(store.stored.get('claudian-mcp-remote-header-authorization')).toBe('Bearer secret');
  });

  it('moves a secret-shaped stdio env var into the store and strips plaintext', () => {
    const store = makeStore();
    const server = stdioServer();

    extractMcpServerSecrets([server], store);

    const config = server.config as McpStdioServerConfig;
    expect(config.env).toEqual({ LOG_LEVEL: 'debug' });
    expect(server.secretEnv).toEqual({ API_KEY: 'claudian-mcp-local-env-api-key' });
    expect(store.stored.get('claudian-mcp-local-env-api-key')).toBe('sk-x');
  });

  it('is idempotent and a cheap no-op once migrated', () => {
    const store = makeStore();
    const server = urlServer();
    extractMcpServerSecrets([server], store);

    expect(extractMcpServerSecrets([server], store)).toBe(false);
  });

  it('reuses an existing ref id when a key is re-entered (rotation updates in place)', () => {
    const store = makeStore({ 'claudian-mcp-remote-header-authorization': 'old' });
    const server = urlServer({
      config: { type: 'http', url: 'https://x', headers: { Authorization: 'new-value' } },
      secretHeaders: { Authorization: 'claudian-mcp-remote-header-authorization' },
    });

    extractMcpServerSecrets([server], store);

    expect(server.secretHeaders).toEqual({ Authorization: 'claudian-mcp-remote-header-authorization' });
    expect(store.stored.get('claudian-mcp-remote-header-authorization')).toBe('new-value');
  });

  it('uniquifies against unrelated stored ids so it never clobbers another secret', () => {
    const store = makeStore({ 'claudian-mcp-remote-header-authorization': 'someone-elses' });
    const server = urlServer({ secretHeaders: undefined });

    extractMcpServerSecrets([server], store);

    expect(server.secretHeaders).toEqual({ Authorization: 'claudian-mcp-remote-header-authorization-2' });
    expect(store.stored.get('claudian-mcp-remote-header-authorization')).toBe('someone-elses');
    expect(store.stored.get('claudian-mcp-remote-header-authorization-2')).toBe('Bearer secret');
  });

  it('leaves a non-secret-only config untouched', () => {
    const store = makeStore();
    const server = urlServer({
      config: { type: 'http', url: 'https://x', headers: { Accept: 'application/json' } },
    });
    expect(extractMcpServerSecrets([server], store)).toBe(false);
    expect(server.secretHeaders).toBeUndefined();
  });
});

describe('mcpSecrets — resolveMcpServerConfig', () => {
  it('overlays resolved header values without mutating the stored config', () => {
    const server = urlServer({
      config: { type: 'http', url: 'https://x', headers: { Accept: 'application/json' } },
      secretHeaders: { Authorization: 'id-auth' },
    });

    const resolved = resolveMcpServerConfig(server, (id) => (id === 'id-auth' ? 'Bearer live' : null)) as McpHttpServerConfig;

    expect(resolved.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer live' });
    // original config is not mutated
    expect((server.config as McpHttpServerConfig).headers).toEqual({ Accept: 'application/json' });
  });

  it('overlays resolved stdio env values', () => {
    const server = stdioServer({
      config: { command: 'run', env: { LOG_LEVEL: 'debug' } },
      secretEnv: { API_KEY: 'id-key' },
    });

    const resolved = resolveMcpServerConfig(server, () => 'sk-live') as McpStdioServerConfig;
    expect(resolved.env).toEqual({ LOG_LEVEL: 'debug', API_KEY: 'sk-live' });
  });

  it('omits a secret missing on this device rather than injecting empty', () => {
    const server = urlServer({
      config: { type: 'http', url: 'https://x', headers: {} },
      secretHeaders: { Authorization: 'id-auth' },
    });

    const resolved = resolveMcpServerConfig(server, () => null) as McpHttpServerConfig;
    expect(resolved.headers).toEqual({}); // never Authorization: ''
  });

  it('returns the original config when there are no secret refs', () => {
    const server = urlServer({ config: { type: 'http', url: 'https://x' }, secretHeaders: undefined });
    expect(resolveMcpServerConfig(server, () => 'x')).toBe(server.config);
  });
});

describe('mcpSecrets — collectMissingMcpSecrets', () => {
  const urlServer: ManagedMcpServer = {
    name: 'github',
    enabled: true,
    contextSaving: false,
    config: { type: 'http', url: 'https://api.example.com' } as McpHttpServerConfig,
    secretHeaders: { Authorization: 'id-auth' },
  };
  const stdioServer: ManagedMcpServer = {
    name: 'local',
    enabled: true,
    contextSaving: false,
    config: { command: 'srv' } as McpStdioServerConfig,
    secretEnv: { API_KEY: 'id-key' },
  };

  it('reports a header secret absent on this device, tagged with the server name', () => {
    const missing = collectMissingMcpSecrets([urlServer], () => null);
    expect(missing).toEqual([{ serverName: 'github', name: 'Authorization', secretId: 'id-auth' }]);
  });

  it('reports a stdio env secret that resolves empty', () => {
    const missing = collectMissingMcpSecrets([stdioServer], () => '');
    expect(missing).toEqual([{ serverName: 'local', name: 'API_KEY', secretId: 'id-key' }]);
  });

  it('returns nothing when every secret resolves', () => {
    expect(collectMissingMcpSecrets([urlServer, stdioServer], () => 'value')).toEqual([]);
  });

  it('ignores servers without secret refs', () => {
    const plain: ManagedMcpServer = {
      name: 'plain',
      enabled: true,
      contextSaving: false,
      config: { type: 'http', url: 'https://x' } as McpHttpServerConfig,
    };
    expect(collectMissingMcpSecrets([plain], () => null)).toEqual([]);
  });
});

describe('mcpSecrets — reconcileEditedMcpSecrets', () => {
  const existing = { Authorization: 'id-auth' };

  it('keeps a ref when the masked placeholder is left unchanged', () => {
    const { plaintext, refs } = reconcileEditedMcpSecrets(
      { Authorization: MCP_SECRET_PLACEHOLDER, Accept: 'json' },
      existing,
    );
    expect(refs).toEqual({ Authorization: 'id-auth' }); // unchanged secret preserved
    expect(plaintext).toEqual({ Accept: 'json' }); // no secret value written
  });

  it('drops the ref when the key is removed from the editor', () => {
    const { plaintext, refs } = reconcileEditedMcpSecrets({ Accept: 'json' }, existing);
    expect(refs).toEqual({}); // removed → ref dropped
    expect(plaintext).toEqual({ Accept: 'json' });
  });

  it('drops the ref when the key is emptied (KEY=)', () => {
    const { refs } = reconcileEditedMcpSecrets({ Authorization: '' }, existing);
    expect(refs).toEqual({});
  });

  it('reuses the existing id when the secret is re-entered with a new value', () => {
    const { plaintext, refs } = reconcileEditedMcpSecrets({ Authorization: 'Bearer new' }, existing);
    // value flows through as plaintext for migration; the id is preserved for reuse
    expect(plaintext).toEqual({ Authorization: 'Bearer new' });
    expect(refs).toEqual({ Authorization: 'id-auth' });
  });

  it('treats a brand-new key as plaintext (migration decides if it is secret-shaped)', () => {
    const { plaintext, refs } = reconcileEditedMcpSecrets({ 'X-Api-Token': 'tok' }, undefined);
    expect(plaintext).toEqual({ 'X-Api-Token': 'tok' });
    expect(refs).toEqual({});
  });
});
