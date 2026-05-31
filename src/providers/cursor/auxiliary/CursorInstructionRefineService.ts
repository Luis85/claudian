import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { CursorAuxCliRunner } from '../runtime/CursorAuxCliRunner';

export class CursorInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new CursorAuxCliRunner(plugin));
  }
}
