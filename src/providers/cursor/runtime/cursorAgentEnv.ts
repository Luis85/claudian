import { buildAllowlistedSubprocessEnvironment } from '../../../core/providers/subprocessEnvironmentAllowlist';
import type { PluginContext } from '../../../core/types/PluginContext';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

export function buildCursorAgentEnvironment(plugin: PluginContext): Record<string, string> {
  const customEnv = parseEnvironmentVariables(plugin.getActiveEnvironmentVariables('cursor'));
  return buildAllowlistedSubprocessEnvironment({
    processEnv: process.env,
    customEnv,
    providerPrefixPattern: /^CURSOR_/i,
    pathOverride: getEnhancedPath(customEnv.PATH),
  });
}
