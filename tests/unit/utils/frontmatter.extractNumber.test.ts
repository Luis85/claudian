import { extractNumber } from '@/utils/frontmatter';

describe('extractNumber', () => {
  it('returns the number for a numeric value', () => {
    expect(extractNumber({ rank: 3 }, 'rank')).toBe(3);
  });

  it('returns the number for a numeric string', () => {
    expect(extractNumber({ rank: '4' }, 'rank')).toBe(4);
  });

  it('returns undefined for missing key', () => {
    expect(extractNumber({}, 'rank')).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(extractNumber({ rank: 'high' }, 'rank')).toBeUndefined();
  });

  it('returns undefined for boolean', () => {
    expect(extractNumber({ rank: true }, 'rank')).toBeUndefined();
  });

  it('returns undefined for null and array', () => {
    expect(extractNumber({ rank: null }, 'rank')).toBeUndefined();
    expect(extractNumber({ rank: [1, 2] }, 'rank')).toBeUndefined();
  });
});
