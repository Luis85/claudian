import type { StreamChunk } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import {
  capCursorToolResultLength,
  normalizeCursorToolCompletion,
  normalizeCursorToolStart,
  readCursorToolEnvelope,
} from './cursorToolNormalization';

export interface CursorReduceResult {
  chunks: StreamChunk[];
  sessionId?: string;
}

function messageContentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
  const msg = record.message;
  if (!msg || typeof msg !== 'object') {
    return [];
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: Record<string, unknown>[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      blocks.push(block as Record<string, unknown>);
    }
  }
  return blocks;
}

function extractAssistantText(record: Record<string, unknown>): string {
  let out = '';
  for (const b of messageContentBlocks(record)) {
    if (b.type === 'text' && typeof b.text === 'string') {
      out += b.text;
    }
  }
  return out;
}

// Reasoning/thinking is undocumented for Cursor. Be liberal about which block
// shapes carry it: a `thinking` block exposes `.thinking`; `reasoning` /
// `reasoning_text` blocks expose `.text` or `.reasoning`.
function extractAssistantThinking(record: Record<string, unknown>): string {
  let out = '';
  for (const b of messageContentBlocks(record)) {
    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      out += b.thinking;
    } else if (b.type === 'reasoning' || b.type === 'reasoning_text') {
      if (typeof b.text === 'string') {
        out += b.text;
      } else if (typeof b.reasoning === 'string') {
        out += b.reasoning;
      }
    }
  }
  return out;
}

// Best-effort per-model context windows. Sizes are approximate and matched by
// case-insensitive substring; real numbers can be tuned later.
export function cursorContextWindowForModel(model: string | undefined): number {
  const id = (model ?? '').toLowerCase();
  if (id.includes('gemini')) {
    return 1_000_000;
  }
  if (id.includes('gpt')) {
    return 400_000;
  }
  if (id.includes('claude') || id.includes('sonnet') || id.includes('opus')) {
    return 200_000;
  }
  if (id.includes('composer') || id.includes('sonic') || id.includes('grok')) {
    return 200_000;
  }
  return 200_000;
}

function numericField(source: unknown, keys: string[]): number | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export interface CursorUsage {
  inputTokens: number;
  outputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  percentage: number;
}

// The shape of Cursor's token/usage data is undocumented, so probe several
// plausible locations (first match wins) and never throw on odd input.
export function extractCursorUsage(
  rec: Record<string, unknown>,
  model: string | undefined,
): CursorUsage {
  const usageObj =
    rec.usage && typeof rec.usage === 'object'
      ? (rec.usage as Record<string, unknown>)
      : rec.message && typeof rec.message === 'object'
        ? ((rec.message as Record<string, unknown>).usage as unknown)
        : undefined;

  const input =
    numericField(usageObj, ['input_tokens', 'inputTokens']) ?? undefined;
  const output =
    numericField(usageObj, ['output_tokens', 'outputTokens']) ?? undefined;
  const total =
    numericField(usageObj, ['total_tokens', 'totalTokens']) ??
    numericField(rec, ['num_tokens', 'tokens']);
  const cacheRead = numericField(usageObj, ['cache_read_input_tokens']);

  // Prefer an explicit total; otherwise sum the pieces we found.
  let contextTokens = 0;
  if (typeof total === 'number') {
    contextTokens = total;
  } else if (typeof input === 'number' || typeof output === 'number' || typeof cacheRead === 'number') {
    contextTokens = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0);
  }

  const explicitWindow =
    numericField(usageObj, ['context_window', 'contextWindow', 'context_size']) ??
    numericField(rec, ['context_window', 'contextWindow', 'context_size']);
  const contextWindow =
    typeof explicitWindow === 'number' && explicitWindow > 0
      ? explicitWindow
      : cursorContextWindowForModel(model);

  const inputTokens = typeof input === 'number' ? input : 0;
  const percentage =
    contextTokens > 0 && contextWindow > 0
      ? Math.max(0, Math.min(100, Math.round((contextTokens / contextWindow) * 100)))
      : 0;

  const result: CursorUsage = { inputTokens, contextTokens, contextWindow, percentage };
  if (typeof output === 'number') {
    result.outputTokens = output;
  }
  return result;
}

interface CursorToolStartChunk {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function parseToolStart(record: Record<string, unknown>): CursorToolStartChunk | null {
  const callId = typeof record.call_id === 'string' ? record.call_id : '';
  if (!callId) return null;

  const tc = record.tool_call;
  if (!tc || typeof tc !== 'object') return null;

  const envelope = readCursorToolEnvelope(tc as Record<string, unknown>);
  if (envelope) {
    const normalized = normalizeCursorToolStart(envelope);
    return { id: callId, name: normalized.name, input: normalized.input };
  }

  const fn = (tc as Record<string, unknown>).function;
  if (fn && typeof fn === 'object') {
    const f = fn as { name?: string; arguments?: string };
    const name = typeof f.name === 'string' ? f.name : 'function';
    let input: Record<string, unknown> = {};
    if (typeof f.arguments === 'string' && f.arguments.trim()) {
      try {
        input = JSON.parse(f.arguments) as Record<string, unknown>;
      } catch {
        input = { raw: f.arguments };
      }
    }
    return { id: callId, name, input };
  }

  return { id: callId, name: 'tool', input: { tool_call: tc } };
}

interface CursorToolCompletionChunk {
  content: string;
  isError: boolean;
  toolUseResult?: SDKToolUseResult;
}

function parseToolCompletion(record: Record<string, unknown>): CursorToolCompletionChunk {
  const tc = record.tool_call;
  if (tc && typeof tc === 'object') {
    const envelope = readCursorToolEnvelope(tc as Record<string, unknown>);
    if (envelope) {
      const normalized = normalizeCursorToolCompletion(envelope);
      return {
        content: capCursorToolResultLength(normalized.content),
        isError: normalized.isError,
        ...(normalized.toolUseResult
          ? { toolUseResult: normalized.toolUseResult as SDKToolUseResult }
          : {}),
      };
    }

    try {
      return { content: capCursorToolResultLength(JSON.stringify(tc)), isError: false };
    } catch {
      return { content: capCursorToolResultLength(String(tc)), isError: false };
    }
  }
  return { content: capCursorToolResultLength(JSON.stringify(record)), isError: false };
}

export class CursorNdjsonStreamReducer {
  private assistantAcc = '';
  private thinkingAcc = '';
  private model: string | undefined;

  reset(): void {
    this.assistantAcc = '';
    this.thinkingAcc = '';
  }

  reduceLine(line: string): CursorReduceResult {
    const trimmed = line.trim();
    if (!trimmed) {
      return { chunks: [] };
    }

    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return { chunks: [] };
    }

    const sessionId = typeof rec.session_id === 'string' ? rec.session_id : undefined;
    const type = rec.type;

    if (type === 'system') {
      if (typeof rec.model === 'string' && rec.model) {
        this.model = rec.model;
      }
      return { chunks: [], sessionId };
    }

    if (type === 'user') {
      return { chunks: [], sessionId };
    }

    // A standalone reasoning event (if Cursor ever emits one) with a string payload.
    if (type === 'thinking' || type === 'reasoning') {
      const payload =
        typeof rec.content === 'string'
          ? rec.content
          : typeof rec.text === 'string'
            ? rec.text
            : typeof rec.thinking === 'string'
              ? rec.thinking
              : typeof rec.reasoning === 'string'
                ? rec.reasoning
                : '';
      const chunks: StreamChunk[] = payload ? [{ type: 'thinking', content: payload }] : [];
      return { chunks, sessionId };
    }

    if (type === 'usage') {
      const usage = extractCursorUsage(rec, this.model);
      return {
        chunks: [
          {
            type: 'usage',
            usage: {
              inputTokens: usage.inputTokens,
              contextWindow: usage.contextWindow,
              contextTokens: usage.contextTokens,
              percentage: usage.percentage,
            },
            sessionId: sessionId ?? null,
          },
        ],
        sessionId,
      };
    }

    if (type === 'assistant') {
      const chunks: StreamChunk[] = [];

      // Emit reasoning deltas before the visible text, mirroring the text-delta
      // dedupe so accumulated thinking is never re-sent.
      const fullThinking = extractAssistantThinking(rec);
      if (fullThinking) {
        const thinkingDelta = fullThinking.startsWith(this.thinkingAcc)
          ? fullThinking.slice(this.thinkingAcc.length)
          : fullThinking;
        this.thinkingAcc = fullThinking;
        if (thinkingDelta) {
          chunks.push({ type: 'thinking', content: thinkingDelta });
        }
      }

      const full = extractAssistantText(rec);
      const delta = full.startsWith(this.assistantAcc)
        ? full.slice(this.assistantAcc.length)
        : full;
      this.assistantAcc = full;
      if (delta) {
        chunks.push({ type: 'text', content: delta });
      }
      return { chunks, sessionId };
    }

    if (type === 'tool_call') {
      const subtype = rec.subtype;
      if (subtype === 'started') {
        // Do not reset assistantAcc here. Cursor emits cumulative assistant text
        // across the whole turn, so wiping the accumulator makes the next assistant
        // event (which still contains the pre-tool text) re-emit everything already
        // shown — the answer would appear twice on any tool-using turn.
        const tool = parseToolStart(rec);
        if (!tool) {
          return { chunks: [], sessionId };
        }
        return {
          chunks: [{ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input }],
          sessionId,
        };
      }

      if (subtype === 'completed') {
        const callId = typeof rec.call_id === 'string' ? rec.call_id : '';
        if (!callId) {
          return { chunks: [], sessionId };
        }
        const completion = parseToolCompletion(rec);
        const chunk: StreamChunk = {
          type: 'tool_result',
          id: callId,
          content: completion.content,
          ...(completion.isError ? { isError: true } : {}),
          ...(completion.toolUseResult ? { toolUseResult: completion.toolUseResult } : {}),
        };
        return { chunks: [chunk], sessionId };
      }

      return { chunks: [], sessionId };
    }

    if (type === 'result') {
      this.assistantAcc = '';
      this.thinkingAcc = '';
      if (rec.is_error === true) {
        const msg = typeof rec.result === 'string'
          ? rec.result
          : 'Cursor Agent run failed';
        return {
          chunks: [{ type: 'error', content: msg }, { type: 'done' }],
          sessionId,
        };
      }
      const usage = extractCursorUsage(rec, this.model);
      const chunks: StreamChunk[] = [
        {
          type: 'usage',
          usage: {
            inputTokens: usage.inputTokens,
            contextWindow: usage.contextWindow,
            contextTokens: usage.contextTokens,
            percentage: usage.percentage,
          },
          sessionId: sessionId ?? null,
        },
        { type: 'done' },
      ];
      return { chunks, sessionId };
    }

    return { chunks: [], sessionId };
  }
}
