import { JsonRpcStdioClient } from '../../../core/transport/JsonRpcStdioClient';
import type { CodexAppServerProcess } from './CodexAppServerProcess';

const DEFAULT_TIMEOUT_MS = 30_000;

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (requestId: string | number, params: unknown) => Promise<unknown>;

/**
 * Codex `app-server` JSON-RPC transport. A thin adapter over the shared
 * `core/transport/JsonRpcStdioClient` (ADR-0001 Move 2): it bridges the Codex
 * subprocess (`stdout`/`stdin` + `onExit`) to the client's stream abstraction and
 * keeps Codex's API, including server-request handlers that receive the request
 * id (`(requestId, params)`).
 */
export class CodexRpcTransport {
  private client: JsonRpcStdioClient | null = null;
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly notificationUnsubs = new Map<string, () => void>();
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>();

  constructor(private readonly proc: CodexAppServerProcess) {}

  start(): void {
    if (this.client) {
      return;
    }

    const client = new JsonRpcStdioClient({
      input: this.proc.stdout,
      output: this.proc.stdin,
      onClose: (listener) => {
        const handler = (): void => listener(new Error('App-server process exited'));
        this.proc.onExit(handler);
        return () => this.proc.offExit(handler);
      },
    });

    for (const [method, handler] of this.notificationHandlers) {
      this.notificationUnsubs.set(method, client.onNotification(method, handler));
    }
    for (const [method, handler] of this.serverRequestHandlers) {
      client.onRequest(method, (params, id) => handler(id as string | number, params));
    }

    this.client = client;
    client.start();
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    this.start();
    return this.requireClient().request<T>(method, params, { timeoutMs });
  }

  notify(method: string, params?: unknown): void {
    this.start();
    this.requireClient().notify(method, params);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    // Codex has one handler per method (the original used a replacing Map); the
    // shared client's notification map is a Set, so drop the previous registration
    // before adding the new one — otherwise re-wiring per turn (CodexChatRuntime
    // rebuilds its router each turn) would leak stale handlers onto a long-lived
    // transport and double-dispatch notifications.
    this.notificationHandlers.set(method, handler);
    if (this.client) {
      this.notificationUnsubs.get(method)?.();
      this.notificationUnsubs.set(method, this.client.onNotification(method, handler));
    }
  }

  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
    this.client?.onRequest(method, (params, id) => handler(id as string | number, params));
  }

  dispose(): void {
    this.client?.dispose();
  }

  private requireClient(): JsonRpcStdioClient {
    if (!this.client) {
      throw new Error('Transport not started');
    }
    return this.client;
  }
}
