import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new CursorAuxCliRunner(plugin),
      resolveModel: () => plugin.settings.titleGenerationModel || undefined,
      parseTitle: parseCursorTitle,
    });
  }
}

function parseCursorTitle(responseText: string): string | null {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }

  let title = trimmed;
  if (
    (title.startsWith('"') && title.endsWith('"'))
    || (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  const oneLine = title.split('\n')[0]?.trim() ?? '';
  if (!oneLine) {
    return null;
  }
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}
