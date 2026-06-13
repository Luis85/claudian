import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isValidCursorSessionId } from '../../../core/providers/cursorSessionIdValidation';
import type { HistoryLoadError } from '../../../core/providers/types';
import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import { attachCursorSubagentToTaskToolCall } from '../runtime/cursorTaskSubagent';
import {
  normalizeCursorPersistedToolCall,
  normalizeCursorPersistedToolResult,
} from '../runtime/cursorToolNormalization';

function normalizeWorkspacePathForHash(absoluteVaultPath: string): string {
  let normalized = path.resolve(absoluteVaultPath);
  while (normalized.length > 1 && (normalized.endsWith(path.sep) || normalized.endsWith('/'))) {
    normalized = normalized.slice(0, -1);
  }
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export function cursorWorkspaceHash(absoluteVaultPath: string): string {
  return crypto.createHash('md5').update(normalizeWorkspacePathForHash(absoluteVaultPath)).digest('hex');
}

/** Legacy (pre-normalization) hash; kept only for one-shot upgrade fallback. */
export function cursorWorkspaceHashLegacy(absoluteVaultPath: string): string {
  return crypto.createHash('md5').update(absoluteVaultPath).digest('hex');
}

export function resolveCursorStoreDbPath(
  absoluteVaultPath: string,
  sessionId: string,
): string | null {
  if (!isValidCursorSessionId(sessionId)) return null;
  const candidates = [
    cursorWorkspaceHash(absoluteVaultPath),
    cursorWorkspaceHashLegacy(absoluteVaultPath),
  ];
  for (const hash of candidates) {
    const candidate = path.join(os.homedir(), '.cursor', 'chats', hash, sessionId, 'store.db');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isIdeBootstrapUser(content: string): boolean {
  return content.includes('<user_info>');
}

/**
 * Builds a `ToolCallInfo` from a single `tool-call` content block, or returns
 * null when the block has no usable id (blank ids can't be matched against a
 * later tool-result, so they're dropped here rather than emitted unresolvable).
 */
function parseAssistantToolCallBlock(b: Record<string, unknown>): ToolCallInfo | null {
  const id = typeof b.toolCallId === 'string' ? b.toolCallId : '';
  if (!id) {
    return null;
  }
  const rawName = typeof b.toolName === 'string' ? b.toolName : 'tool';
  const rawArgs = b.args && typeof b.args === 'object' && !Array.isArray(b.args)
    ? b.args as Record<string, unknown>
    : {};
  const description = typeof b.description === 'string' ? b.description : undefined;
  const normalized = normalizeCursorPersistedToolCall(rawName, rawArgs, description);
  return {
    id,
    name: normalized.name,
    input: normalized.input,
    status: 'running',
  };
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
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
    } else if (b.type === 'tool-call') {
      const toolCall = parseAssistantToolCallBlock(b);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
    }
  }

  return { text, toolCalls };
}

/**
 * Finds the running tool call matching `toolCallId`, scanning assistant
 * messages newest-first so a later tool-result resolves against the most
 * recent matching tool call (Cursor reuses ids only across distinct turns).
 */
function findToolCallById(messages: ChatMessage[], toolCallId: string): ToolCallInfo | undefined {
  const assistant = [...messages].reverse().find(
    m => m.role === 'assistant' && m.toolCalls?.some(t => t.id === toolCallId),
  );
  return assistant?.toolCalls?.find(t => t.id === toolCallId);
}

/** Mutates `tc` in place with the normalized result, status, and diff data. */
function applyToolResultToCall(
  tc: ToolCallInfo,
  rawResult: unknown,
  blockToolName: string,
): void {
  const toolName = blockToolName || tc.name;
  const normalized = normalizeCursorPersistedToolResult(toolName, rawResult, tc.input);
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

    const tc = findToolCallById(messages, toolCallId);
    if (!tc) {
      continue;
    }

    const blockToolName = typeof b.toolName === 'string' ? b.toolName : '';
    applyToolResultToCall(tc, b.result, blockToolName);
  }
}

interface CursorSqliteHandle {
  prepare: (sql: string) => { all: () => unknown[] };
  close: () => void;
}

interface CursorSqliteOpenResult {
  handle?: CursorSqliteHandle;
  error?: HistoryLoadError;
}

// node:sqlite ships with Node 22.5+. Older or locked-down runtimes (e.g. some
// Electron/Obsidian builds, or Node 20 where it's a flagged builtin) can't
// resolve it and throw a structured module-resolution error. We key off Node's
// stable error `code` rather than matching human-readable text, which varies
// across versions and locales — that text-matching is precisely what rots.
const SQLITE_UNAVAILABLE_ERROR_CODES = new Set(['MODULE_NOT_FOUND', 'ERR_UNKNOWN_BUILTIN_MODULE']);

/**
 * Classifies a `node:sqlite` open failure into a structured outcome. A missing
 * runtime maps to `sqlite-unavailable` (the user needs a newer Node); anything
 * else is a genuine `store-unreadable` with the home directory redacted out of
 * the detail field.
 */
export function classifyCursorSqliteOpenError(err: unknown): HistoryLoadError {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  const message = err instanceof Error ? err.message : String(err);
  const sqliteUnavailable =
    (typeof code === 'string' && SQLITE_UNAVAILABLE_ERROR_CODES.has(code)) ||
    message.includes('node:sqlite');
  if (sqliteUnavailable) {
    return { code: 'sqlite-unavailable', message: 'Cursor history requires Node 22.5+ (node:sqlite).' };
  }
  // Native sqlite errors can embed the dbPath (and thus the user's home
  // directory). Redact before letting the detail field escape the store.
  return {
    code: 'store-unreadable',
    message: 'Could not open Cursor SQLite store.',
    detail: redactHomeInPath(message),
  };
}

type CursorBlobRow = { rowid: number; id: string; data: Buffer | Uint8Array };

/**
 * Reads every blob row ordered by `rowid`. Throws on SQL failure; callers wrap
 * this in their own try/catch because they diverge on how a read error surfaces
 * (structured store-unreadable string vs. a null short-circuit).
 */
function fetchCursorBlobRows(db: CursorSqliteHandle): CursorBlobRow[] {
  const stmt = db.prepare('SELECT rowid, id, data FROM blobs ORDER BY rowid');
  return stmt.all() as CursorBlobRow[];
}

/**
 * Decodes each blob row to a JSON object, skipping rows whose payload isn't a
 * brace-prefixed JSON object (the `{`-prefix guard makes the non-object/array
 * case unreachable, so both callers see the same record set). Malformed rows are
 * dropped silently — partial history beats a hard read failure.
 */
function parseCursorBlobRecords(
  rows: CursorBlobRow[],
): Array<{ rowId: string; record: Record<string, unknown> }> {
  const records: Array<{ rowId: string; record: Record<string, unknown> }> = [];
  for (const row of rows) {
    const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    const raw = buf.toString('utf8');
    if (!raw.startsWith('{')) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push({ rowId: row.id, record: parsed as Record<string, unknown> });
      }
    } catch {
      continue;
    }
  }
  return records;
}

function openCursorSqliteReadonly(dbPath: string): CursorSqliteOpenResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const handle = new DatabaseSync(dbPath, { readOnly: true }) as unknown as CursorSqliteHandle;
    return { handle };
  } catch (err) {
    return { error: classifyCursorSqliteOpenError(err) };
  }
}

/**
 * Builds chat messages from parsed Cursor SQLite blob records. Exported for
 * unit tests so history normalization stays aligned with the live stream mapper.
 */
export function buildChatMessagesFromCursorHistoryRecords(
  records: Array<{ rowId: string; record: Record<string, unknown> }>,
  baseTimestamp: number = Date.now(),
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Cursor's blob records carry no per-message timestamp (only role/content/id/
  // providerOptions), so we can't recover wall-clock times. Synthesize a
  // monotonic sequence in blob order instead of stamping every message with an
  // identical `Date.now()`, which would collapse any time-based ordering or
  // grouping downstream. `seq` advances only for emitted (pushed) messages;
  // tool blobs mutate the prior assistant message and don't consume a slot.
  let seq = 0;

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
        timestamp: baseTimestamp + seq++,
      });
      continue;
    }

    if (role === 'assistant') {
      const { text, toolCalls } = parseAssistantBlob(record);
      messages.push({
        id: `cursor-${rowId.slice(0, 12)}`,
        role: 'assistant',
        content: text,
        timestamp: baseTimestamp + seq++,
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

function redactHomeInPath(s: string): string {
  const home = os.homedir();
  if (!home) return s;
  const normalizedSlashes = home.replace(/\\/g, '/');
  return s
    .split(home).join('[HOME]')
    .split(normalizedSlashes).join('[HOME]');
}

export interface CursorHistoryLoadResult {
  messages: ChatMessage[];
  /**
   * Structured error from the open path (sqlite-unavailable / store-unreadable);
   * legacy redacted string for downstream SQL-read failures the loader still
   * emits inline. Callers normalize the string variant into `store-unreadable`.
   */
  error?: HistoryLoadError | string;
}

export function loadCursorChatMessagesFromStoreResult(dbPath: string): CursorHistoryLoadResult {
  const openResult = openCursorSqliteReadonly(dbPath);
  if (openResult.error) {
    return { messages: [], error: openResult.error };
  }
  const db = openResult.handle;
  if (!db) {
    return { messages: [], error: `Cursor history: could not open ${redactHomeInPath(dbPath)}` };
  }
  try {
    let rows: CursorBlobRow[];
    try {
      rows = fetchCursorBlobRows(db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { messages: [], error: `Cursor history: SQL read failed (${redactHomeInPath(msg)})` };
    }

    return { messages: buildChatMessagesFromCursorHistoryRecords(parseCursorBlobRecords(rows)) };
  } finally {
    try { db.close(); } catch { /* ignore close errors */ }
  }
}

/** Back-compat wrapper. Prefer `loadCursorChatMessagesFromStoreResult` for new callers. */
export function loadCursorChatMessagesFromStore(dbPath: string): ChatMessage[] {
  return loadCursorChatMessagesFromStoreResult(dbPath).messages;
}

/**
 * Loads the raw, unparsed JSON records from the Cursor blob store, ordered by
 * `rowid` ascending. Used by `extractLastUsage` to scan for usage events that
 * never make it into the user-facing chat messages. Returns null when the
 * store can't be opened or the SQL read fails.
 */
export function loadCursorRawRecords(dbPath: string): Record<string, unknown>[] | null {
  const openResult = openCursorSqliteReadonly(dbPath);
  if (openResult.error || !openResult.handle) {
    return null;
  }
  const db = openResult.handle;
  try {
    let rows: CursorBlobRow[];
    try {
      rows = fetchCursorBlobRows(db);
    } catch {
      return null;
    }

    return parseCursorBlobRecords(rows).map(({ record }) => record);
  } finally {
    try { db.close(); } catch { /* ignore close errors */ }
  }
}
