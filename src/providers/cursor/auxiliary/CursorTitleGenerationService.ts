import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import { stripSurroundingQuotes } from '../../../core/prompt/titleGeneration';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PluginContext) {
    super({
      createRunner: () => new CursorAuxCliRunner(plugin),
      resolveModel: () => plugin.settings.titleGenerationModel || undefined,
      parseTitle: parseCursorTitle,
    });
  }
}

function parseCursorTitle(responseText: string): string | null {
  const title = stripSurroundingQuotes(responseText);
  const oneLine = title.split('\n')[0]?.trim() ?? '';
  if (!oneLine) {
    return null;
  }
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}
