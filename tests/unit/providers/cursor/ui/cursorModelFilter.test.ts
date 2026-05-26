import { matchesCursorModelQuery } from '@/providers/cursor/ui/cursorModelFilter';

describe('matchesCursorModelQuery', () => {
  it('matches everything for an empty or whitespace query', () => {
    expect(matchesCursorModelQuery('gpt-5.5', '')).toBe(true);
    expect(matchesCursorModelQuery('composer-2', '   ')).toBe(true);
  });

  it('matches case-insensitively against the raw id', () => {
    expect(matchesCursorModelQuery('composer-2-fast', 'FAST')).toBe(true);
    expect(matchesCursorModelQuery('composer-2-fast', 'comp')).toBe(true);
  });

  it('matches against the pretty label', () => {
    // formatCursorModelLabel('gpt-5.5') === 'GPT-5.5'
    expect(matchesCursorModelQuery('gpt-5.5', 'gpt-5')).toBe(true);
    // formatCursorModelLabel('composer-2') === 'Composer 2'
    expect(matchesCursorModelQuery('composer-2', 'composer 2')).toBe(true);
  });

  it('returns false when neither id nor label contains the query', () => {
    expect(matchesCursorModelQuery('gpt-5.5', 'gemini')).toBe(false);
    expect(matchesCursorModelQuery('composer-2', 'sonnet')).toBe(false);
  });

  it('trims the query before matching', () => {
    expect(matchesCursorModelQuery('gpt-5.5', '  gpt  ')).toBe(true);
  });
});
