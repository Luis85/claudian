import { vetActiveServersForRuntime } from '../../../../src/core/mcp/mcpRuntimeVetting';
import type { ResolvedAddress } from '../../../../src/core/security/urlSafety';

describe('vetActiveServersForRuntime', () => {
  const resolveTo = (...addresses: Array<[string, 4 | 6]>) =>
    jest.fn(async (): Promise<ResolvedAddress[]> =>
      addresses.map(([address, family]) => ({ address, family })));

  it('passes stdio servers through without DNS resolution', async () => {
    const resolveHost = resolveTo(['93.184.216.34', 4]);
    const servers = {
      local: { command: 'node', args: ['server.js'] },
    };

    const result = await vetActiveServersForRuntime(servers, { resolveHost });

    expect(result.safe).toEqual(servers);
    expect(result.dropped).toEqual([]);
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it('keeps URL servers that resolve to public addresses', async () => {
    const servers = {
      remote: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
    };

    const result = await vetActiveServersForRuntime(servers, {
      resolveHost: resolveTo(['93.184.216.34', 4]),
    });

    expect(result.safe).toEqual(servers);
    expect(result.dropped).toEqual([]);
  });

  it('keeps loopback servers — localhost MCP is a supported dev workflow at runtime', async () => {
    const servers = {
      literal: { type: 'sse' as const, url: 'http://127.0.0.1:3845/mcp' },
      named: { type: 'http' as const, url: 'http://localhost:3845/mcp' },
    };

    const result = await vetActiveServersForRuntime(servers, {
      resolveHost: resolveTo(['127.0.0.1', 4]),
    });

    expect(result.safe).toEqual(servers);
    expect(result.dropped).toEqual([]);
  });

  it('drops servers targeting the cloud metadata endpoint', async () => {
    const result = await vetActiveServersForRuntime({
      metadata: { type: 'http' as const, url: 'http://169.254.169.254/latest/meta-data' },
    });

    expect(result.safe).toEqual({});
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].name).toBe('metadata');
    expect(result.dropped[0].reason).toContain('link-local');
  });

  it('drops servers whose hostname resolves to a private address', async () => {
    const result = await vetActiveServersForRuntime(
      { internal: { type: 'http' as const, url: 'https://internal.example.com/mcp' } },
      { resolveHost: resolveTo(['10.0.0.5', 4]) },
    );

    expect(result.safe).toEqual({});
    expect(result.dropped[0].reason).toContain('private');
  });

  it('drops servers whose hostname fails to resolve (fail closed)', async () => {
    const result = await vetActiveServersForRuntime(
      { ghost: { type: 'http' as const, url: 'https://ghost.invalid/mcp' } },
      { resolveHost: jest.fn(async () => { throw new Error('ENOTFOUND'); }) },
    );

    expect(result.safe).toEqual({});
    expect(result.dropped[0].reason).toContain('ghost.invalid');
  });

  it('vets each server independently — one unsafe server does not drop the rest', async () => {
    const result = await vetActiveServersForRuntime({
      stdio: { command: 'node' },
      unsafe: { type: 'http' as const, url: 'http://192.168.1.10/mcp' },
      loopback: { type: 'sse' as const, url: 'http://127.0.0.1:9000/sse' },
    });

    expect(Object.keys(result.safe).sort()).toEqual(['loopback', 'stdio']);
    expect(result.dropped.map((entry) => entry.name)).toEqual(['unsafe']);
  });

  it('passes non-URL exotic configs through untouched (e.g. SDK in-process servers)', async () => {
    const exotic = { type: 'sdk', name: 'in-process', instance: {} } as never;

    const result = await vetActiveServersForRuntime({ exotic });

    expect(result.safe).toEqual({ exotic });
    expect(result.dropped).toEqual([]);
  });
});
