// Plugin-level concurrency gate shared across every Agent Board. The queue
// runner on each board competes for the same slots so the global cap holds
// regardless of how many boards are open. Cap changes never evict in-flight
// runs — shrinking the cap only refuses new acquires until enough release.
export class QueueSlotTracker {
  private readonly held = new Set<string>();
  private cap: number;

  constructor(cap: number) {
    this.cap = Math.max(1, cap);
  }

  capacity(): number {
    return this.cap;
  }

  occupied(): number {
    return this.held.size;
  }

  hasFreeSlot(): boolean {
    return this.held.size < this.cap;
  }

  isHeld(taskId: string): boolean {
    return this.held.has(taskId);
  }

  acquire(taskId: string): boolean {
    if (!this.hasFreeSlot()) return false;
    if (this.held.has(taskId)) return false;
    this.held.add(taskId);
    return true;
  }

  release(taskId: string): void {
    this.held.delete(taskId);
  }

  setCap(next: number): void {
    this.cap = Math.max(1, next);
  }
}
