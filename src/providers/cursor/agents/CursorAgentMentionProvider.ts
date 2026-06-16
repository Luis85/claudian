import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import { type CursorAgentStorage, loadCursorAgentsWithBuiltins } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

export class CursorAgentMentionProvider
  extends StorageBackedAgentMentionProvider<CursorAgentDefinition> {
  constructor(storage: CursorAgentStorage) {
    super(
      { loadAll: () => loadCursorAgentsWithBuiltins(storage) },
      () => true,
      // compat sources are not AgentMentionSources; those agents read as vault
      // entries (their description carries the origin suffix).
      (agent) => (agent.source === 'claude-compat' ? 'vault' : agent.source),
    );
  }
}
