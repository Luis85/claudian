import { Notice, type TFile } from 'obsidian';

import type { ChatMessage } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import {
  buildConversationSeed,
  buildMessageSeed,
  createWorkOrderFromSeed,
} from '../commands/taskCommands';

export class ChatWorkOrderLinker {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async promoteMessageToWorkOrder(message: ChatMessage, conversationId: string | null): Promise<TFile | null> {
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildMessageSeed({
        messageContent: message.content,
        currentNote: message.currentNote ?? null,
        conversationId,
      }),
    );
    if (created) new Notice('Work order created from chat message.');
    return created;
  }

  async promoteActiveConversationToWorkOrder(): Promise<TFile | null> {
    const snapshot = this.plugin.getActiveConversationSnapshot();
    if (!snapshot) {
      new Notice('Open a chat conversation first.');
      return null;
    }
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildConversationSeed({ conversationId: snapshot.id, conversationTitle: snapshot.title }),
    );
    if (created) new Notice('Work order created from chat conversation.');
    return created;
  }
}
