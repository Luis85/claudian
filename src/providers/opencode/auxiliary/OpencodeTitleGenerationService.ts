import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { decodeOpencodeModelId } from '../models';
import { OpencodeAuxQueryRunner } from '../runtime/OpencodeAuxQueryRunner';
import { opencodeChatUIConfig } from '../ui/OpencodeChatUIConfig';

export class OpencodeTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PluginContext) {
    super({
      createRunner: () => new OpencodeAuxQueryRunner(plugin, {
        agentProfile: 'passive',
        artifactPurpose: 'title-gen',
      }),
      resolveModel: () => {
        const settings = asSettingsBag(plugin.settings);
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!opencodeChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeOpencodeModelId(titleModel) ?? undefined;
      },
    });
  }
}
