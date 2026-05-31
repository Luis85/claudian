import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { OpencodeAuxQueryRunner } from '../runtime/OpencodeAuxQueryRunner';

export class OpencodeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: PluginContext) {
    super(new OpencodeAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
