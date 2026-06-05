/**
 * StreamProjection.projectUsage scaling guard (token-consumption hot path).
 *
 * Each provider stream emits many `usage` chunks; the two-phase filter must
 * stay O(1) per chunk. This spec runs 10,000 iterations and trips a loose
 * 500ms ceiling — well above any plausible O(1) cost on noisy machines, but
 * far below the seconds an accidental O(N) regression would burn.
 *
 * Runs only under `npm run test:perf`; never part of `npm test`.
 */
import type { StreamChunk } from '@/core/types/chat';
import { projectUsage, type UsageProjectionInput } from '@/features/chat/controllers/StreamProjection';

test('projectUsage stays O(1) per chunk', () => {
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

  const N = 10_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) projectUsage(chunk, input);
  const elapsed = performance.now() - t0;

  // Loose ceiling: catches O(N) accidents (which would push elapsed into seconds
  // for N=10k), not a timing assertion.
  expect(elapsed).toBeLessThan(500);
});
