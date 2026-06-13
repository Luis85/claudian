/**
 * Extracts the final textual result from subagent JSONL output.
 * Prefers the latest assistant text block and falls back to top-level result.
 */

interface SubagentJsonlRecord {
  result?: unknown;
  message?: { role?: unknown; content?: unknown };
}

/** Parses a JSONL line into an object record, or null when it is not a usable object. */
function parseRecord(line: string): SubagentJsonlRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return raw as SubagentJsonlRecord;
}

/** Non-empty trimmed top-level `result` string, or null. */
function readResultText(record: SubagentJsonlRecord): string | null {
  if (typeof record.result === 'string' && record.result.trim().length > 0) {
    return record.result.trim();
  }
  return null;
}

/** Latest non-empty assistant text block in an assistant message, or null. */
function readAssistantText(record: SubagentJsonlRecord): string | null {
  if (record.message?.role !== 'assistant' || !Array.isArray(record.message.content)) {
    return null;
  }
  let lastText: string | null = null;
  for (const blockRaw of record.message.content) {
    if (!blockRaw || typeof blockRaw !== 'object') {
      continue;
    }
    const block = blockRaw as { type?: unknown; text?: unknown };
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      lastText = block.text.trim();
    }
  }
  return lastText;
}

export function extractFinalResultFromSubagentJsonl(content: string): string | null {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith('{'));

  let lastAssistantText: string | null = null;
  let lastResultText: string | null = null;

  for (const line of lines) {
    const record = parseRecord(line);
    if (!record) {
      continue;
    }
    lastResultText = readResultText(record) ?? lastResultText;
    lastAssistantText = readAssistantText(record) ?? lastAssistantText;
  }

  return lastAssistantText ?? lastResultText;
}
