import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import { attachCursorSubagentToTaskToolCall } from '../runtime/cursorTaskSubagent';
import {
  normalizeCursorPersistedToolCall,
  normalizeCursorPersistedToolResult,
} from '../runtime/cursorToolNormalization';

export function cursorWorkspaceHash(absoluteVaultPath: string): string {
  return crypto.createHash('md5').update(absoluteVaultPath).digest('hex');
}

export function resolveCursorStoreDbPath(
  absoluteVaultPath: string,
  sessionId: string,
): string | null {
  const hash = cursorWorkspaceHash(absoluteVaultPath);
  const candidate = path.join(os.homedir(), '.cursor', 'chats', hash, sessionId, 'store.db');
  return fs.existsSync(candidate) ? candidate : null;
}

function isIdeBootstrapUser(content: string): boolean {
  return content.includes('<user_info>');
}

function parseAssistantBlob(record: Record<string, unknown>): { text: string; toolCalls: ToolCallInfo[] } {
  const content = record.content;
  if (typeof content === 'string') {
    return { text: content, toolCalls: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', toolCalls: [] };
  }

  let text = '';
  const toolCalls: ToolCallInfo[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === 'redacted-reasoning') {
      continue;
    }
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
    }
    if (b.type === 'tool-call') {
      const id = typeof b.toolCallId === 'string' ? b.toolCallId : '';
      const rawName = typeof b.toolName === 'string' ? b.toolName : 'tool';
      const rawArgs = b.args && typeof b.args === 'object' && !Array.isArray(b.args)
        ? b.args as Record<string, unknown>
        : {};
      const description = typeof b.description === 'string' ? b.description : undefined;
      if (id) {
        const normalized = normalizeCursorPersistedToolCall(rawName, rawArgs, description);
        toolCalls.push({
          id,
          name: normalized.name,
          input: normalized.input,
          status: 'running',
        });
      }
    }
  }

  return { text, toolCalls };
}

function applyToolBlob(record: Record<string, unknown>, messages: ChatMessage[]): void {
  const content = record.content;
  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type !== 'tool-result') {
      continue;
    }
    const toolCallId = typeof b.toolCallId === 'string' ? b.toolCallId : '';
    if (!toolCallId) {
      continue;
    }
    const rawResult = b.result;
    const blockToolName = typeof b.toolName === 'string' ? b.toolName : '';

    const assistant = [...messages].reverse().find(
      m => m.role === 'assistant' && m.toolCalls?.some(t => t.id === toolCallId),
    );
    if (!assistant?.toolCalls) {
      continue;
    }
    const tc = assistant.toolCalls.find(t => t.id === toolCallId);
    if (!tc) {
      continue;
    }

    const toolName = blockToolName || tc.name;
    const normalized = normalizeCursorPersistedToolResult(
      toolName,
      rawResult,
      tc.input,
    );
    tc.result = normalized.content;
    tc.status = normalized.isError ? 'error' : 'completed';
    if (normalized.toolUseResult) {
      const diffData = extractDiffData(normalized.toolUseResult, tc);
      if (diffData) {
        tc.diffData = diffData;
      }
    }

    if (isSubagentToolName(tc.name)) {
      attachCursorSubagentToTaskToolCall(tc, rawResult);
    }
  }
}

function openCursorSqliteReadonly(dbPath: string):
  | { prepare: (sql: string) => { all: () => unknown[] } }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return db;
  } catch {
    return null;
  }
}

/**
 * Builds chat messages from parsed Cursor SQLite blob records. Exported for
 * unit tests so history normalization stays aligned with the live stream mapper.
 */
export function buildChatMessagesFromCursorHistoryRecords(
  records: Array<{ rowId: string; record: Record<string, unknown> }>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const { rowId, record } of records) {
    const role = record.role;
    if (role === 'system') {
      continue;
    }

    if (role === 'user') {
      const c = record.content;
      const text = typeof c === 'string' ? c : '';
      if (isIdeBootstrapUser(text)) {
        continue;
      }
      messages.push({
        id: `cursor-${rowId.slice(0, 12)}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });
      continue;
    }

    if (role === 'assistant') {
      const { text, toolCalls } = parseAssistantBlob(record);
      messages.push({
        id: `cursor-${rowId.slice(0, 12)}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
      continue;
    }

    if (role === 'tool') {
      applyToolBlob(record, messages);
    }
  }

  return messages;
}

export function loadCursorChatMessagesFromStore(dbPath: string): ChatMessage[] {
  const db = openCursorSqliteReadonly(dbPath);
  if (!db) {
    return [];
  }

  let rows: Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
  try {
    const stmt = db.prepare('SELECT rowid, id, data FROM blobs ORDER BY rowid');
    rows = stmt.all() as Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
  } catch {
    return [];
  }

  const records: Array<{ rowId: string; record: Record<string, unknown> }> = [];

  for (const row of rows) {
    const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    const raw = buf.toString('utf8');
    if (!raw.startsWith('{')) {
      continue;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    records.push({ rowId: row.id, record });
  }

  return buildChatMessagesFromCursorHistoryRecords(records);
}
