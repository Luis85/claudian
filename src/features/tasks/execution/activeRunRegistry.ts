import type { RunSession } from './RunSession';

/**
 * Process-wide registry of live work-order runs, shared across Agent Board view
 * instances so a board reopened mid-run can still reply to, approve, stop, and
 * (not) orphan a run that a previous view started. Exposes the live session, not
 * just the id, so reply/approve/reject routing works across views.
 *
 * It resets on a true plugin reload (a fresh module instance) — exactly when
 * crash recovery should treat persisted running notes as orphaned.
 */
export class ActiveRunRegistry {
  // Reserved between the coordinator's guard check and the run ending, covering
  // the window before the session exists (so dedup/recovery see the id).
  private readonly reserved = new Set<string>();
  private readonly sessions = new Map<string, RunSession>();

  /** Reserve an id from the guard check until the run ends. */
  reserve(id: string): void {
    this.reserved.add(id);
  }

  /** Bind the live session once it exists, enabling reply/approve/reject/stop routing. */
  bind(id: string, session: RunSession): void {
    this.sessions.set(id, session);
  }

  /** Release everything for an id when the run ends. */
  release(id: string): void {
    this.reserved.delete(id);
    this.sessions.delete(id);
  }

  /** Whether a run is reserved or live for this id (concurrency guard + crash recovery). */
  has(id: string): boolean {
    return this.reserved.has(id) || this.sessions.has(id);
  }

  /** The live session for this id, if one is bound. */
  getSession(id: string): RunSession | undefined {
    return this.sessions.get(id);
  }

  /** Clears all state (used by tests). */
  clear(): void {
    this.reserved.clear();
    this.sessions.clear();
  }
}

export const sharedRunRegistry = new ActiveRunRegistry();
