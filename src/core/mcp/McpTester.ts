import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import * as http from 'http';
import * as https from 'https';
import type { LookupFunction } from 'net';

import { curateStdioMcpEnv } from '../../utils/env';
import { parseCommand } from '../../utils/mcp';
import type { HostResolver, VettedRemoteUrl } from '../security/urlSafety';
import { assertSafeRemoteUrl, createPinnedLookup } from '../security/urlSafety';
import type { ManagedMcpServer } from '../types';
import { getMcpServerType } from '../types';
import type { McpSecretResolver } from './mcpSecrets';
import { collectMissingMcpSecrets, resolveMcpServerConfig } from './mcpSecrets';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTestResult {
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  tools: McpTool[];
  error?: string;
}

interface UrlServerConfig {
  url: string;
  headers?: Record<string, string>;
}

type StreamableHttpTransportOptions = ConstructorParameters<typeof StreamableHTTPClientTransport>[1];
type LegacySseTransportConstructor = new (
  url: URL,
  options?: StreamableHttpTransportOptions,
) => Transport;

function createLegacySseTransport(url: URL, options: StreamableHttpTransportOptions): Transport {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy SSE MCP servers still need the SDK's deprecated compatibility transport.
  const module = require('@modelcontextprotocol/sdk/client/sse') as {
    SSEClientTransport: LegacySseTransportConstructor;
  };
  return new module.SSEClientTransport(url, options);
}

export interface NodeFetchOptions {
  /**
   * SECURITY (SEC-D): custom DNS lookup handed to `http(s).request` so the
   * socket dials only SSRF-vetted addresses (DNS-rebinding defense). Hostname,
   * Host header, and TLS SNI/cert validation are untouched — only address
   * resolution is constrained.
   */
  lookup?: LookupFunction;
}

/**
 * Use Node's HTTP stack for MCP server verification to avoid renderer CORS restrictions.
 * We still rely on official SDK transports for MCP protocol semantics.
 */
export function createNodeFetch(options?: NodeFetchOptions): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = getRequestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = mergeHeaders(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const body = await getRequestBody(init?.body ?? (input instanceof Request ? input.body : undefined));
    const transport = requestUrl.protocol === 'https:' ? https : http;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const onAbort = () => {
        req.destroy(new Error('Request aborted'));
        fail(signal?.reason ?? new Error('Request aborted'));
      };

      const requestHeaders: Record<string, string> = {};
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
      if (body) {
        requestHeaders['content-length'] = String(body.byteLength);
      }

      const req = transport.request(
        requestUrl,
        {
          method,
          headers: requestHeaders,
          lookup: options?.lookup,
        },
        (res: http.IncomingMessage) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(createFetchResponse(res) as Response);
        },
      );

      req.on('error', (error: Error) => fail(error));

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (body) {
        req.end(body);
      } else {
        req.end();
      }
    });
  };
}

interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function createFetchResponse(res: http.IncomingMessage): MinimalFetchResponse {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        responseHeaders.append(key, headerValue);
      }
    } else {
      responseHeaders.append(key, value);
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      res.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buffer));
      });
      res.on('end', () => controller.close());
      res.on('error', (error: Error) => controller.error(error));
    },
    cancel(reason?: unknown) {
      res.destroy(reason instanceof Error ? reason : new Error('Response body cancelled'));
    },
  });

  let bodyUsed = false;
  const readAsText = async (): Promise<string> => {
    if (bodyUsed) {
      throw new TypeError('Body has already been consumed');
    }
    bodyUsed = true;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  };

  return {
    ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
    status: res.statusCode ?? 500,
    statusText: res.statusMessage ?? '',
    headers: responseHeaders,
    body,
    text: readAsText,
    json: async () => {
      const parsed: unknown = JSON.parse(await readAsText());
      return parsed;
    },
  };
}

function getRequestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === 'string') {
    return new URL(input);
  }
  return new URL(input.url);
}

function mergeHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

async function getRequestBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }

  const serialized = await new Response(body).arrayBuffer();
  return Buffer.from(serialized);
}

export interface McpTestOptions {
  /** DNS seam for the SSRF guard; tests inject a fake resolver. */
  resolveHost?: HostResolver;
}

export async function testMcpServer(
  server: ManagedMcpServer,
  resolveSecret?: McpSecretResolver,
  options?: McpTestOptions,
): Promise<McpTestResult> {
  const type = getMcpServerType(server.config);
  // SEC-A Phase 3: verify against the resolved config (secret headers/env overlaid
  // from SecretStorage), so testing a server with migrated credentials still works.
  // A secret missing on this device (e.g. synced settings) is reported up front
  // rather than silently tested without the credential.
  if (resolveSecret) {
    const missing = collectMissingMcpSecrets([server], resolveSecret);
    if (missing.length > 0) {
      return {
        success: false,
        tools: [],
        error: `Secret not set on this device: ${missing
          .map((m) => m.name)
          .join(', ')}. Re-enter it in the server settings.`,
      };
    }
  }
  const resolvedConfig = resolveSecret ? resolveMcpServerConfig(server, resolveSecret) : server.config;

  let transport: Transport;
  try {
    if (type === 'stdio') {
      const config = resolvedConfig as { command: string; args?: string[]; env?: Record<string, string> };
      const { cmd, args } = parseCommand(config.command, config.args);
      if (!cmd) {
        return { success: false, tools: [], error: 'Missing command' };
      }
      transport = new StdioClientTransport({
        command: cmd,
        args,
        // SECURITY (SEC-4): MCP servers can be vault-defined/untrusted. Spawn them
        // with a curated env (system-essentials + the server's own configured vars)
        // rather than forwarding the host's full process.env.
        env: curateStdioMcpEnv(config.env),
        stderr: 'ignore',
      });
    } else {
      const config = resolvedConfig as UrlServerConfig;
      // SECURITY (SEC-D): SSRF guard for vault-suppliable URLs. Refuse
      // loopback/link-local/private/metadata targets BEFORE any socket opens,
      // then pin the transport's connections to the vetted addresses so a DNS
      // rebind between preflight and connect cannot redirect the socket.
      const vetted: VettedRemoteUrl = await assertSafeRemoteUrl(config.url, {
        resolveHost: options?.resolveHost,
      });
      const transportOptions = {
        fetch: createNodeFetch({
          lookup: createPinnedLookup(vetted, { resolveHost: options?.resolveHost }),
        }),
        requestInit: config.headers ? { headers: config.headers } : undefined,
      };
      transport = type === 'sse'
        ? createLegacySseTransport(vetted.url, transportOptions)
        : new StreamableHTTPClientTransport(vetted.url, transportOptions);
    }
  } catch (error) {
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : 'Invalid server configuration',
    };
  }

  const client = new Client({ name: 'claudian-tester', version: '1.0.0' });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    await client.connect(transport, { signal: controller.signal });

    const serverVersion = client.getServerVersion();
    let tools: McpTool[] = [];
    try {
      const result = await client.listTools(undefined, { signal: controller.signal });
      tools = result.tools.map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    } catch {
      // listTools failure after successful connect = partial success
    }

    return {
      success: true,
      serverName: serverVersion?.name,
      serverVersion: serverVersion?.version,
      tools,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { success: false, tools: [], error: 'Connection timeout (10s)' };
    }
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    window.clearTimeout(timeout);
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}
