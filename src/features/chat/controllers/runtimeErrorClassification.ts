/**
 * Provider-neutral runtime-error classification (UX-F/UX-J).
 *
 * Runtime `error` chunks carry only a free-form message string. This pure
 * function maps that string onto an actionable category so the chat surface can
 * render a guided recovery card (open settings / retry / login hint) instead of
 * bare error text. It is intentionally string/shape based and provider-agnostic
 * so it stays unit-testable with plain message inputs.
 *
 * Ordering matters: a missing CLI is the most actionable root cause and must win
 * over auth wording in the same message; context-overflow wording must win over
 * the generic fallback. The checks below run in that priority order.
 */

export type RuntimeErrorKind =
  | 'cli-not-found'
  | 'unauthenticated'
  | 'context-too-large'
  | 'generic';

// A missing/uninstalled CLI binary. Covers the runtimes' own "CLI not found"
// copy plus the raw spawn failures (`ENOENT`, `command not found`) that surface
// when the binary path is wrong.
const CLI_NOT_FOUND = [
  /\bcli not found\b/i,
  /\bcli is not installed\b/i,
  /\bcommand not found\b/i,
  /\benoent\b/i,
  /\bnot installed\b/i,
];

// Login / token / API-key failures. The provider runtimes fold these into
// generic start errors today (e.g. OpenCode's "Check the CLI path and login
// state"); this lifts them into a distinct guided state.
const UNAUTHENTICATED = [
  /\bunauthenticated\b/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /\bauthenticat/i, // authenticate / authentication / re-authenticate
  /\blogin state\b/i,
  /\b(?:please )?log ?in\b/i,
  /\bapi key\b/i,
  /\boauth\b/i,
];

// Token / context-window overflow. Points the user at trimming attachments and
// context rather than presenting an opaque token-count error.
const CONTEXT_TOO_LARGE = [
  /\bprompt is too long\b/i,
  /\bcontext (?:window|length)\b/i,
  /\bcontext_length_exceeded\b/i,
  /\bmaximum context\b/i,
  /\bcontext limit\b/i,
  /\bmax(?:imum)? (?:number of )?tokens\b/i,
  /\btoo many tokens\b/i,
];

function matchesAny(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

export function classifyRuntimeError(content: string): RuntimeErrorKind {
  const text = content ?? '';

  if (matchesAny(text, CLI_NOT_FOUND)) {
    return 'cli-not-found';
  }
  if (matchesAny(text, CONTEXT_TOO_LARGE)) {
    return 'context-too-large';
  }
  if (matchesAny(text, UNAUTHENTICATED)) {
    return 'unauthenticated';
  }
  return 'generic';
}
