import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: PluginContext) {
    super(new CursorAuxCliRunner(plugin));
  }
}
