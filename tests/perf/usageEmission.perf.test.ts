/**
 * StreamProjection.projectUsage scaling guard (token-consumption hot path).
 *
 * Each provider stream emits many `usage` chunks; the two-phase filter must
 * stay O(1) per chunk. The deterministic guard rail asserts SCALING SHAPE —
 * per-call cost stays bounded as N grows — never wall-clock thresholds. Sibling
 * perf specs follow the same convention (see CLAUDE.md "Performance suite":
 * "timings are never asserted, so the suite stays stable on noisy machines").
 *
 * Runs only under `npm run test:perf`; never part of `npm test`.
 */
import type { StreamChunk } from '@/core/types/chat';
import { projectUsage, type UsageProjectionInput } from '@/features/chat/controllers/StreamProjection';

import { reportMetrics, timeMs } from './perfReport';

const SCALES = [1_000, 10_000, 100_000];

test('projectUsage stays O(1) per chunk (per-call cost bounded as N grows)', () => {
  const input: UsageProjectionInput = {
    currentSessionId: 's',
    subagentsSpawnedThisStream: 0,
    ignoreUsageUpdates: false,
    activeProviderModel: 'claude-sonnet-4',
  };
  const chunk: Extract<StreamChunk, { type: 'usage' }> = {
    type: 'usage',
    usage: {
      inputTokens: 100,
      contextWindow: 200_000,
      contextTokens: 100,
      percentage: 0,
    },
    sessionId: 's',
  };

  // Warm-up: one short pass so the JIT settles before we measure ratios.
  for (let i = 0; i < 1_000; i++) projectUsage(chunk, input);

  const metrics = SCALES.map((n) => {
    const ms = timeMs(() => {
      for (let i = 0; i < n; i++) projectUsage(chunk, input);
    });
    return {
      n,
      values: {
        totalMs: Math.round(ms * 1000) / 1000,
        perCallNs: Math.round((ms * 1_000_000) / n),
      },
    };
  });

  reportMetrics('projectUsage — per-call cost vs N (10x scale)', metrics);

  // Scaling-shape guard: catches O(N) regressions while staying immune to
  // wall-clock noise on shared/CI machines.
  // - O(1) per call: per-call ns is roughly constant across N.
  // - O(N) per call: per-call ns multiplies by 10 between consecutive scales.
  // We compare per-call ns at the largest N vs the smallest. A linear-time
  // regression would push the ratio past 50× (with plenty of headroom for
  // GC pauses, scheduler jitter, and timer resolution at small N).
  const perCallSmallN = metrics[0].values.perCallNs;
  const perCallLargeN = metrics[metrics.length - 1].values.perCallNs;
  // Avoid divide-by-zero at sub-microsecond resolution.
  const ratio = perCallSmallN > 0 ? perCallLargeN / perCallSmallN : 1;
  expect(ratio).toBeLessThan(50);
});
