import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { ClaudeAuxQueryRunner } from '../runtime/ClaudeAuxQueryRunner';

export class InstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: PluginContext) {
    super(new ClaudeAuxQueryRunner(plugin, { tools: [] }));
  }
}
