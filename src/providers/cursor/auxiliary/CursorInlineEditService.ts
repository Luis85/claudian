import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new CursorAuxCliRunner(plugin));
  }
}
