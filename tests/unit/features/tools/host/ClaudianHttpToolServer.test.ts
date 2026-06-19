// tests/unit/features/tools/host/ClaudianHttpToolServer.test.ts

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

import { buildHttpMcpServer, ClaudianHttpToolServer } from '@/features/tools/host/ClaudianHttpToolServer';
import type { ClaudianToolModule, LoadedTool, ToolHostContext } from '@/features/tools/toolTypes';

beforeEach(() => {
  jest.clearAllMocks();
});

function echoTool(handler: ClaudianToolModule['handler'] = async (a) => ({
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

  it('creates an McpServer named "claudian"', () => {
    const { McpServer } = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js') as {
      McpServer: jest.Mock;
    };

    buildHttpMcpServer([], () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(McpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'claudian' }),
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

describe('ClaudianHttpToolServer — bearer auth', () => {
  function makeServer() {
    const server = new ClaudianHttpToolServer(
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
    const res = { writeHead: jest.fn(), end: jest.fn() };
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
