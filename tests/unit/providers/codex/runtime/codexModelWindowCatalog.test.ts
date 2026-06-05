import {
  CODEX_DEFAULT_CONTEXT_WINDOW,
  codexModelContextWindow,
  codexModelPricing,
} from '../../../../../src/providers/codex/runtime/codexModelWindowCatalog';

describe('codexModelContextWindow', () => {
  it('exact-match returns the configured window (preserves the previous CODEX_CONTEXT_WINDOW_BY_MODEL values)', () => {
    expect(codexModelContextWindow('gpt-5.2')).toBe(400_000);
    expect(codexModelContextWindow('gpt-5.3-codex')).toBe(400_000);
    expect(codexModelContextWindow('gpt-5.3-codex-spark')).toBe(128_000);
  });

  it('returns 0 for unknown ids so the caller can flag non-authoritative windows', () => {
    expect(codexModelContextWindow('fake-codex-model')).toBe(0);
  });

  it('exposes CODEX_DEFAULT_CONTEXT_WINDOW = 200_000 for fallback callers', () => {
    expect(CODEX_DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });
});

describe('codexModelPricing', () => {
  it('returns null for unknown ids', () => {
    expect(codexModelPricing('fake-codex-model')).toBeNull();
  });

  it('returns null for known ids without pricing today', () => {
    expect(codexModelPricing('gpt-5.3-codex')).toBeNull();
  });
});
