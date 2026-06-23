// tests/unit/features/tools/host/SpecoratorHttpToolServer.test.ts

// Mock the MCP SDK server modules so we can unit-test tool registration
// without a real HTTP socket (mirrors InProcessToolMcpServer.test.ts pattern).
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockRegisterTool = jest.fn();

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    registerTool: mockRegisterTool,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation(() => ({})),
}));

import { z } from 'zod';

import type { HttpToolServerConfig } from '@/features/tools/host/SpecoratorHttpToolServer';
import { buildHttpMcpServer, SpecoratorHttpToolServer } from '@/features/tools/host/SpecoratorHttpToolServer';
import { scopedToolKey } from '@/features/tools/scopedTools';
import type { SpecoratorToolModule, LoadedTool, ToolHostContext } from '@/features/tools/toolTypes';

beforeEach(() => {
  jest.clearAllMocks();
});

function echoTool(handler: SpecoratorToolModule['handler'] = async (a) => ({
  content: [{ type: 'text', text: String((a as { text: string }).text) }],
})): LoadedTool {
  return {
    id: 'echo',
    module: {
      manifest: { name: 'echo', description: 'echo tool', input: z.object({ text: z.string() }) },
      handler,
    },
    jsonSchema: {},
  };
}

describe('buildHttpMcpServer', () => {
  it('registers one tool per error-free loaded tool and skips errored ones', () => {
    const loaded: LoadedTool[] = [echoTool(), { id: 'broken', error: 'bad' }];

    buildHttpMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(mockRegisterTool).toHaveBeenCalledTimes(1);
    expect(mockRegisterTool.mock.calls[0][0]).toBe('echo');
    expect(mockRegisterTool.mock.calls[0][1]).toMatchObject({
      description: 'echo tool',
    });
  });

  it('passes the manifest inputSchema shape to registerTool', () => {
    const tool = echoTool();
    const loaded: LoadedTool[] = [tool];

    buildHttpMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    // inputSchema forwarded by reference — same shape object as the manifest
    expect(mockRegisterTool.mock.calls[0][1].inputSchema).toBe(tool.module!.manifest.input.shape);
  });

  it('wires the registered handler to the module handler with the host context', async () => {
    const handler = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const ctx: ToolHostContext = { app: {} as never, signal: new AbortController().signal };

    buildHttpMcpServer([echoTool(handler)], () => ctx);

    // The 3rd arg to registerTool is the handler the server invokes.
    const sdkHandler = mockRegisterTool.mock.calls[0][2] as (args: unknown) => Promise<unknown>;
    const result = await sdkHandler({ text: 'hi' });

    expect(handler).toHaveBeenCalledWith({ text: 'hi' }, ctx);
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('creates an McpServer named "specorator"', () => {
    const { McpServer } = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js') as {
      McpServer: jest.Mock;
    };

    buildHttpMcpServer([], () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(McpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'specorator' }),
    );
  });

  it('registers no tools when all tools have errors', () => {
    const loaded: LoadedTool[] = [
      { id: 'broken1', error: 'bad1' },
      { id: 'broken2', error: 'bad2' },
    ];

    buildHttpMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(mockRegisterTool).not.toHaveBeenCalled();
  });
});

describe('SpecoratorHttpToolServer — bearer auth', () => {
  function makeServer() {
    const server = new SpecoratorHttpToolServer(
      () => [],
      () => ({ app: {} as never, signal: new AbortController().signal }),
    );
    const handleRequest = jest.fn().mockResolvedValue(undefined);
    // Inject a ready transport so the authorized path delegates.
    (server as unknown as { transport: unknown }).transport = { handleRequest };
    const token = (server as unknown as { bearerToken: string }).bearerToken;
    const call = (
      server as unknown as { handleHttpRequest(req: unknown, res: unknown): void }
    ).handleHttpRequest.bind(server);
    return { handleRequest, token, call };
  }

  function makeReqRes(auth?: string) {
    const req = { headers: auth === undefined ? {} : { authorization: auth } };
    const res = { writeHead: jest.fn(), end: jest.fn(), on: jest.fn() };
    return { req, res };
  }

  it('rejects a request with no Authorization header (401, transport untouched)', () => {
    const { handleRequest, call } = makeServer();
    const { req, res } = makeReqRes(undefined);

    call(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer token (401, transport untouched)', () => {
    const { handleRequest, call } = makeServer();
    const { req, res } = makeReqRes('Bearer wrong-token');

    call(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('delegates to the transport with the correct bearer token', () => {
    const { handleRequest, token, call } = makeServer();
    const { req, res } = makeReqRes(`Bearer ${token}`);

    call(req, res);

    expect(res.writeHead).not.toHaveBeenCalledWith(401, expect.anything());
    expect(handleRequest).toHaveBeenCalledWith(req, res);
  });
});

describe('SpecoratorHttpToolServer — grant-scoped token registry', () => {
  function namedTool(name: string): LoadedTool {
    return {
      id: name,
      module: {
        manifest: { name, description: `${name} tool`, input: z.object({ text: z.string() }) },
        handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      },
      jsonSchema: {},
    };
  }

  // capability ids the grant list uses: mcp__specorator__<name>
  const cap = (name: string): string => `mcp__specorator__${name}`;

  // A started-enough server: real config + httpServer injected so getConfig and
  // the lazy/eager builds run, without binding a real socket.
  async function makeStartedServer(loaded: LoadedTool[]) {
    const server = new SpecoratorHttpToolServer(
      () => loaded,
      () => ({ app: {} as never, signal: new AbortController().signal }),
    );
    (server as unknown as { httpServer: unknown }).httpServer = {};
    (server as unknown as { config: HttpToolServerConfig }).config = {
      url: 'http://127.0.0.1:1234/mcp',
      headers: {},
    };
    // Mirror startServer's default-fingerprint registration + default build.
    const internal = server as unknown as {
      bearerToken: string;
      tokenByFingerprint: Map<string, string>;
      defaultLayer: { grant: string[] | undefined };
      buildLayer(layer: unknown): Promise<void>;
    };
    internal.tokenByFingerprint.set(scopedToolKey(loaded, undefined), internal.bearerToken);
    await internal.buildLayer(internal.defaultLayer);
    return server;
  }

  const tokenOf = (cfg: HttpToolServerConfig | null): string =>
    (cfg?.headers.Authorization ?? '').replace('Bearer ', '');

  it('getConfig() and getConfig([]) return the default (all-tools) bearer token', async () => {
    const server = await makeStartedServer([namedTool('alpha'), namedTool('beta')]);
    const defaultToken = (server as unknown as { bearerToken: string }).bearerToken;

    const noArg = server.getConfig();
    const empty = server.getConfig([]);

    expect(tokenOf(noArg)).toBe(defaultToken);
    expect(tokenOf(empty)).toBe(defaultToken);
    // url byte-identical to the started config; only the header carries the token.
    expect(noArg?.url).toBe('http://127.0.0.1:1234/mcp');
  });

  it('returns null before start()', () => {
    const server = new SpecoratorHttpToolServer(
      () => [],
      () => ({ app: {} as never, signal: new AbortController().signal }),
    );
    expect(server.getConfig()).toBeNull();
    expect(server.getConfig(['mcp__specorator__alpha'])).toBeNull();
  });

  it('mints a non-default token for a grant and dedupes identical grants', async () => {
    const server = await makeStartedServer([namedTool('alpha'), namedTool('beta')]);
    const defaultToken = (server as unknown as { bearerToken: string }).bearerToken;

    const a1 = tokenOf(server.getConfig([cap('alpha')]));
    const a2 = tokenOf(server.getConfig([cap('alpha')]));
    const b = tokenOf(server.getConfig([cap('beta')]));

    expect(a1).not.toBe(defaultToken);
    expect(a1).toBe(a2); // same grant signature → same token + layer
    expect(b).not.toBe(a1); // different grant → different token
  });

  it('gives a grant that matches no tools its own zero-tool layer (not the all-tools default)', async () => {
    const server = await makeStartedServer([namedTool('alpha')]);
    const defaultToken = (server as unknown as { bearerToken: string }).bearerToken;

    // A non-empty grant referencing a non-existent tool must reach NOTHING — it
    // gets a distinct token whose scoped layer registered zero tools, never the
    // all-tools default token (which would over-grant).
    mockRegisterTool.mockClear();
    const ghostToken = tokenOf(server.getConfig([cap('ghost')]));
    await Promise.resolve();
    await Promise.resolve();

    expect(ghostToken).not.toBe(defaultToken);
    expect(mockRegisterTool).not.toHaveBeenCalled();
  });

  it("builds each grant's layer from getScopedTools (only granted tools registered)", async () => {
    const loaded = [namedTool('alpha'), namedTool('beta'), namedTool('gamma')];
    const server = await makeStartedServer(loaded);

    // Mint grant-A (alpha only) and let its async layer build settle.
    mockRegisterTool.mockClear();
    server.getConfig([cap('alpha')]);
    await Promise.resolve();
    await Promise.resolve();

    const registered = mockRegisterTool.mock.calls.map((c) => c[0]);
    expect(registered).toEqual(['alpha']); // beta/gamma not registered on A's layer
  });

  it('routes a request with grant-A token to a layer that lists only A and 401s an unknown token', async () => {
    const loaded = [namedTool('alpha'), namedTool('beta')];
    const server = await makeStartedServer(loaded);

    const aToken = tokenOf(server.getConfig([cap('alpha')]));
    await Promise.resolve();
    await Promise.resolve();

    // Capture the transport bound to grant-A's layer.
    const layers = (server as unknown as { layers: Map<string, { transport: { handleRequest: jest.Mock } }> }).layers;
    const aHandle = jest.fn().mockResolvedValue(undefined);
    layers.get(aToken)!.transport = { handleRequest: aHandle } as never;

    const call = (
      server as unknown as { handleHttpRequest(req: unknown, res: unknown): void }
    ).handleHttpRequest.bind(server);

    // grant-A token → delegates to A's layer transport.
    const okRes = { writeHead: jest.fn(), end: jest.fn(), on: jest.fn() };
    call({ headers: { authorization: `Bearer ${aToken}` } }, okRes);
    expect(aHandle).toHaveBeenCalledTimes(1);
    expect(okRes.writeHead).not.toHaveBeenCalledWith(401, expect.anything());

    // unknown token → 401, no delegation.
    const badRes = { writeHead: jest.fn(), end: jest.fn(), on: jest.fn() };
    call({ headers: { authorization: 'Bearer garbage' } }, badRes);
    expect(badRes.writeHead).toHaveBeenCalledWith(401, expect.anything());
  });

  it('rebuild() keeps a previously-issued grant token resolvable (no spurious 503)', async () => {
    let loaded = [namedTool('alpha'), namedTool('beta')];
    const server = new SpecoratorHttpToolServer(
      () => loaded,
      () => ({ app: {} as never, signal: new AbortController().signal }),
    );
    (server as unknown as { httpServer: unknown }).httpServer = {};
    (server as unknown as { config: HttpToolServerConfig }).config = {
      url: 'http://127.0.0.1:1234/mcp',
      headers: {},
    };
    const internal = server as unknown as {
      bearerToken: string;
      tokenByFingerprint: Map<string, string>;
      defaultLayer: { grant: string[] | undefined };
      buildLayer(layer: unknown): Promise<void>;
    };
    internal.tokenByFingerprint.set(scopedToolKey(loaded, undefined), internal.bearerToken);
    await internal.buildLayer(internal.defaultLayer);

    const aToken = tokenOf(server.getConfig([cap('alpha')]));
    await Promise.resolve();
    await Promise.resolve();

    // Tool set changes; rebuild tears down + rebuilds every layer eagerly.
    loaded = [namedTool('alpha'), namedTool('gamma')];
    await (server as unknown as { rebuild(): Promise<void> }).rebuild();

    // The grant-A token still resolves to a layer with a live transport (no 503).
    const layers = (server as unknown as {
      layers: Map<string, { transport: { handleRequest: jest.Mock } | null }>;
    }).layers;
    const aLayer = layers.get(aToken);
    expect(aLayer?.transport).not.toBeNull();

    // Stub the rebuilt transport's handleRequest (the SDK transport is mocked as
    // {}), then confirm the held token delegates rather than 503/401-ing.
    const handle = jest.fn().mockResolvedValue(undefined);
    aLayer!.transport = { handleRequest: handle };

    const call = (
      server as unknown as { handleHttpRequest(req: unknown, res: unknown): void }
    ).handleHttpRequest.bind(server);
    const res = { writeHead: jest.fn(), end: jest.fn(), on: jest.fn() };
    call({ headers: { authorization: `Bearer ${aToken}` } }, res);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalledWith(503, expect.anything());
    expect(res.writeHead).not.toHaveBeenCalledWith(401, expect.anything());
  });
});

describe('SpecoratorHttpToolServer — in-flight drain on rebuild', () => {
  // Captures res.on listeners so tests can fire 'finish'/'close' deterministically.
  function makeServer() {
    const server = new SpecoratorHttpToolServer(
      () => [],
      () => ({ app: {} as never, signal: new AbortController().signal }),
    );
    const handleRequest = jest.fn().mockResolvedValue(undefined);
    (server as unknown as { transport: unknown }).transport = { handleRequest };
    const token = (server as unknown as { bearerToken: string }).bearerToken;
    const call = (
      server as unknown as { handleHttpRequest(req: unknown, res: unknown): void }
    ).handleHttpRequest.bind(server);
    const inFlight = (): number => (server as unknown as { inFlight: number }).inFlight;
    return { server, handleRequest, token, call, inFlight };
  }

  function makeReqRes(auth: string) {
    const listeners: Record<string, Array<() => void>> = {};
    const req = { headers: { authorization: auth } };
    const res = {
      writeHead: jest.fn(),
      end: jest.fn(),
      on: jest.fn((event: string, cb: () => void) => {
        (listeners[event] ??= []).push(cb);
      }),
    };
    const emit = (event: string): void => {
      for (const cb of listeners[event] ?? []) cb();
    };
    return { req, res, emit };
  }

  it('increments then decrements the in-flight counter on the finish path', () => {
    const { call, token, inFlight } = makeServer();
    const { req, res, emit } = makeReqRes(`Bearer ${token}`);

    call(req, res);
    expect(inFlight()).toBe(1);

    emit('finish');
    expect(inFlight()).toBe(0);
  });

  it('decrements only once when both finish and close fire', () => {
    const { call, token, inFlight } = makeServer();
    const { req, res, emit } = makeReqRes(`Bearer ${token}`);

    call(req, res);
    expect(inFlight()).toBe(1);

    emit('finish');
    emit('close');
    expect(inFlight()).toBe(0);
  });

  it('does not track unauthorized requests (transport never reached)', () => {
    const { call, inFlight } = makeServer();
    const { req, res } = makeReqRes('Bearer wrong');

    call(req, res);
    expect(inFlight()).toBe(0);
  });

  it('rebuild() waits for an in-flight request to settle before tearing down', async () => {
    jest.useFakeTimers();
    try {
      const { server, call, token, inFlight } = makeServer();
      const tearDown = jest.fn(async () => {});
      const attach = jest.fn(async () => {});
      (server as unknown as { tearDownMcpLayer: () => Promise<void> }).tearDownMcpLayer = tearDown;
      (server as unknown as { attachMcpLayer: () => Promise<void> }).attachMcpLayer = attach;
      (server as unknown as { httpServer: unknown }).httpServer = {};
      (server as unknown as { config: unknown }).config = { url: 'x', headers: {} };

      const { req, res, emit } = makeReqRes(`Bearer ${token}`);
      call(req, res);
      expect(inFlight()).toBe(1);

      const rebuildPromise = (server as unknown as { rebuild(): Promise<void> }).rebuild();

      // Drain still pending: teardown must not have run yet.
      await jest.advanceTimersByTimeAsync(100);
      expect(tearDown).not.toHaveBeenCalled();

      // Request completes → next poll lets the drain finish.
      emit('finish');
      await jest.advanceTimersByTimeAsync(50);
      await rebuildPromise;

      expect(tearDown).toHaveBeenCalledTimes(1);
      expect(attach).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rebuild() proceeds after the timeout ceiling if a request never settles', async () => {
    jest.useFakeTimers();
    try {
      const { server, call, token, inFlight } = makeServer();
      const tearDown = jest.fn(async () => {});
      const attach = jest.fn(async () => {});
      (server as unknown as { tearDownMcpLayer: () => Promise<void> }).tearDownMcpLayer = tearDown;
      (server as unknown as { attachMcpLayer: () => Promise<void> }).attachMcpLayer = attach;
      (server as unknown as { httpServer: unknown }).httpServer = {};
      (server as unknown as { config: unknown }).config = { url: 'x', headers: {} };

      const { req, res } = makeReqRes(`Bearer ${token}`);
      call(req, res);
      expect(inFlight()).toBe(1);

      const rebuildPromise = (server as unknown as { rebuild(): Promise<void> }).rebuild();

      // Never fire finish/close; advance past the 5000ms ceiling.
      await jest.advanceTimersByTimeAsync(6000);
      await rebuildPromise;

      expect(tearDown).toHaveBeenCalledTimes(1);
      expect(attach).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
