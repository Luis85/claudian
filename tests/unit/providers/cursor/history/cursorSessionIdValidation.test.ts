import { isValidCursorSessionId } from '@/core/providers/cursorSessionIdValidation';

describe('isValidCursorSessionId', () => {
  it('accepts UUID-like ids', () => {
    expect(isValidCursorSessionId('abc-123-def_xyz')).toBe(true);
    expect(isValidCursorSessionId('a1b2c3d4-e5f6-7890-abcd-1234567890ab')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isValidCursorSessionId('../../evil')).toBe(false);
    expect(isValidCursorSessionId('..\\evil')).toBe(false);
    expect(isValidCursorSessionId('foo/bar')).toBe(false);
    expect(isValidCursorSessionId('foo\\bar')).toBe(false);
  });

  it('rejects empty / null / non-string', () => {
    expect(isValidCursorSessionId('')).toBe(false);
    expect(isValidCursorSessionId(null as unknown as string)).toBe(false);
    expect(isValidCursorSessionId(undefined as unknown as string)).toBe(false);
    expect(isValidCursorSessionId(123 as unknown as string)).toBe(false);
  });

  it('rejects control characters and absolute paths', () => {
    expect(isValidCursorSessionId(' ')).toBe(false);
    expect(isValidCursorSessionId('/etc')).toBe(false);
    expect(isValidCursorSessionId('C:\\Windows')).toBe(false);
  });
});
