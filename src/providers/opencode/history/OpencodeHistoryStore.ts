import * as fs from 'node:fs';

import type { HistoryLoadError } from '../../../core/providers/types';
import type { ChatMessage, ContentBlock } from '../../../core/types';
import { extractUserQuery } from '../../../utils/context';
import { resolveExistingOpencodeDatabasePath } from '../runtime/OpencodePaths';
import type { OpencodeProviderState } from '../types';
import {
  escapeSqlLiteral,
  isSqliteTransportAvailable,
  loadSqliteModule,
  runSqlite3JsonQuery,
  type SqliteModule,
} from './opencodeSqlite';
import {
  getBoolean,
  getNestedNumber,
  getNumber,
  getString,
  isPlainObject,
  type StoredRow,
} from './opencodeStoredRow';
import { buildAssistantToolCalls } from './opencodeToolCallBuilder';

interface StoredMessage {
  info: StoredRow;
  parts: StoredRow[];
}

interface OpencodeHydrationDiagnosticContext {
  databasePath?: string;
  sessionId?: string;
}

export const OPENCODE_MESSAGE_ROW_SQL = buildOpencodeMessageRowsSql('?');
const OPENCODE_PART_ROW_SQL = buildOpencodePartRowsSql('?');
const OPENCODE_LAST_ASSISTANT_DATA_SQL = buildOpencodeLastAssistantDataSql('?');
const OPENCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX = 'opencode-hydration-error';

export interface OpencodeSessionLoadResult {
  messages: ChatMessage[];
  error?: HistoryLoadError;
}

export async function loadOpencodeSessionMessages(
  sessionId: string,
  providerState?: OpencodeProviderState,
): Promise<OpencodeSessionLoadResult> {
  const databasePath = resolveExistingOpencodeDatabasePath(providerState?.databasePath);
  if (!databasePath || databasePath === ':memory:' || !fs.existsSync(databasePath)) {
    return { messages: [] };
  }

  const rows = await loadOpencodeSessionRows(databasePath, sessionId);
  if (!rows) {
    const transportAvailable = await isSqliteTransportAvailable();
    const error: HistoryLoadError = transportAvailable
      ? {
          code: 'store-unreadable',
          message: 'Could not read OpenCode session rows from SQLite.',
          detail: `databasePath=${databasePath} sessionId=${sessionId}`,
        }
      : {
          code: 'sqlite-unavailable',
          message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
          detail: `databasePath=${databasePath} sessionId=${sessionId}`,
        };
    return { messages: [], error };
  }

  return {
    messages: mapOpencodeMessages(
      hydrateStoredMessages(rows.messageRows, rows.partRows),
      { databasePath, sessionId },
    ),
  };
}

export function mapOpencodeMessages(
  messages: StoredMessage[],
  context: OpencodeHydrationDiagnosticContext = {},
): ChatMessage[] {
  const mappedMessages: ChatMessage[] = [];

  for (const message of messages) {
    try {
      const mappedMessage = mapStoredMessage(message, context);
      if (mappedMessage) {
        mappedMessages.push(mappedMessage);
      }
    } catch (error) {
      // Per-row sentinel stays for individual malformed messages; session-level
      // failures are reported through HistoryLoadOutcome.error. Lifting per-row
      // signals into the outcome (e.g. `outcomes: HistoryLoadError[]` on the
      // loaded variant) is a follow-up.
      mappedMessages.push(createOpencodeHydrationDiagnosticMessage({
        ...context,
        messageId: getString(message.info.id) ?? undefined,
        reason: formatUnknownError(error),
      }));
    }
  }

  return mergeAdjacentAssistantMessages(mappedMessages);
}

function hydrateStoredMessages(
  messageRows: StoredRow[],
  partRows: StoredRow[],
): StoredMessage[] {
  const partsByMessage = new Map<string, StoredRow[]>();

  for (const row of partRows) {
    const messageId = getString(row.message_id);
    const id = getString(row.id);
    const data = parseJsonObject(row.data);
    if (!messageId || !id || !data) {
      continue;
    }

    const parts = partsByMessage.get(messageId) ?? [];
    parts.push({ ...data, id });
    partsByMessage.set(messageId, parts);
  }

  return messageRows.flatMap((row) => {
    const id = getString(row.id);
    if (!id) {
      return [];
    }

    const data = parseJsonObject(row.data);
    return [{
      info: data
        ? { ...data, id, time_created: row.time_created }
        : {
            data_time_completed: row.data_time_completed,
            data_time_created: row.data_time_created,
            data_valid: row.data_valid,
            id,
            role: row.role,
            time_created: row.time_created,
          },
      parts: partsByMessage.get(id) ?? [],
    }];
  });
}

function mapStoredMessage(
  message: StoredMessage,
  context: OpencodeHydrationDiagnosticContext,
): ChatMessage | null {
  const role = getString(message.info.role);
  const id = getString(message.info.id);
  if (!id) {
    return null;
  }
  if (isInvalidStoredMessageData(message.info)) {
    return createOpencodeHydrationDiagnosticMessage({
      ...context,
      messageId: id,
      reason: 'OpenCode message metadata is not valid JSON.',
    });
  }
  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  const createdAt = getMessageCreatedAt(message.info)
    ?? Date.now();

  if (role === 'user') {
    const promptText = extractUserQuery(getJoinedTextParts(message.parts));
    return {
      assistantMessageId: undefined,
      content: promptText,
      id,
      role: 'user',
      timestamp: createdAt,
      userMessageId: id,
    };
  }

  const contentBlocks = buildAssistantContentBlocks(message.parts);
  const toolCalls = buildAssistantToolCalls(message.parts);
  const completedAt = getMessageCompletedAt(message.info);
  const durationSeconds = completedAt && completedAt >= createdAt
    ? Math.max(0, (completedAt - createdAt) / 1_000)
    : undefined;

  return {
    assistantMessageId: id,
    content: contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.content)
      .join(''),
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    durationSeconds,
    id,
    role: 'assistant',
    timestamp: createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (
      message.role === 'assistant'
      && previous?.role === 'assistant'
      && !message.isInterrupt
      && !previous.isInterrupt
      && !isOpencodeHydrationDiagnosticMessage(message)
      && !isOpencodeHydrationDiagnosticMessage(previous)
    ) {
      previous.content += message.content;
      previous.assistantMessageId = message.assistantMessageId ?? previous.assistantMessageId;
      previous.durationFlavorWord = message.durationFlavorWord ?? previous.durationFlavorWord;
      previous.durationSeconds = mergeAssistantDurationSeconds(previous, message);
      previous.toolCalls = mergeOptionalArrays(previous.toolCalls, message.toolCalls);
      previous.contentBlocks = mergeOptionalArrays(previous.contentBlocks, message.contentBlocks);
      continue;
    }

    merged.push(message);
  }

  return merged;
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  if (!left?.length && !right?.length) {
    return undefined;
  }

  return [
    ...(left ?? []),
    ...(right ?? []),
  ];
}

function mergeAssistantDurationSeconds(
  first: ChatMessage,
  next: ChatMessage,
): number | undefined {
  const firstEnd = getMessageCompletionTime(first);
  const nextEnd = getMessageCompletionTime(next);
  if (firstEnd === null && nextEnd === null) {
    return undefined;
  }

  const end = Math.max(firstEnd ?? first.timestamp, nextEnd ?? next.timestamp);
  return Math.max(0, (end - first.timestamp) / 1_000);
}

function getMessageCompletionTime(message: ChatMessage): number | null {
  if (typeof message.durationSeconds !== 'number') {
    return null;
  }

  return message.timestamp + (message.durationSeconds * 1_000);
}

function getMessageCreatedAt(info: StoredRow): number | null {
  return getNestedNumber(info, ['time', 'created'])
    ?? getNumber(info.data_time_created)
    ?? getNumber(info.time_created);
}

function getMessageCompletedAt(info: StoredRow): number | null {
  return getNestedNumber(info, ['time', 'completed'])
    ?? getNumber(info.data_time_completed);
}

function isInvalidStoredMessageData(info: StoredRow): boolean {
  return getNumber(info.data_valid) === 0;
}

function createOpencodeHydrationDiagnosticMessage(params: {
  databasePath?: string;
  messageId?: string;
  reason: string;
  sessionId?: string;
}): ChatMessage {
  const detailLines = [
    'Failed to hydrate OpenCode session.',
    'provider: OpenCode',
    ...(params.sessionId ? [`sessionId: ${params.sessionId}`] : []),
    ...(params.databasePath ? [`databasePath: ${params.databasePath}`] : []),
    ...(params.messageId ? [`messageId: ${params.messageId}`] : []),
    `reason: ${params.reason}`,
  ];
  const content = detailLines.join('\n');

  return {
    assistantMessageId: undefined,
    content,
    contentBlocks: [{ content, type: 'text' }],
    id: buildOpencodeHydrationDiagnosticId(params),
    role: 'assistant',
    timestamp: Date.now(),
  };
}

function buildOpencodeHydrationDiagnosticId(params: {
  messageId?: string;
  sessionId?: string;
}): string {
  const scope = params.messageId ? 'message' : 'session';
  const rawId = params.messageId ?? params.sessionId ?? String(Date.now());
  const safeId = rawId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || String(Date.now());
  return `${OPENCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX}-${scope}-${safeId}`;
}

function isOpencodeHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(OPENCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildAssistantContentBlocks(parts: StoredRow[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const part of parts) {
    switch (getString(part.type)) {
      case 'reasoning': {
        const text = getString(part.text)?.trim();
        if (!text) {
          break;
        }
        blocks.push({
          content: text,
          durationSeconds: getDurationSeconds(part),
          type: 'thinking',
        });
        break;
      }
      case 'text': {
        const text = getString(part.text);
        if (!text || getBoolean(part.ignored)) {
          break;
        }
        blocks.push({
          content: text,
          type: 'text',
        });
        break;
      }
      case 'tool': {
        const toolId = getString(part.callID);
        if (!toolId) {
          break;
        }
        blocks.push({
          toolId,
          type: 'tool_use',
        });
        break;
      }
    }
  }

  return blocks;
}

function getJoinedTextParts(parts: StoredRow[]): string {
  return parts
    .filter((part) => getString(part.type) === 'text' && !getBoolean(part.ignored))
    .map((part) => getString(part.text) ?? '')
    .join('');
}

function getDurationSeconds(part: StoredRow): number | undefined {
  const start = getNestedNumber(part, ['time', 'start']);
  const end = getNestedNumber(part, ['time', 'end']);
  if (start === null || end === null || end < start) {
    return undefined;
  }

  return Math.max(0, (end - start) / 1_000);
}

function parseJsonObject(value: unknown): StoredRow | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface StoredSessionRows {
  messageRows: StoredRow[];
  partRows: StoredRow[];
}

async function loadOpencodeSessionRows(
  databasePath: string,
  sessionId: string,
): Promise<StoredSessionRows | null> {
  const viaNodeSqlite = await loadSessionRowsWithNodeSqlite(databasePath, sessionId);
  if (viaNodeSqlite) {
    return viaNodeSqlite;
  }

  return loadSessionRowsWithSqliteCli(databasePath, sessionId);
}

async function loadSessionRowsWithNodeSqlite(
  databasePath: string,
  sessionId: string,
): Promise<StoredSessionRows | null> {
  const sqlite = await loadSqliteModule();
  if (!sqlite) {
    return null;
  }

  let db: InstanceType<SqliteModule['DatabaseSync']> | null = null;
  try {
    db = new sqlite.DatabaseSync(databasePath, { readonly: true });
    const messageRows = db.prepare(OPENCODE_MESSAGE_ROW_SQL).all(sessionId);
    const partRows = db.prepare(OPENCODE_PART_ROW_SQL).all(sessionId);
    return { messageRows, partRows };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function loadSessionRowsWithSqliteCli(
  databasePath: string,
  sessionId: string,
): StoredSessionRows | null {
  const escapedSessionId = escapeSqlLiteral(sessionId);
  const messageRows = runSqlite3JsonQuery(
    databasePath,
    buildOpencodeMessageRowsSql(`'${escapedSessionId}'`),
  );
  const partRows = runSqlite3JsonQuery(
    databasePath,
    buildOpencodePartRowsSql(`'${escapedSessionId}'`),
  );

  if (!messageRows || !partRows) {
    return null;
  }

  return { messageRows, partRows };
}

function buildOpencodeMessageRowsSql(sessionIdExpression: string): string {
  return `
with message_json as (
  select
    id,
    time_created,
    data,
    json_valid(data) as data_valid
  from message
  where session_id = ${sessionIdExpression}
)
select
  id,
  time_created,
  data_valid,
  case when data_valid then json_extract(data, '$.role') end as role,
  case when data_valid then json_extract(data, '$.time.created') end as data_time_created,
  case when data_valid then json_extract(data, '$.time.completed') end as data_time_completed
from message_json
order by time_created asc, id asc;`.trim();
}

function buildOpencodePartRowsSql(sessionIdExpression: string): string {
  return `
select id, message_id, data
from part
where session_id = ${sessionIdExpression}
order by message_id asc, id asc;`.trim();
}

function buildOpencodeLastAssistantDataSql(sessionIdExpression: string): string {
  // Pull the most recent assistant message's raw data JSON. Order by
  // time_created desc, id desc so a tied timestamp still resolves
  // deterministically. We intentionally trust the row's validity check
  // (json_valid) so a malformed row never makes it back to the caller.
  return `
select data
from message
where session_id = ${sessionIdExpression}
  and json_valid(data)
  and json_extract(data, '$.role') = 'assistant'
order by time_created desc, id desc
limit 1;`.trim();
}

/**
 * Loads the most recent assistant `message.data` JSON for a session, used by
 * `extractLastUsage` to recover persisted token counts without re-hydrating
 * the full transcript. Returns null when the store is unavailable, the row
 * doesn't exist, or the JSON fails to parse.
 */
export async function loadOpencodeLastAssistantData(
  sessionId: string,
  providerState?: OpencodeProviderState,
): Promise<Record<string, unknown> | null> {
  const databasePath = resolveExistingOpencodeDatabasePath(providerState?.databasePath);
  if (!databasePath || databasePath === ':memory:' || !fs.existsSync(databasePath)) {
    return null;
  }

  // Try node:sqlite first, then sqlite3 CLI — same transport pattern as
  // loadOpencodeSessionRows above.
  const viaNodeSqlite = await loadLastAssistantDataWithNodeSqlite(databasePath, sessionId);
  if (viaNodeSqlite !== undefined) {
    return viaNodeSqlite;
  }
  return loadLastAssistantDataWithSqliteCli(databasePath, sessionId);
}

async function loadLastAssistantDataWithNodeSqlite(
  databasePath: string,
  sessionId: string,
): Promise<Record<string, unknown> | null | undefined> {
  const sqlite = await loadSqliteModule();
  if (!sqlite) {
    return undefined;
  }

  let db: InstanceType<SqliteModule['DatabaseSync']> | null = null;
  try {
    db = new sqlite.DatabaseSync(databasePath, { readonly: true });
    const rows = db.prepare(OPENCODE_LAST_ASSISTANT_DATA_SQL).all(sessionId);
    if (rows.length === 0) return null;
    const row = rows[0];
    return parseJsonObject(row.data);
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function loadLastAssistantDataWithSqliteCli(
  databasePath: string,
  sessionId: string,
): Record<string, unknown> | null {
  const escapedSessionId = escapeSqlLiteral(sessionId);
  const rows = runSqlite3JsonQuery(
    databasePath,
    buildOpencodeLastAssistantDataSql(`'${escapedSessionId}'`),
  );
  if (!rows || rows.length === 0) return null;
  return parseJsonObject(rows[0].data);
}
