import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isValidCursorSessionId } from '../../../core/providers/cursorSessionIdValidation';
import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getCursorState, resolveCursorSessionId } from '../types';
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
  loadCursorChatMessagesFromStoreResult,
  resolveCursorStoreDbPath,
} from './cursorHistoryStore';

export class CursorConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedConversationKeys = new Map<string, string>();
  private historyLoadErrors = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<void> {
    const sessionId = resolveCursorSessionId(conversation);
    if (!sessionId || !vaultPath) {
      this.hydratedConversationKeys.delete(conversation.id);
      return;
    }

    const dbPath = resolveCursorStoreDbPath(vaultPath, sessionId);
    if (!dbPath) {
      this.hydratedConversationKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${sessionId}::${dbPath}`;
    if (
      conversation.messages.length > 0
      && this.hydratedConversationKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const result = loadCursorChatMessagesFromStoreResult(dbPath);
    if (result.error) {
      this.historyLoadErrors.set(conversation.id, result.error);
    } else {
      this.historyLoadErrors.delete(conversation.id);
    }
    const loaded = result.messages;
    if (loaded.length === 0) {
      this.hydratedConversationKeys.delete(conversation.id);
      return;
    }

    conversation.messages = loaded;
    this.hydratedConversationKeys.set(conversation.id, hydrationKey);
  }

  getLastHistoryLoadError(conversationId: string): string | undefined {
    return this.historyLoadErrors.get(conversationId);
  }

  async deleteConversationSession(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<void> {
    const sessionId = resolveCursorSessionId(conversation);
    if (!sessionId || !vaultPath) {
      return;
    }
    if (!isValidCursorSessionId(sessionId)) {
      return;
    }

    // Mirror resolveCursorStoreDbPath's two-hash fallback: hydration can
    // surface conversations keyed under either the normalized hash or the
    // legacy (pre-normalization) hash. Deleting only the normalized path
    // would leave the legacy-hash transcript on disk.
    const chatsRoot = path.join(os.homedir(), '.cursor', 'chats');
    const candidateHashes = [
      cursorWorkspaceHash(vaultPath),
      cursorWorkspaceHashLegacy(vaultPath),
    ];
    const seenDirs = new Set<string>();
    for (const hash of candidateHashes) {
      const chatDir = path.join(chatsRoot, hash, sessionId);
      if (!chatDir.startsWith(chatsRoot)) continue;
      if (seenDirs.has(chatDir)) continue;
      seenDirs.add(chatDir);
      try {
        fs.rmSync(chatDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return resolveCursorSessionId(conversation);
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getCursorState(conversation.providerState);
    const sid = state.chatSessionId ?? conversation.sessionId ?? undefined;
    const merged: Record<string, unknown> = { ...state };
    if (sid) {
      merged.chatSessionId = sid;
    }
    const entries = Object.entries(merged).filter(([, value]) => value !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
}
