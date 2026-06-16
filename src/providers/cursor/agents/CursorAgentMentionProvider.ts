import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import type { CursorAgentStorage } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

export class CursorAgentMentionProvider
  extends StorageBackedAgentMentionProvider<CursorAgentDefinition> {
  constructor(storage: CursorAgentStorage) {
    super(
      { loadAll: () => storage.loadAll() },
      // @mentions only offer agents Cursor actually loads and can delegate to by
      // name: .cursor/agents (vault) + ~/.cursor/agents (global). Built-ins are
      // automatic; compat (.claude/.codex) agents live in roots Cursor doesn't
      // load and we send only the name (not the body) — so neither can be
      // delegated. Both still appear read-only in settings.
      (agent) => agent.source === 'vault' || agent.source === 'global',
      (agent) => (agent.source === 'global' ? 'global' : 'vault'),
    );
  }
}
