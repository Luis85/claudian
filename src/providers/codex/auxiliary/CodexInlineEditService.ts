import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CodexAuxQueryRunner } from '../runtime/CodexAuxQueryRunner';

export class CodexInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: PluginContext) {
    super(new CodexAuxQueryRunner(plugin));
  }
}
