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

  it('rejects pure-dot ids that would collapse to the parent directory', () => {
    // `.` joined into `~/.cursor/chats/<hash>/<sessionId>` collapses to the
    // workspace chat dir itself — a deletion target for `deleteConversationSession`
    // would wipe every session for the vault. Reject `.` / `..` / `...` outright.
    expect(isValidCursorSessionId('.')).toBe(false);
    expect(isValidCursorSessionId('..')).toBe(false);
    expect(isValidCursorSessionId('...')).toBe(false);
    expect(isValidCursorSessionId('....')).toBe(false);
  });

  it('rejects trailing-dot ids that Win32 path handling would alias to a sibling directory', () => {
    // On Windows, `~/.cursor/chats/<hash>/sess.` is normalized to
    // `~/.cursor/chats/<hash>/sess`. Without this guard, a corrupted/imported
    // chatSessionId of "sess." would silently delete the unrelated "sess"
    // session's transcript.
    expect(isValidCursorSessionId('sess.')).toBe(false);
    expect(isValidCursorSessionId('abc-123-def.')).toBe(false);
    expect(isValidCursorSessionId('a1b2c3d4-e5f6-7890-abcd-1234567890ab.')).toBe(false);
    // Leading dot still allowed (Win32 doesn't trim leading dots; UUID-style
    // ids don't have them but a legacy non-UUID id of ".foo" is structurally fine).
    expect(isValidCursorSessionId('.foo')).toBe(true);
  });
});
