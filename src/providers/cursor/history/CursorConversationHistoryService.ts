import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import { isValidCursorSessionId } from '../../../core/providers/cursorSessionIdValidation';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { type CursorProviderState,getCursorState, resolveCursorSessionId } from '../types';
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
  loadCursorChatMessagesFromStoreResult,
  resolveCursorStoreDbPath,
} from './cursorHistoryStore';

export class CursorConversationHistoryService extends BaseHistoryService<CursorProviderState> {
  // forkSupport intentionally omitted — Cursor capabilities.supportsFork === false.

  protected computeCacheKey(
    conversation: Conversation,
    ctx: HydrationContext,
  ): string | null {
    const sessionId = resolveCursorSessionId(conversation);
    if (!sessionId || !ctx.vaultPath) return null;
    const dbPath = resolveCursorStoreDbPath(ctx.vaultPath, sessionId);
    return dbPath ? `${sessionId}::${dbPath}` : null;
  }

  protected async loadMessages(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome> {
    const sessionId = resolveCursorSessionId(conversation);
    if (!sessionId || !ctx.vaultPath) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }
    const dbPath = resolveCursorStoreDbPath(ctx.vaultPath, sessionId);
    if (!dbPath) {
      return { kind: 'empty', reason: 'no-store', sourceRef: null };
    }

    const sourceRef = `${sessionId}::${dbPath}`;
    const result = loadCursorChatMessagesFromStoreResult(dbPath);
    if (result.error) {
      const error = typeof result.error === 'string'
        ? { code: 'store-unreadable' as const, message: result.error }
        : result.error;
      return { kind: 'error', error, sourceRef };
    }
    if (result.messages.length === 0) {
      return { kind: 'empty', reason: 'no-rows', sourceRef };
    }
    return { kind: 'loaded', messages: result.messages, sourceRef };
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return resolveCursorSessionId(conversation);
  }

  async deleteConversationSessionV2(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome> {
    const sessionId = resolveCursorSessionId(conversation);
    if (!sessionId || !ctx.vaultPath) {
      return { kind: 'no-op', reason: 'no-session' };
    }
    if (!isValidCursorSessionId(sessionId)) {
      return {
        kind: 'error',
        error: {
          code: 'invalid-session-id',
          message: 'Cursor session id failed validation; refusing to delete.',
        },
      };
    }

    const chatsRoot = path.join(os.homedir(), '.cursor', 'chats');
    const candidateHashes = [
      cursorWorkspaceHash(ctx.vaultPath),
      cursorWorkspaceHashLegacy(ctx.vaultPath),
    ];
    const removedPaths: string[] = [];
    const seenDirs = new Set<string>();
    for (const hash of candidateHashes) {
      const chatDir = path.join(chatsRoot, hash, sessionId);
      if (!chatDir.startsWith(chatsRoot)) continue;
      if (seenDirs.has(chatDir)) continue;
      seenDirs.add(chatDir);
      try {
        if (fs.existsSync(chatDir)) {
          fs.rmSync(chatDir, { recursive: true, force: true });
          removedPaths.push(chatDir);
        }
      } catch {
        // best-effort
      }
    }

    return { kind: 'deleted', paths: removedPaths };
  }

  buildPersistedProviderState(conversation: Conversation): CursorProviderState | undefined {
    const state = getCursorState(conversation.providerState);
    const sid = state.chatSessionId ?? conversation.sessionId ?? undefined;
    const merged: CursorProviderState = { ...state };
    if (sid) merged.chatSessionId = sid;
    const entries = Object.entries(merged).filter(([, value]) => value !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) as CursorProviderState : undefined;
  }
}
