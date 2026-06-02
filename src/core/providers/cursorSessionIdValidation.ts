/**
 * Session ids land in disk path construction (~/.cursor/chats/<hash>/<sessionId>/...).
 * Reject anything that could escape the chats jail or contain control chars.
 * Cursor itself uses UUID-style ids; this is intentionally strict.
 */
const VALID_SESSION_ID = /^[A-Za-z0-9._-]+$/;
const DOTS_ONLY = /^\.+$/;

export function isValidCursorSessionId(sessionId: unknown): sessionId is string {
  if (typeof sessionId !== 'string') return false;
  if (sessionId.length === 0 || sessionId.length > 256) return false;
  // Reject "." or ".." (or any all-dots id): when joined into
  // `~/.cursor/chats/<hash>/<sessionId>` they collapse to the parent dir,
  // turning `deleteConversationSession` into "wipe every session for the workspace".
  if (DOTS_ONLY.test(sessionId)) return false;
  if (sessionId.includes('..')) return false;
  // Reject trailing dot: Win32 path handling silently trims trailing periods
  // (and spaces) from path components, so `"sess."` would resolve to the
  // sibling `"sess"` directory. Real Cursor session ids are UUID-style and
  // never end in `.`, so reject before the path join can alias.
  if (sessionId.endsWith('.')) return false;
  if (!VALID_SESSION_ID.test(sessionId)) return false;
  return true;
}
