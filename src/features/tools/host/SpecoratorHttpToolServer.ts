// src/features/tools/host/SpecoratorHttpToolServer.ts
import * as crypto from 'node:crypto';
import * as http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { getScopedTools, scopedToolKey } from '../scopedTools';
import type { LoadedTool, ToolHostContext } from '../toolTypes';
import { makeBoundedToolCallback } from './toolInvocation';

export const SPECORATOR_HTTP_TOOL_SERVER_NAME = 'specorator';

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
    name: SPECORATOR_HTTP_TOOL_SERVER_NAME,
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

// One scoped MCP layer per distinct grant signature. `grant === undefined` is
// the default (all-tools) entry. `transport`/`mcpServer` are null between a
// rebuild's teardown and the next lazy rebuild for this token.
interface ScopedLayer {
  grant: string[] | undefined;
  transport: StreamableHTTPServerTransport | null;
  mcpServer: McpServer | null;
}

/**
 * In-process Streamable-HTTP MCP server exposing Specorator user-tool handlers
 * with full Obsidian context. Providers (Opencode, Cursor) connect via the
 * loopback URL returned by `getConfig()`.
 *
 * Grant scoping: the server is keyed by bearer token. A default token maps to
 * the all-tools layer (today's behavior, byte-identical). A bound agent with a
 * restricted grant gets its own token + scoped layer built from
 * `getScopedTools(loaded, grant)`. Enforcement is by construction — a tool
 * outside the grant is never registered on that layer's McpServer, so neither
 * listing nor invocation can reach it regardless of how a provider caches its
 * config. The token in the request header selects the layer.
 *
 * Security: loopback-only bind + per-grant bearer token. Each token is included
 * in the MCP config headers so only processes we spawn can use it.
 */
export class SpecoratorHttpToolServer {
  private config: HttpToolServerConfig | null = null;
  private httpServer: http.Server | null = null;
  // The default (all-tools) token; its grant is `undefined`. Aliased as
  // `bearerToken` for the long-standing default-path behavior and tests.
  private readonly bearerToken: string = crypto.randomUUID();
  // token → scoped layer. Seeded with the default (all-tools) entry on start.
  private readonly layers = new Map<string, ScopedLayer>();
  // grant fingerprint → token, so identical grants reuse one token + layer. The
  // default/empty grant maps to `bearerToken`.
  private readonly tokenByFingerprint = new Map<string, string>();
  // Count of requests handed to a transport but not yet completed; drives the
  // rebuild drain so the MCP layers aren't torn down mid-call. Global across
  // layers — the drain waits for ALL in-flight requests before teardown.
  private inFlight = 0;

  // The default (all-tools) layer. Seeded eagerly so its token resolves and the
  // `transport` accessor below has a backing entry even before start().
  private readonly defaultLayer: ScopedLayer = {
    grant: undefined,
    transport: null,
    mcpServer: null,
  };

  constructor(
    private readonly getLoaded: () => LoadedTool[],
    private readonly ctxFactory: (signal: AbortSignal) => ToolHostContext,
  ) {
    this.layers.set(this.bearerToken, this.defaultLayer);
  }

  // Compatibility accessor for the default layer's transport: the long-standing
  // single-layer surface. Reads/writes the default (all-tools) layer so a
  // directly-injected transport (and the default request path) still resolves.
  private get transport(): StreamableHTTPServerTransport | null {
    return this.defaultLayer.transport;
  }
  private set transport(t: StreamableHTTPServerTransport | null) {
    this.defaultLayer.transport = t;
  }

  async start(): Promise<void> {
    await this.startServer();
  }

  /**
   * Returns the loopback config for a conversation. No grant (or an empty grant)
   * yields the default all-tools token — byte-identical to the pre-scoping
   * behavior. A non-empty grant mints (or reuses) a token for that grant
   * signature and lazily builds its scoped layer; the URL is the shared `/mcp`
   * and the token in the header selects the layer. Returns null before start().
   */
  getConfig(grantedToolIds?: string[]): HttpToolServerConfig | null {
    if (!this.config) return null;
    if (!grantedToolIds || grantedToolIds.length === 0) {
      return this.configForToken(this.bearerToken);
    }
    const token = this.ensureScopedToken(grantedToolIds);
    return this.configForToken(token);
  }

  /**
   * Rebuilds every scoped layer with the current tool set. Safe to call between
   * runs; replaces each layer's server/transport without changing the HTTP port
   * or any token. The token→grant registry is preserved so a token a provider
   * already holds still resolves; teardown layers rebuild lazily on their next
   * request (so a known token never spuriously 503s after a rebuild).
   */
  async rebuild(): Promise<void> {
    if (!this.httpServer || !this.config) {
      // Not yet started; ignore.
      return;
    }

    // Drain in-flight calls before swapping; requests arriving during the
    // drain still hit the old (attached) transports, which is correct.
    await this.drainInFlight();

    // Close every MCP layer (doesn't touch the HTTP socket), then rebuild them.
    // The token→grant registry is preserved across both, so a token a provider
    // already holds still resolves; a torn-down-but-known token also rebuilds
    // lazily in handleHttpRequest as a backstop.
    await this.tearDownMcpLayer();
    await this.attachMcpLayer();
  }

  async stop(): Promise<void> {
    await this.tearDownMcpLayer();
    this.layers.clear();
    this.tokenByFingerprint.clear();
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

  private configForToken(token: string): HttpToolServerConfig {
    // The URL is shared across tokens; only the bearer header differs.
    return {
      url: this.config!.url,
      headers: { Authorization: `Bearer ${token}` },
    };
  }

  // Mint-or-reuse a token for a grant signature and ensure its scoped layer
  // exists. Dedup is by the same sorted-name fingerprint the Claude tier uses,
  // so identical grants share one token + layer.
  private ensureScopedToken(grantedToolIds: string[]): string {
    const fingerprint = scopedToolKey(this.getLoaded(), grantedToolIds);
    // Note: a non-empty grant that matches no real tools yields an empty
    // fingerprint and gets its own zero-tool layer — that is the *correct*
    // scoping (it must reach nothing), NOT a fold onto the all-tools default.
    // Only an absent/empty grant (handled in getConfig before reaching here)
    // maps to the default token.
    const existing = this.tokenByFingerprint.get(fingerprint);
    if (existing) {
      const layer = this.layers.get(existing);
      if (layer && !layer.transport) {
        // Known token whose layer was torn down by a rebuild — rebuild now.
        void this.buildLayer(layer);
      }
      return existing;
    }
    const token = crypto.randomUUID();
    const layer: ScopedLayer = { grant: grantedToolIds, transport: null, mcpServer: null };
    this.layers.set(token, layer);
    this.tokenByFingerprint.set(fingerprint, token);
    void this.buildLayer(layer);
    return token;
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

    // Re-seed the default layer + its fingerprint→token mapping here (not just in
    // the constructor) so a stop()→start() on the same instance — which clears
    // `layers` — leaves the default token resolvable again.
    this.layers.set(this.bearerToken, this.defaultLayer);
    this.tokenByFingerprint.set(scopedToolKey(this.getLoaded(), undefined), this.bearerToken);
    await this.buildLayer(this.defaultLayer);
  }

  // (Re)builds a layer's transport + scoped McpServer from its remembered grant.
  private async buildLayer(layer: ScopedLayer): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: no session id, no state held between requests.
      // Each tool call is an independent HTTP round-trip; this matches
      // the one-client-per-spawn usage pattern.
      sessionIdGenerator: undefined,
    });
    const scopedLoaded = getScopedTools(this.getLoaded(), layer.grant);
    const mcpServer = buildHttpMcpServer(scopedLoaded, this.ctxFactory);
    await mcpServer.connect(transport);
    layer.transport = transport;
    layer.mcpServer = mcpServer;
  }

  // Tears down every layer's MCP server (not the HTTP socket). Keeps the
  // registry entries so remembered grants survive a rebuild.
  private async tearDownMcpLayer(): Promise<void> {
    for (const layer of this.layers.values()) {
      if (layer.mcpServer) {
        await layer.mcpServer.close().catch(() => {});
        layer.mcpServer = null;
      }
      layer.transport = null;
    }
  }

  // Rebuilds every remembered layer so the next request is hot; the lazy
  // rebuild in handleHttpRequest is the backstop if one was missed.
  private async attachMcpLayer(): Promise<void> {
    for (const layer of this.layers.values()) {
      await this.buildLayer(layer);
    }
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Resolve the presented bearer token to its scoped layer (constant-time per
    // registered token) before delegating to that layer's MCP transport. The
    // matched layer determines which tools are reachable — enforcement is by
    // construction, since each layer only registered its own grant's tools.
    const layer = this.resolveLayer(req.headers['authorization']);
    if (!layer) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (!layer.transport) {
      // Backstop for a known token whose layer was torn down without the normal
      // eager rebuild (rebuild() repopulates all layers eagerly, so this is
      // rarely hit). buildLayer is async, so THIS request still 503s below and
      // the client retries; the kick just warms the layer for the next request.
      void this.buildLayer(layer);
    }
    if (!layer.transport) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not ready' }));
      return;
    }

    // Track only transport-bound requests (the ones tied to the MCP layers the
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

    void layer.transport.handleRequest(req, res);
  }

  // Returns the layer whose token the Authorization header presents, or null.
  // Iterates registered tokens and compares each in constant time: a length
  // check guards `timingSafeEqual` (which throws on length mismatch), and the
  // per-token comparison avoids leaking which token (if any) matched via timing.
  // The registry is small — one entry per distinct grant in active use.
  private resolveLayer(authHeader: string | string[] | undefined): ScopedLayer | null {
    if (typeof authHeader !== 'string') return null;
    const got = Buffer.from(authHeader);
    for (const [token, layer] of this.layers) {
      const expected = Buffer.from(`Bearer ${token}`);
      if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) {
        return layer;
      }
    }
    return null;
  }
}
