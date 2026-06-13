export type CursorPermissionMode = 'yolo' | 'plan' | 'normal';

/** Cursor CLI sandbox is macOS/Linux only; Windows uses allowlist mode (`disabled`). */
export function resolveCursorSandboxMode(
  platform: NodeJS.Platform = process.platform,
): 'enabled' | 'disabled' {
  return platform === 'win32' ? 'disabled' : 'enabled';
}

export interface BuildCursorAgentFlagArgsOptions {
  workspaceDir: string;
  model?: string | null;
  permissionMode: CursorPermissionMode;
  resumeSessionId?: string | null;
  approveMcps?: boolean;
  /**
   * Pins a read-only posture (Cursor `ask` mode + engaged sandbox) and ignores
   * `permissionMode`. Set for auxiliary one-shot queries that must never write.
   */
  readOnly?: boolean;
  /** Override for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

/**
 * Builds the leading flags common to every Cursor invocation shape: print mode,
 * the output format, any format-specific flags (e.g. `--stream-partial-output`),
 * the workspace directory, and `--trust`. Permission and tail flags are appended
 * by the per-shape builders.
 */
function buildCursorBaseArgs(
  outputFormat: 'stream-json' | 'json' | 'text',
  workspaceDir: string,
  extraFlags: string[] = [],
): string[] {
  return [
    '-p',
    '--output-format', outputFormat,
    ...extraFlags,
    '--workspace', workspaceDir,
    '--trust',
  ];
}

/**
 * Appends the flags shared by every Cursor invocation shape after the
 * base/permission flags: model selection, session resume, and (unless
 * `includeApproveMcps` is false, as the text-mode variant requires) MCP
 * approval.
 */
function appendCursorCommonTailArgs(
  args: string[],
  options: BuildCursorAgentFlagArgsOptions,
  includeApproveMcps = true,
): void {
  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  if (includeApproveMcps && options.approveMcps) {
    args.push('--approve-mcps');
  }
}

export function buildCursorAgentFlagArgs(options: BuildCursorAgentFlagArgsOptions): string[] {
  const args = buildCursorBaseArgs('stream-json', options.workspaceDir, ['--stream-partial-output']);

  appendCursorPermissionModeArgs(args, options.permissionMode, options.platform);
  appendCursorCommonTailArgs(args, options);

  return args;
}

function appendCursorPermissionModeArgs(
  args: string[],
  permissionMode: CursorPermissionMode,
  platform: NodeJS.Platform = process.platform,
): void {
  const sandbox = resolveCursorSandboxMode(platform);
  if (permissionMode === 'yolo') {
    args.push('--force', '--sandbox', 'disabled');
  } else if (permissionMode === 'plan') {
    args.push('--mode', 'plan', '--sandbox', sandbox);
  } else {
    args.push('--sandbox', sandbox);
  }
}

/**
 * Forces a read-only posture regardless of the chat permission mode: Cursor's
 * `ask` mode is read-only, and we keep the OS sandbox engaged (allowlist on
 * Windows). This deliberately ignores `yolo`/`plan` so that auxiliary text
 * transforms (title generation, instruction refine, inline edit) can never
 * escalate to `--force`/`--sandbox disabled`. Mirrors Codex's aux runner,
 * which pins `sandbox: 'read-only'` + `approvalPolicy: 'never'`.
 */
function appendCursorReadOnlyModeArgs(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): void {
  args.push('--mode', 'ask', '--sandbox', resolveCursorSandboxMode(platform));
}

export function buildCursorAgentJsonModeFlagArgs(
  options: BuildCursorAgentFlagArgsOptions,
): string[] {
  const args = buildCursorBaseArgs('json', options.workspaceDir);

  if (options.readOnly) {
    appendCursorReadOnlyModeArgs(args, options.platform);
  } else {
    appendCursorPermissionModeArgs(args, options.permissionMode, options.platform);
  }

  appendCursorCommonTailArgs(args, options);

  return args;
}

export function buildCursorAgentTextModeFlagArgs(
  options: Omit<BuildCursorAgentFlagArgsOptions, never>,
): string[] {
  const args = buildCursorBaseArgs('text', options.workspaceDir);

  appendCursorPermissionModeArgs(args, options.permissionMode, options.platform);
  appendCursorCommonTailArgs(args, options, false);

  return args;
}
