import { testMcpServer } from '@/core/mcp/McpTester';
import type { HostResolver } from '@/core/security/urlSafety';
import type { ManagedMcpServer } from '@/core/types';

// SSRF guard seam: unit tests never hit real DNS. Default to a public answer
// so the pre-guard URL tests keep exercising the happy path.
const publicResolver: HostResolver = jest.fn(async () => [
  { address: '93.184.216.34', family: 4 as const },
]);
const testOptions = { resolveHost: publicResolver };

// Mock the MCP SDK transports and client
jest.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    getServerVersion: jest.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' }),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        { name: 'tool1', description: 'A test tool', inputSchema: { type: 'object' } },
        { name: 'tool2' },
      ],
    }),
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio', () => ({
  StdioClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@/utils/env', () => ({
  curateStdioMcpEnv: jest.fn((configuredEnv: Record<string, string> = {}) => ({
    ...configuredEnv,
    PATH: configuredEnv.PATH || '/usr/bin',
  })),
}));

jest.mock('@/utils/mcp', () => ({
  parseCommand: jest.fn((cmd: string, args?: string[]) => {
    if (args && args.length > 0) return { cmd, args };
    const parts = cmd.split(' ');
    return { cmd: parts[0] || '', args: parts.slice(1) };
  }),
}));

describe('testMcpServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('stdio server', () => {
    it('should connect and return tools for a valid stdio server', async () => {
      const server: ManagedMcpServer = {
        name: 'test',
        config: { command: 'node server.js', args: ['--port', '3000'] },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.serverVersion).toBe('1.0.0');
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('tool1');
      expect(result.tools[0].description).toBe('A test tool');
      expect(result.tools[1].name).toBe('tool2');
    });

    it('should return error for missing command', async () => {
      const { parseCommand } = jest.requireMock('@/utils/mcp');
      parseCommand.mockReturnValueOnce({ cmd: '', args: [] });

      const server: ManagedMcpServer = {
        name: 'empty',
        config: { command: '' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing command');
      expect(result.tools).toEqual([]);
    });
  });

  describe('sse server', () => {
    it('should connect to an SSE server', async () => {
      const { SSEClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/sse');
      const server: ManagedMcpServer = {
        name: 'sse-test',
        config: { type: 'sse' as const, url: 'https://example.com/sse' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(result.tools).toHaveLength(2);
      expect(SSEClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          fetch: expect.any(Function),
        }),
      );
    });
  });

  describe('http server', () => {
    it('should connect to an HTTP server', async () => {
      const { StreamableHTTPClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/streamableHttp');
      const server: ManagedMcpServer = {
        name: 'http-test',
        config: { type: 'http' as const, url: 'https://example.com/api' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          fetch: expect.any(Function),
        }),
      );
    });

    it('should pass headers when configured', async () => {
      const { StreamableHTTPClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/streamableHttp');
      const server: ManagedMcpServer = {
        name: 'http-auth',
        config: {
          type: 'http' as const,
          url: 'https://example.com/api',
          headers: { Authorization: 'Bearer token' },
        },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          fetch: expect.any(Function),
          requestInit: { headers: { Authorization: 'Bearer token' } },
        }),
      );
    });
  });

  describe('SSRF guard (SEC-D)', () => {
    function urlServer(url: string): ManagedMcpServer {
      return {
        name: 'remote',
        config: { type: 'http' as const, url },
        enabled: true,
        contextSaving: false,
      };
    }

    function expectNoConnectionAttempt() {
      const { StreamableHTTPClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/streamableHttp');
      const { SSEClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/sse');
      const { Client } = jest.requireMock('@modelcontextprotocol/sdk/client');
      expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
      expect(SSEClientTransport).not.toHaveBeenCalled();
      expect(Client).not.toHaveBeenCalled();
    }

    it.each([
      'http://127.0.0.1:8080/mcp',
      'http://[::1]:8080/mcp',
      'http://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/mcp',
      'http://192.168.1.20/mcp',
      'http://[fd00::1]/mcp',
    ])('refuses literal denied IP %s before any transport is built', async (url) => {
      const neverResolve: HostResolver = jest.fn(async () => {
        throw new Error('must not resolve literal IPs');
      });

      const result = await testMcpServer(urlServer(url), undefined, { resolveHost: neverResolve });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Blocked for safety/);
      expect(neverResolve).not.toHaveBeenCalled();
      expectNoConnectionAttempt();
    });

    it('refuses hostnames that resolve to loopback (localhost)', async () => {
      const resolveHost: HostResolver = jest.fn(async () => [
        { address: '127.0.0.1', family: 4 as const },
      ]);

      const result = await testMcpServer(urlServer('http://localhost:3000/mcp'), undefined, { resolveHost });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/loopback/);
      expectNoConnectionAttempt();
    });

    it('refuses hostnames where ANY DNS record is private', async () => {
      const resolveHost: HostResolver = jest.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '10.0.0.9', family: 4 as const },
      ]);

      const result = await testMcpServer(urlServer('https://mixed.example/mcp'), undefined, { resolveHost });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/10\.0\.0\.9/);
      expectNoConnectionAttempt();
    });

    it('refuses non-http(s) schemes', async () => {
      const result = await testMcpServer(urlServer('ftp://example.com/mcp'), undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/scheme/i);
      expectNoConnectionAttempt();
    });

    it('fails closed when DNS resolution fails', async () => {
      const resolveHost: HostResolver = jest.fn(async () => {
        throw new Error('ENOTFOUND');
      });

      const result = await testMcpServer(urlServer('https://nx.example/mcp'), undefined, { resolveHost });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Could not resolve/);
      expectNoConnectionAttempt();
    });

    it('connects to public hosts with a rebinding-pinned fetch', async () => {
      const { StreamableHTTPClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/streamableHttp');
      const resolveHost: HostResolver = jest.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]);

      const result = await testMcpServer(urlServer('https://mcp.example.com/mcp'), undefined, { resolveHost });

      expect(result.success).toBe(true);
      expect(resolveHost).toHaveBeenCalledWith('mcp.example.com');
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ fetch: expect.any(Function) }),
      );
    });
  });

  describe('error handling', () => {
    it('should return error when transport creation fails', async () => {
      const { SSEClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/sse');
      SSEClientTransport.mockImplementationOnce(() => {
        throw new Error('Transport init failed');
      });

      const server: ManagedMcpServer = {
        name: 'bad-sse',
        config: { type: 'sse' as const, url: 'https://example.com/sse' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transport init failed');
      expect(result.tools).toEqual([]);
    });

    it('should return generic error for non-Error transport failures', async () => {
      const { StreamableHTTPClientTransport } = jest.requireMock('@modelcontextprotocol/sdk/client/streamableHttp');
      StreamableHTTPClientTransport.mockImplementationOnce(() => {
        throw 'string error';
      });

      const server: ManagedMcpServer = {
        name: 'bad-http',
        config: { type: 'http' as const, url: 'https://example.com' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid server configuration');
    });

    it('should return error when connection fails', async () => {
      const { Client } = jest.requireMock('@modelcontextprotocol/sdk/client');
      Client.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
        close: jest.fn(),
      }));

      const server: ManagedMcpServer = {
        name: 'refused',
        config: { command: 'node server.js' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should return unknown error for non-Error connection failures', async () => {
      const { Client } = jest.requireMock('@modelcontextprotocol/sdk/client');
      Client.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(42),
        close: jest.fn(),
      }));

      const server: ManagedMcpServer = {
        name: 'weird-error',
        config: { command: 'node server.js' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle listTools failure gracefully (partial success)', async () => {
      const { Client } = jest.requireMock('@modelcontextprotocol/sdk/client');
      Client.mockImplementationOnce(() => ({
        connect: jest.fn(),
        getServerVersion: jest.fn().mockReturnValue({ name: 'partial', version: '0.1' }),
        listTools: jest.fn().mockRejectedValue(new Error('listTools not supported')),
        close: jest.fn(),
      }));

      const server: ManagedMcpServer = {
        name: 'partial',
        config: { command: 'node server.js' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('partial');
      expect(result.tools).toEqual([]);
    });

    it('should handle close errors silently', async () => {
      const { Client } = jest.requireMock('@modelcontextprotocol/sdk/client');
      Client.mockImplementationOnce(() => ({
        connect: jest.fn(),
        getServerVersion: jest.fn().mockReturnValue(null),
        listTools: jest.fn().mockResolvedValue({ tools: [] }),
        close: jest.fn().mockRejectedValue(new Error('close failed')),
      }));

      const server: ManagedMcpServer = {
        name: 'close-fail',
        config: { command: 'node server.js' },
        enabled: true,
        contextSaving: false,
      };

      const result = await testMcpServer(server, undefined, testOptions);

      expect(result.success).toBe(true);
      expect(result.serverName).toBeUndefined();
    });
  });
});
