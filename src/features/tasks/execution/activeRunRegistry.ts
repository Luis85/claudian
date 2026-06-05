/**
 * Process-wide set of work-order ids that currently have a live run, shared
 * across Agent Board view instances. Crash recovery consults this so it never
 * fails a run that a previous (closed-then-reopened) view is still driving.
 *
 * It resets naturally on a true plugin reload (a fresh module instance), which
 * is exactly the case where recovery SHOULD treat persisted running notes as
 * orphaned.
 */
export const sharedActiveRunIds = new Set<string>();
