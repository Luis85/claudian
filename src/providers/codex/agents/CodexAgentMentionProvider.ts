import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import type { CodexSubagentStorage } from '../storage/CodexSubagentStorage';
import type { CodexSubagentDefinition } from '../types/subagent';

export class CodexAgentMentionProvider
  extends StorageBackedAgentMentionProvider<CodexSubagentDefinition> {
  constructor(storage: CodexSubagentStorage) {
    super(storage);
  }
}
