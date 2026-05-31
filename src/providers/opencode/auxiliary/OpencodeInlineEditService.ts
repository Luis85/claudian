import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { OpencodeAuxQueryRunner } from '../runtime/OpencodeAuxQueryRunner';

export class OpencodeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: PluginContext) {
    super(new OpencodeAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
