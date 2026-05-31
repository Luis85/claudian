import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { CodexAuxQueryRunner } from '../runtime/CodexAuxQueryRunner';
import { codexChatUIConfig } from '../ui/CodexChatUIConfig';

export class CodexTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PluginContext) {
    super({
      createRunner: () => new CodexAuxQueryRunner(plugin),
      resolveModel: () => {
        const settings = asSettingsBag(plugin.settings);
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        return codexChatUIConfig.ownsModel(titleModel, settings)
          ? titleModel
          : undefined;
      },
    });
  }
}
