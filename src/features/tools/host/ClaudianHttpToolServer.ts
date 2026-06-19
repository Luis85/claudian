// src/features/tools/host/ClaudianHttpToolServer.ts
import * as crypto from 'node:crypto';
import * as http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { LoadedTool, ToolHostContext, ToolTextResult } from '../toolTypes';

export const CLAUDIAN_HTTP_TOOL_SERVER_NAME = 'claudian';

export interface HttpToolServerConfig {
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds a fresh McpServer with the current error-free tools registered.
 * Extracted so the tool→registerTool mapping is unit-testable without a real
 * HTTP socket (mirrors the Claude-tier approach in InProcessToolMcpServer.ts).
 */
export function buildHttpMcpServer(
  loaded: LoadedTool[],
  ctxFactory: () => ToolHostContext,
): McpServer {
  const server = new McpServer({
    name: CLAUDIAN_HTTP_TOOL_SERVER_NAME,
    version: '1.0.0',
  });

  const errorFreeTools = loaded.filter(
    (t): t is LoadedTool & { module: NonNullable<LoadedTool['module']> } => !!t.module && !t.error,
  );

  for (const t of errorFreeTools) {
    server.registerTool(
      t.module.manifest.name,
      {
        description: t.module.manifest.description,
        inputSchema: t.module.manifest.input.shape,
      },
      async (args: unknown) => {
        const result: ToolTextResult = await t.module.handler(args, ctxFactory());
        // ToolTextResult is a structural subset of the SDK's CallToolResult
        // (whose content union also allows image/audio); the cast reconciles
        // the narrower text-only shape we expose to tool authors.
        return result as unknown as CallToolResult;
      },
    );
  }

  return server;
}

/**
 * In-process Streamable-HTTP MCP server exposing Claudian user-tool handlers
 * with full Obsidian context. Providers (currently Opencode) connect via the
 * loopback URL returned by `getConfig()`.
 *
 * Security: loopback-only bind + per-process bearer token. The token is
 * included in the MCP config headers so only processes we spawn can use it.
 */
export class ClaudianHttpToolServer {
  private config: HttpToolServerConfig | null = null;
  private httpServer: http.Server | null = null;
  private mcpServer: McpServer | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private readonly bearerToken: string = crypto.randomUUID();

  constructor(
    private readonly getLoaded: () => LoadedTool[],
    private readonly ctxFactory: () => ToolHostContext,
  ) {}

  async start(): Promise<void> {
    await this.startServer();
  }

  getConfig(): HttpToolServerConfig | null {
    return this.config;
  }

  /**
   * Rebuilds the McpServer and transport with the current tool set. Safe to
   * call between runs; replaces the old server/transport without changing the
   * HTTP port or bearer token.
   */
  async rebuild(): Promise<void> {
    if (!this.httpServer || !this.config) {
      // Not yet started; ignore.
      return;
    }

    // Close old MCP layer (doesn't touch the HTTP socket).
    await this.tearDownMcpLayer();
    await this.attachMcpLayer();
  }

  async stop(): Promise<void> {
    await this.tearDownMcpLayer();
    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close(() => resolve());
      this.httpServer = null;
    });
    this.config = null;
  }

  private async startServer(): Promise<void> {
    const server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.httpServer = server;
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    this.config = {
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    };

    await this.attachMcpLayer();
  }

  private async attachMcpLayer(): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: no session id, no state held between requests.
      // Each tool call is an independent HTTP round-trip; this matches
      // the one-client-per-spawn usage pattern (Opencode spawns once and
      // uses the same process lifetime as the plugin).
      sessionIdGenerator: undefined,
    });
    const mcpServer = buildHttpMcpServer(this.getLoaded(), this.ctxFactory);
    await mcpServer.connect(transport);
    this.transport = transport;
    this.mcpServer = mcpServer;
  }

  private async tearDownMcpLayer(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.close().catch(() => {});
      this.mcpServer = null;
    }
    this.transport = null;
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Validate bearer token (constant-time) before delegating to MCP transport.
    const authHeader = req.headers['authorization'];
    if (!this.isAuthorized(authHeader)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (!this.transport) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not ready' }));
      return;
    }

    void this.transport.handleRequest(req, res);
  }

  private isAuthorized(authHeader: string | string[] | undefined): boolean {
    if (typeof authHeader !== 'string') return false;
    const expected = Buffer.from(`Bearer ${this.bearerToken}`);
    const got = Buffer.from(authHeader);
    // Length check first: timingSafeEqual throws on length mismatch.
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  }
}
