import { buildAllowlistedSubprocessEnvironment } from '../../../core/providers/subprocessEnvironmentAllowlist';
import { getEnhancedPath } from '../../../utils/env';

/**
 * Builds the Opencode subprocess env from the caller-provided RESOLVED env
 * (SEC-A: secrets overlaid from SecretStorage), not the plaintext blob — so
 * migrated credentials (e.g. ANTHROPIC_API_KEY, OPENCODE_*_TOKEN) still reach
 * the launched process.
 */
export function buildOpencodeRuntimeEnv(
  resolvedEnv: Record<string, string>,
  cliPath: string,
  databasePathOverride?: string | null,
): NodeJS.ProcessEnv {
  const opencodeExtras: Record<string, string> = {
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
    ...(databasePathOverride ? { OPENCODE_DB: databasePathOverride } : {}),
  };
  return buildAllowlistedSubprocessEnvironment({
    processEnv: process.env,
    customEnv: { ...resolvedEnv, ...opencodeExtras },
    providerPrefixPattern: /^OPENCODE_/i,
    pathOverride: getEnhancedPath(resolvedEnv.PATH, cliPath || undefined),
  });
}
