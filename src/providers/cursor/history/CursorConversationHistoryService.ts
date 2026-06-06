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
import { buildUsageInfo } from '../../../core/providers/usage';
import type { Conversation, UsageInfo } from '../../../core/types';
import { extractCursorUsage } from '../runtime/cursorStreamMapper';
import { type CursorProviderState, getCursorState, resolveCursorSessionId } from '../types';
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
  loadCursorChatMessagesFromStoreResult,
  loadCursorRawRecords,
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

  async deleteConversationSession(
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

  /**
   * Recovers the most recent `UsageInfo` from Cursor's per-session SQLite
   * `blobs` store. The cursor-agent CLI persists raw stream-json events as
   * JSON blobs; we walk them back to front to find the latest `usage` event
   * (or assistant blob carrying a `usage` field) and the latest `system`
   * event that stamped the model id.
   */
  async extractLastUsage(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<UsageInfo | null> {
    try {
      const sessionId = resolveCursorSessionId(conversation);
      if (!sessionId || !ctx.vaultPath) return null;
      const dbPath = resolveCursorStoreDbPath(ctx.vaultPath, sessionId);
      if (!dbPath) return null;

      const records = loadCursorRawRecords(dbPath);
      if (!records || records.length === 0) return null;

      return extractLastUsageFromCursorRecords(records);
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readModel(rec: Record<string, unknown>): string | null {
  const direct = rec.model;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  // Some Cursor records nest model under message.metadata or system payload.
  if (isRecord(rec.message)) {
    const nested = (rec.message as Record<string, unknown>).model;
    if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim();
  }
  return null;
}

function hasUsageField(rec: Record<string, unknown>): boolean {
  if (rec.type === 'usage') return true;
  if (isRecord(rec.usage)) return true;
  if (isRecord(rec.message) && isRecord((rec.message as Record<string, unknown>).usage)) {
    return true;
  }
  return false;
}

export function extractLastUsageFromCursorRecords(
  records: readonly Record<string, unknown>[],
): UsageInfo | null {
  // Walk back to front: find latest usage-bearing record AND latest model stamp.
  let model: string | null = null;
  let lastUsageRecord: Record<string, unknown> | null = null;

  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!isRecord(rec)) continue;

    if (!model) {
      const candidate = readModel(rec);
      if (candidate) model = candidate;
    }
    if (!lastUsageRecord && hasUsageField(rec)) {
      lastUsageRecord = rec;
    }
    if (model && lastUsageRecord) break;
  }

  if (!lastUsageRecord || !model) return null;

  const usage = extractCursorUsage(lastUsageRecord, model);
  if (usage.contextTokens === 0 && usage.inputTokens === 0 && (usage.outputTokens ?? 0) === 0) {
    return null;
  }

  return buildUsageInfo({
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    contextTokens: usage.contextTokens,
    contextWindow: usage.contextWindow,
    contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
  });
}
