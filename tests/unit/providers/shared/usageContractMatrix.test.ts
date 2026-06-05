import { buildSDKMessage } from '@test/helpers/sdkMessages';

import type { StreamChunk, UsageInfo } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import { buildAcpUsageInfo } from '@/providers/acp/buildAcpUsageInfo';
import type { AcpSessionUpdate } from '@/providers/acp/types';
import {
  createTransformUsageState,
  transformSDKMessage,
} from '@/providers/claude/stream/transformClaudeMessage';
import { CodexNotificationRouter } from '@/providers/codex/runtime/CodexNotificationRouter';
import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';

/**
 * Shared contract that every provider's UsageInfo emitter must satisfy.
 * Inlined here (rather than extracted to a shared module) because the contract
 * is the test's whole point — the matrix proves the four real emitters
 * (Claude / Codex / Opencode-ACP / Cursor) all stay in sync with the shape
 * defined in `src/core/types/chat.ts`.
 */
function assertUsageInfoContract(usage: UsageInfo): void {
  expect(usage.model).toBeTruthy();
  expect(typeof usage.model).toBe('string');
  expect(usage.contextWindow).toBeGreaterThanOrEqual(0);
  expect(typeof usage.contextWindowIsAuthoritative).toBe('boolean');
  expect(usage.percentage).toBeGreaterThanOrEqual(0);
  expect(usage.percentage).toBeLessThanOrEqual(100);
  for (const field of [
    'inputTokens',
    'outputTokens',
    'reasoningOutputTokens',
    'thoughtTokens',
    'cacheCreationInputTokens',
    'cacheReadInputTokens',
  ] as const) {
    const v = usage[field];
    if (v !== undefined) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  }
}

describe('UsageInfo cross-provider contract matrix', () => {
  it('Claude emits a contract-conformant UsageInfo', () => {
    const usageState = createTransformUsageState();
    const events = Array.from(
      transformSDKMessage(
        buildSDKMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 100, cache_read_input_tokens: 30 },
          },
        }),
        { intendedModel: 'claude-sonnet-4', usageState },
      ),
    );
    const usageEvents = events.filter(e => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    const usage = (usageEvents[0] as { type: 'usage'; usage: UsageInfo }).usage;
    assertUsageInfoContract(usage);
  });

  it('Codex emits a contract-conformant UsageInfo', () => {
    const chunks: StreamChunk[] = [];
    const router = new CodexNotificationRouter(
      (chunk) => chunks.push(chunk),
      () => 'gpt-5.3-codex',
    );
    router.handleNotification('thread/tokenUsage/updated', {
      threadId: 'T',
      turnId: 't',
      tokenUsage: {
        total: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 5500,
          inputTokens: 4000,
          cachedInputTokens: 200,
          outputTokens: 1000,
          reasoningOutputTokens: 300,
        },
        modelContextWindow: 200_000,
      },
    });
    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    const usage = (usageChunks[0] as { type: 'usage'; usage: UsageInfo }).usage;
    assertUsageInfoContract(usage);
  });

  it('Opencode emits a contract-conformant UsageInfo via the ACP normalize→build pipeline', () => {
    // OpencodeChatRuntime keeps its session-update handler private, so the
    // matrix exercises the same two-stage pipeline the runtime uses:
    //   1. AcpSessionUpdateNormalizer.normalize(wire update)  → normalized 'usage' event
    //   2. buildAcpUsageInfo({ model, promptUsage, contextWindow }) → UsageInfo
    // The runtime tracks `promptUsage` out-of-band (from `response.usage`, not
    // from session/update events) so this test supplies it directly — the goal
    // is to exercise the same shapes the runtime threads at emission time.
    // Wiring a public end-to-end entry point on the runtime is tracked as a
    // follow-up.
    const normalizer = new AcpSessionUpdateNormalizer();
    const wireUpdate: AcpSessionUpdate = {
      sessionUpdate: 'usage_update',
      size: 200_000,
      used: 210,
    };
    const normalized = normalizer.normalize(wireUpdate);
    expect(normalized.type).toBe('usage');
    if (normalized.type !== 'usage') return;

    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedReadTokens: 30,
        cachedWriteTokens: 20,
        thoughtTokens: 10,
        totalTokens: 210,
      },
      contextWindow: normalized.usage,
    });
    expect(usage).not.toBeNull();
    assertUsageInfoContract(usage as UsageInfo);
  });

  it('Cursor emits a contract-conformant UsageInfo', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'claude-sonnet-4' }));
    const { chunks } = reducer.reduceLine(
      JSON.stringify({
        type: 'usage',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    );
    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    const usage = (usageChunks[0] as { type: 'usage'; usage: UsageInfo }).usage;
    assertUsageInfoContract(usage);
  });
});
