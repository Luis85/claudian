// src/features/tools/host/ClaudianHttpToolServer.ts
import * as crypto from 'node:crypto';
import * as http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { LoadedTool, ToolHostContext } from '../toolTypes';
import { makeBoundedToolCallback } from './toolInvocation';

export const CLAUDIAN_HTTP_TOOL_SERVER_NAME = 'claudian';

// Bounded drain on rebuild: wait out in-flight tool calls before swapping the
// MCP layer so a tool-file save mid-request doesn't abort the call. Ceiling
// keeps rebuild from hanging forever if a request never completes; the short
// poll keeps the wait tight when the layer is actually idle.
const DRAIN_TIMEOUT_MS = 5000;
const DRAIN_POLL_INTERVAL_MS = 25;

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
  ctxFactory: (signal: AbortSignal) => ToolHostContext,
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
      makeBoundedToolCallback(t.module, ctxFactory),
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
  // Count of requests handed to the transport but not yet completed; drives the
  // rebuild drain so the MCP layer isn't torn down mid-call.
  private inFlight = 0;

  constructor(
    private readonly getLoaded: () => LoadedTool[],
    private readonly ctxFactory: (signal: AbortSignal) => ToolHostContext,
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

    // Drain in-flight calls before swapping; requests arriving during the
    // drain still hit the old (attached) transport, which is correct.
    await this.drainInFlight();

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

  // Polls until no requests are in flight or the ceiling elapses; proceeds
  // anyway after the timeout so rebuild can never hang on a stuck request.
  private async drainInFlight(): Promise<void> {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, DRAIN_POLL_INTERVAL_MS));
    }
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

    // Track only transport-bound requests (the ones tied to the MCP layer the
    // rebuild drain waits on). We listen on both 'finish' and 'close': 'close'
    // is the leak-prevention backstop — it fires even when a request is aborted
    // or errored (no clean 'finish'), so the counter can't pin > 0 forever.
    // A clean response emits both, so the settled guard makes the decrement
    // fire exactly once.
    this.inFlight++;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      this.inFlight--;
    };
    res.on('finish', settle);
    res.on('close', settle);

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
