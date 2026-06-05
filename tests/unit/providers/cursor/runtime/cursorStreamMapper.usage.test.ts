import type { UsageInfo } from '@/core/types';
import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';

describe('CursorNdjsonStreamReducer usage emission', () => {
  it('stamps the active model and the cache_read field, routes window through the catalog', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'claude-sonnet-4' }));
    const { chunks } = reducer.reduceLine(
      JSON.stringify({
        type: 'usage',
        usage: {
          input_tokens: 4000,
          output_tokens: 1000,
          cache_read_input_tokens: 500,
          total_tokens: 5500,
        },
      }),
    );
    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    const usage = (usageChunks[0] as { type: 'usage'; usage: UsageInfo }).usage;
    expect(usage.model).toBe('claude-sonnet-4');
    expect(usage.cacheReadInputTokens).toBe(500);
    expect(usage.outputTokens).toBe(1000);
    expect(usage.contextWindow).toBe(200_000);
    expect(usage.contextWindowIsAuthoritative).toBe(true);
  });

  it('marks contextWindowIsAuthoritative=false when the model is unknown', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'totally-fake-model' }));
    const { chunks } = reducer.reduceLine(
      JSON.stringify({
        type: 'usage',
        usage: { input_tokens: 100, total_tokens: 100 },
      }),
    );
    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    const usage = (usageChunks[0] as { type: 'usage'; usage: UsageInfo }).usage;
    expect(usage.contextWindowIsAuthoritative).toBe(false);
    expect(usage.contextWindow).toBe(0);
    expect(usage.percentage).toBe(0);
  });

  it('drops usage chunk silently when model is not yet known', () => {
    const reducer = new CursorNdjsonStreamReducer();
    // No system event first — model unset.
    const { chunks } = reducer.reduceLine(
      JSON.stringify({
        type: 'usage',
        usage: { input_tokens: 100, total_tokens: 100 },
      }),
    );
    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(0);
  });
});
