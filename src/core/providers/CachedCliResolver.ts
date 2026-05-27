import { getHostnameKey } from '../../utils/env';
import type { HostnameCliPaths } from '../types/settings';
import { getRuntimeEnvironmentText } from './providerEnvironment';
import type { ProviderCliResolver, ProviderId } from './types';

export interface CliResolutionInput<E> {
  hostnamePath: string;
  legacyPath: string;
  envText: string;
  extra: E;
}

/**
 * Per-provider variation behind the cached-resolution seam. The deep module owns
 * hostname selection, environment-text assembly, memoization, and reset; a spec
 * supplies only how to read the provider's settings and how to resolve a path.
 */
export interface CliResolutionSpec<E = undefined> {
  providerId: ProviderId;
  read(settings: Record<string, unknown>): {
    cliPath: string;
    cliPathsByHost: HostnameCliPaths;
    extra: E;
  };
  resolve(input: CliResolutionInput<E>): string | null;
  /** Contributes provider-specific facts (e.g. Codex installation method) to the cache key. */
  cacheKeyForExtra?(extra: E): string;
}

/**
 * Memoizing CLI resolver shared by every provider. Caches the resolved path —
 * including a `null` (not-found) result — and re-resolves only when a cache-key
 * input changes or `reset()` is called.
 */
export class CachedCliResolver<E = undefined> implements ProviderCliResolver {
  private readonly hostname = getHostnameKey();
  private resolvedPath: string | null = null;
  private lastKey: string | null = null;

  constructor(private readonly spec: CliResolutionSpec<E>) {}

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const { cliPath, cliPathsByHost, extra } = this.spec.read(settings);
    const hostnamePath = (cliPathsByHost[this.hostname] ?? '').trim();
    const legacyPath = cliPath.trim();
    const envText = getRuntimeEnvironmentText(settings, this.spec.providerId);
    const extraKey = this.spec.cacheKeyForExtra?.(extra) ?? '';
    const key = JSON.stringify([hostnamePath, legacyPath, envText, extraKey]);

    if (this.lastKey === key) {
      return this.resolvedPath;
    }

    this.lastKey = key;
    this.resolvedPath = this.spec.resolve({ hostnamePath, legacyPath, envText, extra });
    return this.resolvedPath;
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastKey = null;
  }
}
