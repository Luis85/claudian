// tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts
import {
  cursorModelContextWindow,
  cursorModelPricing,
} from '../../../../../src/providers/cursor/runtime/cursorModelWindowCatalog';

describe('cursorModelContextWindow', () => {
  it('returns exact-match windows for known ids', () => {
    expect(cursorModelContextWindow('gemini-2.5-pro')).toBe(1_000_000);
    expect(cursorModelContextWindow('gpt-5')).toBe(400_000);
    expect(cursorModelContextWindow('claude-sonnet-4')).toBe(200_000);
    expect(cursorModelContextWindow('composer-2')).toBe(200_000);
  });

  it('does not match by substring — composer-2-sonnet-research stays in the composer family', () => {
    // Regression: the old substring matcher would have hit "sonnet" first.
    expect(cursorModelContextWindow('composer-2-sonnet-research')).toBe(200_000);
  });

  it('returns 0 for unknown ids so the caller can flag non-authoritative windows', () => {
    expect(cursorModelContextWindow('totally-fake-model')).toBe(0);
  });
});

describe('cursorModelPricing', () => {
  it('returns null when pricing is not in the table', () => {
    expect(cursorModelPricing('totally-fake-model')).toBeNull();
  });
});
