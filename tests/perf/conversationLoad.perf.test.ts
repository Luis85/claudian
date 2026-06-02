/**
 * Conversation-load hydration scaling guard (PERF-8).
 *
 * `loadSDKSessionMessages` is the cold-load path: disk read → JSONL parse →
 * branch filter → merge loop → hydration. It runs on every history open and
 * every plugin activation that resumes a long chat, and scales with transcript
 * length. The PERF-4 fix added event-loop yields so the UI stays responsive;
 * this spec is the higher-level regression net that locks the contract:
 *
 *   1. Output message count tracks input count (catches dropped messages or
 *      O(N²) duplication regardless of where in the pipeline they appear).
 *   2. Wall-time is reported for trend tracking — never asserted, so the suite
 *      stays stable on noisy machines (per `jest.perf.config.js`).
 *
 * The yield-rate contract itself is covered by `tests/unit/utils/sdkSession.test.ts`.
 * The existing `claudeHistory.perf.test.ts` covers only `filterActiveBranch`;
 * this spec covers the full disk-to-hydrated-messages pipeline.
 */
import { existsSync } from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';

import { loadSDKSessionMessages } from '@/providers/claude/history/ClaudeHistoryStore';
import type { SDKNativeMessage } from '@/providers/claude/history/sdkHistoryTypes';

import { reportMetrics } from './perfReport';

jest.mock('fs', () => ({ existsSync: jest.fn() }));
jest.mock('fs/promises');
jest.mock('os');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockFsPromises = fsPromises as jest.Mocked<typeof fsPromises>;
const mockOs = os as jest.Mocked<typeof os>;

/** A straight user→assistant→user… chain with no branches or tool calls. */
function linearTranscript(turns: number): SDKNativeMessage[] {
  const entries: SDKNativeMessage[] = [];
  let parentUuid: string | null = null;
  for (let i = 0; i < turns; i++) {
    const userUuid = `u${i}`;
    entries.push({
      type: 'user',
      uuid: userUuid,
      parentUuid,
      timestamp: new Date(i * 2 * 1000).toISOString(),
      message: { content: `Question ${i}` },
    });
    const asstUuid = `a${i}`;
    entries.push({
      type: 'assistant',
      uuid: asstUuid,
      parentUuid: userUuid,
      timestamp: new Date((i * 2 + 1) * 1000).toISOString(),
      message: { content: [{ type: 'text', text: `Answer ${i}` }] },
    });
    parentUuid = asstUuid;
  }
  return entries;
}

/** Serializes SDK entries as JSONL — the on-disk format `readFile` sees. */
function toJsonl(entries: SDKNativeMessage[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

const SCALES = [50, 200, 800, 2000];

describe('loadSDKSessionMessages scaling (Claude conversation load)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue('/Users/test');
    mockExistsSync.mockReturnValue(true);
  });

  it('keeps hydrated message count tracking input length without drops or duplication', async () => {
    const metrics: { n: number; values: Record<string, number> }[] = [];

    for (const turns of SCALES) {
      const entries = linearTranscript(turns);
      const content = toJsonl(entries);
      mockFsPromises.readFile.mockResolvedValue(content);

      const start = performance.now();
      const result = await loadSDKSessionMessages('/Users/test/vault', `session-${turns}`);
      const ms = performance.now() - start;

      metrics.push({
        n: entries.length,
        values: {
          entries: entries.length,
          messages: result.messages.length,
          skipped: result.skippedLines,
          loadMs: Math.round(ms * 100) / 100,
        },
      });

      // A linear user/assistant chain has no consecutive assistants to merge and
      // no system/result/meta entries to drop, so the output count equals the
      // input count exactly. Any future regression that drops messages
      // (off-by-one in the merge loop) or duplicates them (O(N²) blowup) will
      // fail this assertion at every scale, not just timing-dependent ones.
      expect(result.messages).toHaveLength(entries.length);
      expect(result.skippedLines).toBe(0);
      expect(result.error).toBeUndefined();
    }

    reportMetrics('loadSDKSessionMessages — full disk-to-hydrated pipeline', metrics);

    // Cross-scale invariant: a 40x larger input must produce a 40x larger
    // output (within rounding). Catches partial-truncation regressions that
    // could pass the per-scale equality check but silently cap at some N.
    const smallest = metrics[0].values.messages;
    const largest = metrics[metrics.length - 1].values.messages;
    const ratio = largest / smallest;
    const expectedRatio = SCALES[SCALES.length - 1] / SCALES[0];
    expect(ratio).toBe(expectedRatio);
  });
});
