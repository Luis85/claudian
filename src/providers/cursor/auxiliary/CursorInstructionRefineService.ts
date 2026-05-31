import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: PluginContext) {
    super(new CursorAuxCliRunner(plugin));
  }
}
