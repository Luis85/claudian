import { Notice, type TFile } from 'obsidian';

import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { chatMessageText } from '../../../utils/chatMessageText';
import {
  buildConversationSeed,
  buildMessageSeed,
  createWorkOrderFromSeed,
} from '../commands/taskCommands';

export class ChatWorkOrderLinker {
  constructor(private readonly plugin: SpecoratorPlugin) {}

  async promoteMessageToWorkOrder(message: ChatMessage, conversationId: string | null): Promise<TFile | null> {
    const messageContent = chatMessageText(message);
    if (!messageContent) {
      new Notice(t('tasks.fromChat.nothingToCapture'));
      return null;
    }
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildMessageSeed({
        messageContent,
        currentNote: message.currentNote ?? null,
        conversationId,
      }),
    );
    if (created) new Notice(t('tasks.fromChat.createdFromMessage'));
    return created;
  }

  async promoteActiveConversationToWorkOrder(): Promise<TFile | null> {
    const snapshot = this.plugin.getActiveConversationSnapshot();
    if (!snapshot) {
      new Notice(t('tasks.fromChat.noActiveChat'));
      return null;
    }
    const created = await createWorkOrderFromSeed(
      this.plugin,
      buildConversationSeed({ conversationId: snapshot.id, conversationTitle: snapshot.title }),
    );
    if (created) new Notice(t('tasks.fromChat.createdFromConversation'));
    return created;
  }
}
