import { buildUsageInfo } from '../../../core/providers/usage';
import type { StreamChunk } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { cursorModelContextWindow } from './cursorModelWindowCatalog';
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

/**
 * Streaming text state for one assistant message in a turn.
 *
 * cursor-agent `--stream-partial-output` has a precise, observed contract
 * (verified against live captures in `.context/stream-capture/`): each text
 * *segment* is streamed as pure delta fragments (`"I"`, `"'ll list"`, …) and
 * then closed by exactly one cumulative snapshot of *that segment only*. A tool
 * call starts a new segment whose snapshot does NOT re-include earlier segments.
 *
 * - `committed` is everything already emitted in prior, closed segments.
 * - `segment` is the fragments accumulated in the current (open) segment.
 *
 * Recognizing a snapshot is therefore exact-equality, not fuzzy matching:
 * `incoming === segment` (segment-local snapshot) or, defensively,
 * `incoming === committed + segment` (whole-turn snapshot, not seen in practice
 * but cheap to absorb). A back-to-back doubled snapshot (`X + X`, from a doubled
 * prompt or a CLI hiccup) is also dropped so the answer never renders twice.
 */
export interface CursorAssistantTextState {
  committed: string;
  segment: string;
}

export function createCursorAssistantTextState(): CursorAssistantTextState {
  return { committed: '', segment: '' };
}

/** Closes the current segment (e.g. on a tool call) and folds it into committed. */
export function closeCursorAssistantSegment(state: CursorAssistantTextState): void {
  state.committed += state.segment;
  state.segment = '';
}

function isDoubled(text: string, incoming: string): boolean {
  return text.length > 0 && incoming === text + text;
}

/**
 * True when `tail` is just `text` repeated (optionally after a single newline or
 * space separator). Used to drop a cumulative snapshot that re-sends the segment
 * it just streamed — an exact-equality check, not a fuzzy ratio.
 */
function isExactRepeat(text: string, tail: string): boolean {
  if (!text) {
    return false;
  }
  if (tail === text) {
    return true;
  }
  const sep = tail.slice(0, tail.length - text.length);
  return tail.endsWith(text) && /^[\s]*$/.test(sep) && sep.length <= 2;
}

/**
 * Merges one assistant text event into the segment-aware state, returning the
 * delta to emit (empty when the event is a snapshot or duplicate).
 */
export function mergeCursorAssistantText(
  state: CursorAssistantTextState,
  incoming: string,
): string {
  if (!incoming) {
    return '';
  }

  const whole = state.committed + state.segment;

  // Cumulative snapshot of the current segment — already streamed as fragments.
  if (state.segment && incoming === state.segment) {
    return '';
  }

  // Cumulative snapshot of the whole turn so far (defensive; not seen live).
  if (incoming === whole) {
    return '';
  }

  // Doubled snapshot pasted back-to-back (X+X), for the segment or whole turn.
  if (isDoubled(state.segment, incoming) || isDoubled(whole, incoming)) {
    return '';
  }

  // A snapshot that restates the open segment then extends it. If the tail just
  // repeats the segment (a doubled re-send), drop it; otherwise emit the tail.
  if (state.segment && incoming.startsWith(state.segment)) {
    const delta = incoming.slice(state.segment.length);
    if (isExactRepeat(state.segment, delta)) {
      return '';
    }
    state.segment = incoming;
    return delta;
  }

  // Whole-turn cumulative snapshot that re-includes the committed prefix (older
  // cursor-agent behavior where a post-tool snapshot restates pre-tool text).
  // Emit only the new tail and adopt it as the current segment so subsequent
  // fragments append correctly. Guard against the empty-committed case so a
  // normal first fragment isn't misread (every string startsWith '').
  if (state.committed && state.segment === '' && incoming.startsWith(state.committed)) {
    const delta = incoming.slice(state.committed.length);
    state.segment = delta;
    return delta;
  }

  // A normal delta fragment for the open segment.
  state.segment += incoming;
  return incoming;
}

/**
 * Back-compat shim for callers/tests that thread a single accumulated string.
 * Treats the whole accumulated text as one open segment. Prefer the
 * segment-aware {@link mergeCursorAssistantText} in new code.
 */
export function computeCursorAssistantTextDelta(
  accumulated: string,
  incoming: string,
): { delta: string; next: string } {
  const state: CursorAssistantTextState = { committed: '', segment: accumulated };
  const delta = mergeCursorAssistantText(state, incoming);
  return { delta, next: state.segment };
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
  cacheReadInputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative: boolean;
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

  const input = numericField(usageObj, ['input_tokens', 'inputTokens']);
  const output = numericField(usageObj, ['output_tokens', 'outputTokens']);
  const total =
    numericField(usageObj, ['total_tokens', 'totalTokens']) ??
    numericField(rec, ['num_tokens', 'tokens']);
  const cacheRead = numericField(usageObj, ['cache_read_input_tokens']);

  let contextTokens = 0;
  if (typeof total === 'number') {
    contextTokens = total;
  } else if (typeof input === 'number' || typeof output === 'number' || typeof cacheRead === 'number') {
    contextTokens = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0);
  }

  const explicitWindow =
    numericField(usageObj, ['context_window', 'contextWindow', 'context_size']) ??
    numericField(rec, ['context_window', 'contextWindow', 'context_size']);
  const catalogWindow = cursorModelContextWindow(model);
  const isAuthoritative =
    typeof explicitWindow === 'number' && explicitWindow > 0
      ? true
      : catalogWindow > 0;
  const contextWindow =
    typeof explicitWindow === 'number' && explicitWindow > 0
      ? explicitWindow
      : catalogWindow;

  const inputTokens = typeof input === 'number' ? input : 0;
  const percentage =
    contextTokens > 0 && contextWindow > 0
      ? Math.max(0, Math.min(100, Math.round((contextTokens / contextWindow) * 100)))
      : 0;

  const result: CursorUsage = {
    inputTokens,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: isAuthoritative,
    percentage,
  };
  if (typeof output === 'number') result.outputTokens = output;
  if (typeof cacheRead === 'number') result.cacheReadInputTokens = cacheRead;
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
  private assistantText = createCursorAssistantTextState();
  private thinkingText = createCursorAssistantTextState();
  private model: string | undefined;

  reset(): void {
    this.assistantText = createCursorAssistantTextState();
    this.thinkingText = createCursorAssistantTextState();
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
      const delta = mergeCursorAssistantText(this.thinkingText, payload);
      const chunks: StreamChunk[] = delta ? [{ type: 'thinking', content: delta }] : [];
      return { chunks, sessionId };
    }

    if (type === 'usage') {
      if (!this.model) {
        // Model not yet stamped from the `system` event — drop this usage event;
        // we'll emit the next one once `system.model` is observed.
        return { chunks: [], sessionId };
      }
      const usage = extractCursorUsage(rec, this.model);
      return {
        chunks: [
          {
            type: 'usage',
            usage: buildUsageInfo({
              model: this.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
              contextTokens: usage.contextTokens,
              contextWindow: usage.contextWindow,
              contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
            }),
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
        const thinkingDelta = mergeCursorAssistantText(this.thinkingText, fullThinking);
        if (thinkingDelta) {
          chunks.push({ type: 'thinking', content: thinkingDelta });
        }
      }

      const incoming = extractAssistantText(rec);
      const delta = mergeCursorAssistantText(this.assistantText, incoming);
      if (delta) {
        chunks.push({ type: 'text', content: delta });
      }
      return { chunks, sessionId };
    }

    if (type === 'tool_call') {
      const subtype = rec.subtype;
      if (subtype === 'started') {
        // A tool call closes the current text segment. cursor-agent's next
        // assistant snapshot is segment-local (it covers only the post-tool
        // text, not the whole turn), so we fold the open segment into committed
        // and start fresh. The committed prefix still lets us absorb a stray
        // whole-turn snapshot defensively without re-emitting prior text.
        closeCursorAssistantSegment(this.assistantText);
        closeCursorAssistantSegment(this.thinkingText);
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
      this.reset();
      if (rec.is_error === true) {
        const msg = typeof rec.result === 'string'
          ? rec.result
          : 'Cursor Agent run failed';
        return {
          chunks: [{ type: 'error', content: msg }, { type: 'done' }],
          sessionId,
        };
      }
      if (!this.model) {
        return {
          chunks: [{ type: 'done' }],
          sessionId,
        };
      }
      const usage = extractCursorUsage(rec, this.model);
      const chunks: StreamChunk[] = [
        {
          type: 'usage',
          usage: buildUsageInfo({
            model: this.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            contextTokens: usage.contextTokens,
            contextWindow: usage.contextWindow,
            contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
          }),
          sessionId: sessionId ?? null,
        },
        { type: 'done' },
      ];
      return { chunks, sessionId };
    }

    return { chunks: [], sessionId };
  }
}
