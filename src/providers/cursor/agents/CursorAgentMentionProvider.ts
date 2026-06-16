import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import type { CursorAgentStorage } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

export class CursorAgentMentionProvider
  extends StorageBackedAgentMentionProvider<CursorAgentDefinition> {
  constructor(storage: CursorAgentStorage) {
    super(
      // Built-ins (Explore/Bash/Browser) are automatic — Cursor does not allow
      // manual invocation — so they stay read-only in settings but out of the
      // @mention menu. Only writable + compat file agents are mentionable.
      { loadAll: () => storage.loadAll() },
      () => true,
      // compat sources are not AgentMentionSources; those agents read as vault
      // entries (their description carries the origin suffix).
      (agent) => (agent.source === 'claude-compat' || agent.source === 'codex-compat'
        ? 'vault'
        : agent.source),
    );
  }
}
