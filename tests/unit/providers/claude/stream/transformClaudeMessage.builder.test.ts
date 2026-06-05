import { buildSDKMessage } from '@test/helpers/sdkMessages';

import type { UsageInfo } from '@/core/types';
import {
  createTransformUsageState,
  transformSDKMessage,
} from '@/providers/claude/stream/transformClaudeMessage';

describe('Claude transform emits a fully-shaped UsageInfo via the shared builder', () => {
  it('stamps the intended model and exposes cache fields', () => {
    const usageState = createTransformUsageState();
    const message = buildSDKMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    });

    const events = [...transformSDKMessage(message, {
      intendedModel: 'claude-sonnet-4',
      usageState,
    })];

    const usageEvents = events.filter(e => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    const usage = (usageEvents[0] as { type: 'usage'; usage: UsageInfo }).usage;
    expect(usage.model).toBe('claude-sonnet-4');
    expect(usage.cacheCreationInputTokens).toBe(20);
    expect(usage.cacheReadInputTokens).toBe(30);
    expect(usage.contextTokens).toBe(150);
    expect(usage.contextWindowIsAuthoritative).toBe(false);
  });

  it('flips contextWindowIsAuthoritative to true on the result-arm usage when modelUsage[model] is present', () => {
    const usageState = createTransformUsageState();
    // First: prime state with a message_start (populates state without emitting usage).
    const startMessage = buildSDKMessage({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          usage: { input_tokens: 100 },
        },
      },
    });
    Array.from(transformSDKMessage(startMessage, {
      intendedModel: 'claude-sonnet-4',
      usageState,
    }));

    // Now: emit a result with modelUsage stamped.
    const resultMessage = buildSDKMessage({
      type: 'result',
      subtype: 'success',
      modelUsage: {
        'claude-sonnet-4': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: 200_000,
          maxOutputTokens: 8192,
        },
      },
    });
    const events = [...transformSDKMessage(resultMessage, {
      intendedModel: 'claude-sonnet-4',
      usageState,
    })];

    const usageEvents = events.filter(e => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    const usage = (usageEvents[0] as { type: 'usage'; usage: UsageInfo }).usage;
    expect(usage.contextWindowIsAuthoritative).toBe(true);

    const cwEvents = events.filter(e => e.type === 'context_window');
    expect(cwEvents).toHaveLength(1);
  });
});
