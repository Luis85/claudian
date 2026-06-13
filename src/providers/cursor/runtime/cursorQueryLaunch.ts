/**
 * Non-streaming launch setup for {@link CursorChatRuntime.query}, extracted so
 * the async generator keeps only its yield orchestration. These helpers build
 * the spawn arguments / environment / prompt file and wait on child exit; they
 * perform no yielding and mutate no runtime state, which keeps `query` itself at
 * a low cognitive complexity while preserving the exact CLI invocation.
 */
import type { spawn } from 'child_process';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions, PreparedChatTurn } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { getVaultPath } from '../../../utils/path';
import { getCursorEnabledModels } from '../settings';
import { buildCursorAgentEnvironment } from './cursorAgentEnv';
import { resolveCursorModelSelectionForCli } from './cursorCliModel';
import { buildCursorAgentPrompt, resolveCursorCliPromptArg } from './cursorCliPrompt';
import { resolveCursorLaunch } from './cursorLaunch';
import { buildCursorAgentFlagArgs, type CursorPermissionMode } from './cursorLaunchArgs';
import { getCachedCursorModelIds } from './cursorModelCatalog';

export interface CursorQueryLaunchPlan {
  workspaceDir: string;
  launch: ReturnType<typeof resolveCursorLaunch>;
  env: NodeJS.ProcessEnv;
  isPlanTurn: boolean;
  cleanupPromptFile?: () => void;
}

/**
 * Resolves the model selection, flag args, environment, and prompt file used to
 * spawn `cursor-agent` for this turn. Mirrors the original inline sequence
 * exactly, including the workspace-dir fallback to `process.cwd()`.
 */
export function resolveCursorQueryLaunch(params: {
  plugin: PluginContext;
  cli: string;
  turn: PreparedChatTurn;
  conversationHistory?: ChatMessage[];
  queryOptions?: ChatRuntimeQueryOptions;
  resumeId: string | null;
}): CursorQueryLaunchPlan {
  const { plugin, cli, turn, conversationHistory, queryOptions, resumeId } = params;

  const workspaceDir = getVaultPath(plugin.app) ?? process.cwd();
  const permissionMode = plugin.settings.permissionMode as CursorPermissionMode;
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
    asSettingsBag(plugin.settings),
    'cursor',
  );
  const familyValue = queryOptions?.model
    ?? (typeof snapshot.model === 'string' && snapshot.model.trim() ? snapshot.model.trim() : undefined);
  const mode = typeof snapshot.effortLevel === 'string' ? snapshot.effortLevel : undefined;
  const settingsBag = asSettingsBag(plugin.settings);
  const model = resolveCursorModelSelectionForCli(familyValue, mode, {
    catalogIds: getCachedCursorModelIds(),
    enabledIds: getCursorEnabledModels(settingsBag),
  });

  const flagArgs = buildCursorAgentFlagArgs({
    workspaceDir,
    model,
    permissionMode,
    resumeSessionId: resumeId,
    approveMcps: (turn.request.enabledMcpServers?.size ?? 0) > 0,
  });

  const env = buildCursorAgentEnvironment(plugin);
  const isPlanTurn = permissionMode === 'plan';
  const cliPrompt = buildCursorAgentPrompt({
    turn,
    conversationHistory,
    resumeSessionId: resumeId,
  });
  const { arg: promptArg, cleanup: cleanupPromptFile } = resolveCursorCliPromptArg(cliPrompt);
  const launch = resolveCursorLaunch(cli, [...flagArgs, promptArg]);

  return { workspaceDir, launch, env, isPlanTurn, cleanupPromptFile };
}

type ChildProcess = ReturnType<typeof spawn>;

export interface SpawnedCursorChild {
  child: ChildProcess;
  /** True once the child emitted a spawn `error` (ENOENT/EINVAL/EPERM). */
  hadSpawnError(): boolean;
  /** Accumulated stderr plus the spawn error message, if any. */
  stderrText(): string;
}

/**
 * Spawns the `cursor-agent` child and attaches the spawn-error / stderr capture
 * listeners. Returned accessors defer reading the mutable spawn state so the
 * caller observes the final values after the stream drains.
 */
export function spawnCursorChild(
  spawnFn: typeof spawn,
  launch: ReturnType<typeof resolveCursorLaunch>,
  env: NodeJS.ProcessEnv,
  workspaceDir: string,
): SpawnedCursorChild {
  const child = spawnFn(launch.command, launch.args, {
    cwd: workspaceDir,
    env: launch.extraEnv ? { ...env, ...launch.extraEnv } : env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });

  // A failed spawn (ENOENT/EINVAL/EPERM) emits 'error' and may never emit
  // 'close'. Capture it so awaitCursorExitCode can resolve instead of hanging
  // the turn forever, and surface the reason as the stderr text.
  let spawnError: Error | null = null;
  child.on('error', (err: Error) => {
    spawnError = err;
  });
  let stderrAcc = '';
  child.stderr?.on('data', (d: Buffer) => {
    stderrAcc += d.toString('utf8');
  });

  return {
    child,
    hadSpawnError: () => spawnError !== null,
    stderrText: () => buildCursorStderrText(stderrAcc, spawnError),
  };
}

/**
 * Awaits the child's exit code. A failed spawn (ENOENT/EINVAL/EPERM) may emit
 * `error` without ever emitting `close`, so `spawnErrored`/an already-set
 * `exitCode` short-circuits to avoid hanging the turn forever.
 */
export function awaitCursorExitCode(
  child: ChildProcess,
  spawnErrored: () => boolean,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (spawnErrored() || child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(child.exitCode));
  });
}

/** Appends the spawn error message (if any) to accumulated stderr. */
export function buildCursorStderrText(stderrAcc: string, spawnError: Error | null): string {
  return spawnError
    ? `${stderrAcc}${stderrAcc ? '\n' : ''}${spawnError.message}`.trim()
    : stderrAcc;
}
