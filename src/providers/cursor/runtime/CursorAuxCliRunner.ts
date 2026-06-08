import { spawn } from 'child_process';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { getVaultPath } from '../../../utils/path';
import { getCursorEnabledModels } from '../settings';
import { buildCursorAgentEnvironment } from './cursorAgentEnv';
import { runWithCursorAgentSpawnLock } from './cursorAgentSpawnLock';
import { resolveCursorModelSelectionForCli } from './cursorCliModel';
import { resolveCursorCliPromptArg } from './cursorCliPrompt';
import { resolveCursorLaunch } from './cursorLaunch';
import { buildCursorAgentJsonModeFlagArgs } from './cursorLaunchArgs';
import { getCachedCursorModelIds } from './cursorModelCatalog';
import { forceKillCursorProcessTree } from './cursorProcessKill';

export type CursorAuxQueryConfig = AuxQueryConfig;

/** Grace period after SIGTERM before force-killing the aux process tree. */
const CURSOR_AUX_SIGKILL_TIMEOUT_MS = 3_000;

interface CursorJsonResult {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
}

export class CursorAuxCliRunner implements AuxQueryRunner {
  private sessionId: string | null = null;

  constructor(private readonly plugin: PluginContext) {}

  reset(): void {
    this.sessionId = null;
  }

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const cli = this.plugin.getResolvedProviderCliPath('cursor');
    if (!cli) {
      throw new Error('Cursor Agent CLI not found. Install the Cursor CLI and configure its path in settings.');
    }

    const workspaceDir = getVaultPath(this.plugin.app) ?? process.cwd();
    const model = this.resolveCliModel(config.model);

    // Aux queries (title generation, instruction refine, inline edit) are pure
    // text transforms. Pin a read-only posture so they never inherit the chat's
    // yolo/plan permissions or escalate to --force/--sandbox disabled.
    const flagArgs = buildCursorAgentJsonModeFlagArgs({
      workspaceDir,
      model,
      permissionMode: 'normal',
      readOnly: true,
      resumeSessionId: this.sessionId,
    });

    const fullPrompt = config.systemPrompt
      ? `${config.systemPrompt}\n\n${prompt}`
      : prompt;
    const { arg: promptArg, cleanup: cleanupPromptFile } = resolveCursorCliPromptArg(fullPrompt);

    const env = buildCursorAgentEnvironment(this.plugin);
    let result: { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null };
    try {
      result = await this.spawnOnce(
        cli,
        [...flagArgs, promptArg],
        { cwd: workspaceDir, env },
        config.abortController?.signal,
      );
    } finally {
      cleanupPromptFile?.();
    }
    const { stdout, stderr, code, signal } = result;

    if (signal === 'SIGTERM' || config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    if (code !== 0) {
      throw new Error(stderr.trim() || `Cursor Agent exited with code ${code}`);
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error('Empty response from Cursor Agent');
    }

    let parsed: CursorJsonResult;
    try {
      parsed = JSON.parse(trimmed) as CursorJsonResult;
    } catch {
      throw new Error('Failed to parse Cursor Agent JSON output');
    }

    if (typeof parsed.session_id === 'string' && parsed.session_id) {
      this.sessionId = parsed.session_id;
    }

    if (parsed.is_error === true) {
      throw new Error(parsed.result?.trim() || 'Cursor Agent reported an error');
    }

    const resultText = typeof parsed.result === 'string' ? parsed.result : '';
    // The CLI is one-shot (no streaming), so surface the final text once to
    // match the single end-of-turn progress callback of the prior service.
    config.onTextChunk?.(resultText);
    return resultText;
  }

  private resolveCliModel(modelOverride: string | undefined): string | undefined {
    const settingsBag = asSettingsBag(this.plugin.settings);
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      settingsBag,
      'cursor',
    );
    const familyValue = modelOverride?.trim()
      || (typeof providerSettings.model === 'string' && providerSettings.model.trim()
        ? providerSettings.model.trim()
        : undefined);
    const mode = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel
      : undefined;
    return resolveCursorModelSelectionForCli(familyValue, mode, {
      catalogIds: getCachedCursorModelIds(),
      enabledIds: getCursorEnabledModels(settingsBag),
    });
  }

  private async spawnOnce(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> },
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
    return runWithCursorAgentSpawnLock(async () => {
      return new Promise((resolve, reject) => {
        const launch = resolveCursorLaunch(command, args);
        const child = spawn(launch.command, launch.args, {
          cwd: options.cwd,
          env: launch.extraEnv ? { ...options.env, ...launch.extraEnv } : options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });

        let killTimer: number | null = null;
        const clearKillTimer = (): void => {
          if (killTimer !== null) {
            window.clearTimeout(killTimer);
            killTimer = null;
          }
        };

        const onAbort = (): void => {
          child.kill('SIGTERM');
          // Escalate if cursor-agent (or a descendant holding a pipe open)
          // ignores SIGTERM. On Windows this tree-kills via taskkill so an
          // aborted aux query can't orphan bash/git grandchildren.
          clearKillTimer();
          killTimer = window.setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              forceKillCursorProcessTree(child);
            }
          }, CURSOR_AUX_SIGKILL_TIMEOUT_MS);
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        child.on('error', (err) => {
          clearKillTimer();
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(err);
        });

        child.on('close', (code, killSignal) => {
          clearKillTimer();
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve({ stdout, stderr, code, signal: killSignal });
        });
      });
    });
  }
}
