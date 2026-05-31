import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CodexAuxQueryRunner } from '../runtime/CodexAuxQueryRunner';

export class CodexInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: PluginContext) {
    super(new CodexAuxQueryRunner(plugin));
  }
}
