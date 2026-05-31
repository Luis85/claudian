import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type { TitleGenerationResult } from '../../../core/providers/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { parseEnvironmentVariables } from '../../../utils/env';
import { ClaudeAuxQueryRunner } from '../runtime/ClaudeAuxQueryRunner';
import { claudeChatUIConfig } from '../ui/ClaudeChatUIConfig';

export type { TitleGenerationResult };

export class TitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PluginContext) {
    super({
      createRunner: () => new ClaudeAuxQueryRunner(plugin, {
        disableThinking: true,
        persistSession: false,
        resolveModel: () => resolveTitleModel(plugin),
        tools: [],
      }),
    });
  }
}

function resolveTitleModel(plugin: PluginContext): string {
  const envVars = parseEnvironmentVariables(
    plugin.getActiveEnvironmentVariables('claude'),
  );
  const titleModel = plugin.settings.titleGenerationModel;
  if (titleModel && claudeChatUIConfig.ownsModel(
    titleModel,
    plugin.settings as unknown as Record<string, unknown>,
  )) {
    return titleModel;
  }

  return envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-haiku-4-5';
}
