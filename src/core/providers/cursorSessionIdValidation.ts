/**
 * Session ids land in disk path construction (~/.cursor/chats/<hash>/<sessionId>/...).
 * Reject anything that could escape the chats jail or contain control chars.
 * Cursor itself uses UUID-style ids; this is intentionally strict.
 */
const VALID_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function isValidCursorSessionId(sessionId: unknown): sessionId is string {
  if (typeof sessionId !== 'string') return false;
  if (sessionId.length === 0 || sessionId.length > 256) return false;
  if (sessionId.includes('..')) return false;
  if (!VALID_SESSION_ID.test(sessionId)) return false;
  return true;
}
