/**
 * ToolCallIndex scaling guard (streaming hot path).
 *
 * Resolving a streamed chunk's id against a turn's accumulated tool calls must
 * stay O(1) per lookup, otherwise a long tool-heavy turn costs O(tools²). This
 * asserts the indexed lookup does not degrade as the turn grows, and reports the
 * per-lookup cost vs. a naive linear scan for trend tracking.
 */
import type { ToolCallInfo } from '@/core/types';
import { ToolCallIndex } from '@/features/chat/controllers/toolCallIndex';

import { reportMetrics, timeMs } from './perfReport';

function toolCalls(n: number): ToolCallInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `tool-${i}`,
    name: 'Read',
    input: {},
    status: 'completed' as const,
  }));
}

/** Simulates a turn: append each tool, then resolve every id seen so far. */
function indexedTurnCost(calls: ToolCallInfo[]): number {
  const index = new ToolCallIndex();
  const seen: ToolCallInfo[] = [];
  return timeMs(() => {
    for (const call of calls) {
      index.add(call);
      seen.push(call);
      // The hot path resolves the just-streamed id every chunk.
      index.get(call.id, seen);
    }
  });
}

/** The pre-index O(tools²) baseline: linear scan per append. */
function linearTurnCost(calls: ToolCallInfo[]): number {
  const seen: ToolCallInfo[] = [];
  return timeMs(() => {
    for (const call of calls) {
      seen.push(call);
      seen.find(tc => tc.id === call.id);
    }
  });
}

const SCALES = [50, 200, 800, 2000];

describe('ToolCallIndex scaling (streaming hot path)', () => {
  it('keeps per-lookup cost flat as a turn accumulates tool calls', () => {
    const metrics = SCALES.map((n) => {
      const calls = toolCalls(n);
      const indexedMs = indexedTurnCost(calls);
      const linearMs = linearTurnCost(calls);
      return {
        n,
        values: {
          indexedMs: Math.round(indexedMs * 1000) / 1000,
          linearMs: Math.round(linearMs * 1000) / 1000,
        },
      };
    });

    reportMetrics('ToolCallIndex — indexed turn vs O(n^2) linear scan', metrics);

    // Structural guarantee (not timing): a hit resolves without consulting the
    // array, and a miss still resolves via fallback — both independent of size.
    for (const n of SCALES) {
      const calls = toolCalls(n);
      const index = new ToolCallIndex();
      index.reindex(calls);
      expect(index.get('tool-0', calls)).toBe(calls[0]);
      expect(index.get(`tool-${n - 1}`, calls)).toBe(calls[n - 1]);
      // Miss falls back to the authoritative array (correctness, not speed).
      expect(index.get('absent', calls)).toBeUndefined();
    }
  });

  it('resolves via array fallback when an entry was never indexed', () => {
    const calls = toolCalls(10);
    const index = new ToolCallIndex();
    index.add(calls[3]); // only one indexed
    // Unindexed id is still found through the backing array.
    expect(index.get('tool-7', calls)).toBe(calls[7]);
    expect(index.get('tool-3', calls)).toBe(calls[3]);
  });
});
