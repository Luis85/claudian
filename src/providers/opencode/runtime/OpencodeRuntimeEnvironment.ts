import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { buildAllowlistedSubprocessEnvironment } from '../../../core/providers/subprocessEnvironmentAllowlist';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

export function buildOpencodeRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
  databasePathOverride?: string | null,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'opencode');
  const customEnv = parseEnvironmentVariables(envText);
  const opencodeExtras: Record<string, string> = {
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
    ...(databasePathOverride ? { OPENCODE_DB: databasePathOverride } : {}),
  };
  return buildAllowlistedSubprocessEnvironment({
    processEnv: process.env,
    customEnv: { ...customEnv, ...opencodeExtras },
    providerPrefixPattern: /^OPENCODE_/i,
    pathOverride: getEnhancedPath(customEnv.PATH, cliPath || undefined),
  });
}
