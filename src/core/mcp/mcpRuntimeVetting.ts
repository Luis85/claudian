/**
 * SECURITY (SEC-D): runtime-activation SSRF vet for URL-based MCP servers.
 *
 * The settings "Test" button vets URLs strictly, but chat turns hand active
 * server configs to provider CLIs that open their own connections. This vet
 * runs before any config leaves the plugin: unsafe servers are dropped (fail
 * closed, including DNS failure) instead of failing the turn. Loopback is
 * allowed here — localhost MCP servers are a supported dev workflow and were
 * working before the guard existed; the strict no-loopback policy stays on
 * the Test path.
 */
import type { HostResolver } from '../security/urlSafety';
import { assertSafeRemoteUrl } from '../security/urlSafety';

export interface DroppedMcpServer {
  name: string;
  reason: string;
}

export interface RuntimeMcpVetResult<T> {
  safe: Record<string, T>;
  dropped: DroppedMcpServer[];
}

/** Vet only configs that actually dial a URL; stdio/in-process shapes pass through. */
function getServerUrl(config: unknown): string | null {
  if (typeof config !== 'object' || config === null) return null;
  const url = (config as { url?: unknown }).url;
  return typeof url === 'string' ? url : null;
}

export async function vetActiveServersForRuntime<T>(
  servers: Record<string, T>,
  options?: { resolveHost?: HostResolver },
): Promise<RuntimeMcpVetResult<T>> {
  const safe: Record<string, T> = {};
  const dropped: DroppedMcpServer[] = [];

  for (const [name, config] of Object.entries(servers)) {
    const url = getServerUrl(config);
    if (url === null) {
      safe[name] = config;
      continue;
    }
    try {
      await assertSafeRemoteUrl(url, {
        allowLoopback: true,
        resolveHost: options?.resolveHost,
      });
      safe[name] = config;
    } catch (error) {
      dropped.push({
        name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { safe, dropped };
}
