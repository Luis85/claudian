/**
 * Claude branch-filter scaling guard (history hydration).
 *
 * `filterActiveBranch` is the most algorithmically complex part of Claude
 * history hydration (rewind/re-prompt produces a tree; it walks ancestry +
 * branch siblings to find the canonical conversation). It runs on every history
 * reload / session switch and scales with transcript length. This guards against
 * a regression to super-linear cost as transcripts grow, including a branchy
 * worst case, and reports wall-time for trend tracking.
 */
import { filterActiveBranch } from '@/providers/claude/history/sdkBranchFilter';
import type { SDKNativeMessage } from '@/providers/claude/history/sdkHistoryTypes';

import { reportMetrics, timeMs } from './perfReport';

/** A straight user→assistant→user… chain of `turns` turns (no branches). */
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

/**
 * A transcript where every turn was re-prompted once, creating an abandoned
 * sibling branch at each step — the structure the branch filter must prune.
 */
function branchyTranscript(turns: number): SDKNativeMessage[] {
  const entries: SDKNativeMessage[] = [];
  let parentUuid: string | null = null;
  for (let i = 0; i < turns; i++) {
    // Abandoned branch: a user message + assistant reply that gets superseded.
    entries.push({
      type: 'user',
      uuid: `u${i}-old`,
      parentUuid,
      timestamp: new Date(i * 3 * 1000).toISOString(),
      message: { content: `Question ${i} (first try)` },
    });
    entries.push({
      type: 'assistant',
      uuid: `a${i}-old`,
      parentUuid: `u${i}-old`,
      timestamp: new Date((i * 3 + 1) * 1000).toISOString(),
      message: { content: [{ type: 'text', text: `Answer ${i} (abandoned)` }] },
    });
    // Active branch: re-prompt from the same parent, then continue from it.
    const userUuid = `u${i}`;
    entries.push({
      type: 'user',
      uuid: userUuid,
      parentUuid,
      timestamp: new Date((i * 3 + 2) * 1000).toISOString(),
      message: { content: `Question ${i}` },
    });
    const asstUuid = `a${i}`;
    entries.push({
      type: 'assistant',
      uuid: asstUuid,
      parentUuid: userUuid,
      timestamp: new Date((i * 3 + 2.5) * 1000).toISOString(),
      message: { content: [{ type: 'text', text: `Answer ${i}` }] },
    });
    parentUuid = asstUuid;
  }
  return entries;
}

const SCALES = [50, 200, 800, 2000];

describe('filterActiveBranch scaling (Claude history)', () => {
  it('keeps cost tracking transcript length on linear transcripts', () => {
    const metrics = SCALES.map((turns) => {
      const entries = linearTranscript(turns);
      let result: SDKNativeMessage[] = [];
      const ms = timeMs(() => { result = filterActiveBranch(entries); });
      return {
        n: entries.length,
        kept: result.length,
        values: { entries: entries.length, kept: result.length, filterMs: Math.round(ms * 100) / 100 },
      };
    });

    reportMetrics('filterActiveBranch — linear transcript', metrics);

    // A linear transcript has no branches: every entry survives.
    for (const m of metrics) {
      expect(m.kept).toBe(m.n);
    }
  });

  it('prunes abandoned branches without super-linear blowup', () => {
    const metrics = SCALES.map((turns) => {
      const entries = branchyTranscript(turns);
      let result: SDKNativeMessage[] = [];
      const ms = timeMs(() => { result = filterActiveBranch(entries); });
      return {
        n: entries.length,
        kept: result.length,
        values: { entries: entries.length, kept: result.length, filterMs: Math.round(ms * 100) / 100 },
      };
    });

    reportMetrics('filterActiveBranch — branchy transcript (50% abandoned)', metrics);

    // Each turn contributes 4 entries (2 abandoned, 2 active); only the active
    // branch survives, so kept is roughly half the input and grows linearly.
    for (const m of metrics) {
      expect(m.kept).toBeLessThan(m.n);
      expect(m.kept).toBeGreaterThan(0);
    }
  });
});
