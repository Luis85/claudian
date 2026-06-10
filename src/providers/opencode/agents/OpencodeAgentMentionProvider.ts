import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import type { OpencodeAgentStorage } from '../storage/OpencodeAgentStorage';
import type { OpencodeAgentDefinition } from '../types/agent';

export class OpencodeAgentMentionProvider
  extends StorageBackedAgentMentionProvider<OpencodeAgentDefinition> {
  constructor(storage: OpencodeAgentStorage) {
    super(storage, isMentionableSubagent);
  }
}

function isMentionableSubagent(agent: OpencodeAgentDefinition): boolean {
  if (agent.hidden || agent.disable) {
    return false;
  }

  return agent.mode === 'subagent';
}
