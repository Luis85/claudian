import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { ClaudeAuxQueryRunner } from '../runtime/ClaudeAuxQueryRunner';

export class InstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new ClaudeAuxQueryRunner(plugin, { tools: [] }));
  }
}
