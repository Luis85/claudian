import { formatTokens } from '../../../../../src/features/chat/ui/InputToolbar';

describe('formatTokens', () => {
  it('shows 0 for zero, negative, and non-finite values', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0');
  });
  it('shows raw integers under 1k', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });
  it('shows one-decimal k for 4-digit values', () => {
    expect(formatTokens(1300)).toBe('1.3k');
    expect(formatTokens(9999)).toBe('10.0k');
  });
  it('shows integer k for values >= 10k', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(13_499)).toBe('13k');
    expect(formatTokens(200_000)).toBe('200k');
  });
  it('shows M for values >= 1M', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });
});
