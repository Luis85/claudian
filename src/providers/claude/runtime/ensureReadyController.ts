/**
 * Pure orchestration for {@link ClaudeChatRuntime.ensureReady}, extracted to
 * keep the grandfathered runtime module shrinking. The runtime owns the actual
 * subprocess lifecycle and private state; this module only sequences the
 * start/close decisions through a narrow dependency surface so the branching
 * (not-running / forced / config-changed / unchanged) lives in one place.
 *
 * Behaviour mirrors the original inline logic exactly:
 * - close happens BEFORE the post-close CLI re-check, so a CLI that vanished
 *   during close still leaves the query closed (cold-start fallback);
 * - `vaultPath`/`cliPath` are re-resolved after close for the config-changed
 *   case, since either may change while the previous query tears down.
 */
export interface EnsureReadyDeps {
  getVaultPath(): string | null;
  getCliPath(): string | null;
  isRunning(): boolean;
  start(vaultPath: string, cliPath: string): Promise<void>;
  close(reason: string): void;
  /** True when the live config differs from the config built for these paths. */
  needsRestart(vaultPath: string, cliPath: string): boolean;
}

/**
 * The runtime capabilities {@link createEnsureReadyDeps} binds into an
 * {@link EnsureReadyDeps}. Keeping the option-driven resolution here lets the
 * runtime's `ensureReady` stay a thin delegate.
 */
export interface EnsureReadyRuntime {
  getVaultPath(): string | null;
  getCliPath(): string | null;
  isRunning(): boolean;
  startPersistentQuery(
    vaultPath: string,
    cliPath: string,
    sessionId: string | undefined,
    externalContextPaths: string[],
  ): Promise<void>;
  closePersistentQuery(reason: string, preserveHandlers: boolean | undefined): void;
  needsRestartForConfig(vaultPath: string, cliPath: string, externalContextPaths: string[]): boolean;
}

export interface EnsureReadyResolvedOptions {
  sessionId: string | undefined;
  externalContextPaths: string[];
  preserveHandlers: boolean | undefined;
}

/** Binds runtime callbacks + resolved per-call options into the decision deps. */
export function createEnsureReadyDeps(
  runtime: EnsureReadyRuntime,
  options: EnsureReadyResolvedOptions,
): EnsureReadyDeps {
  return {
    getVaultPath: () => runtime.getVaultPath(),
    getCliPath: () => runtime.getCliPath(),
    isRunning: () => runtime.isRunning(),
    start: (vaultPath, cliPath) =>
      runtime.startPersistentQuery(vaultPath, cliPath, options.sessionId, options.externalContextPaths),
    close: (reason) => runtime.closePersistentQuery(reason, options.preserveHandlers),
    needsRestart: (vaultPath, cliPath) =>
      runtime.needsRestartForConfig(vaultPath, cliPath, options.externalContextPaths),
  };
}

/**
 * Resolves both paths needed to (re)start the query, returning null when either
 * is unavailable so callers can short-circuit identically to the inline guards.
 */
function resolvePaths(deps: EnsureReadyDeps): { vaultPath: string; cliPath: string } | null {
  const vaultPath = deps.getVaultPath();
  if (!vaultPath) return null;
  const cliPath = deps.getCliPath();
  if (!cliPath) return null;
  return { vaultPath, cliPath };
}

/** Starts a fresh query when paths are available; returns whether it started. */
async function startIfPossible(deps: EnsureReadyDeps): Promise<boolean> {
  const paths = resolvePaths(deps);
  if (!paths) return false;
  await deps.start(paths.vaultPath, paths.cliPath);
  return true;
}

/**
 * Handles the config-changed case: close first, then re-resolve and start only
 * if the CLI is still available afterwards.
 */
async function restartForConfigChange(deps: EnsureReadyDeps): Promise<boolean> {
  deps.close('config changed');
  return startIfPossible(deps);
}

export async function runEnsureReady(deps: EnsureReadyDeps, force: boolean): Promise<boolean> {
  // Case 1: Not running → try to start.
  if (!deps.isRunning()) {
    return startIfPossible(deps);
  }

  // Case 2: Forced restart (session switch, crash recovery). Close FIRST, then
  // try to start so a now-unavailable CLI falls back to cold-start.
  if (force) {
    deps.close('forced restart');
    return startIfPossible(deps);
  }

  // Case 3: Restart only when the effective config changed for current paths.
  const paths = resolvePaths(deps);
  if (!paths) return false;
  if (deps.needsRestart(paths.vaultPath, paths.cliPath)) {
    return restartForConfigChange(deps);
  }

  // Case 4: Running and config unchanged → no-op.
  return false;
}
