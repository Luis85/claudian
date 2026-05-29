export type EventMap = Record<string, unknown>;
export type EventHandler<P> = (payload: P) => void;

/**
 * Minimal typed, synchronous, in-process event bus.
 * No Obsidian dependency so it can be unit-tested in isolation.
 */
export class EventBus<M extends Record<string, any> = Record<string, unknown>> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<never>>>();

  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<K extends keyof M>(event: K, ...args: M[K] extends void ? [] : [M[K]]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    const payload = (args.length > 0 ? args[0] : undefined) as M[K];
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<M[K]>)(payload);
      } catch {
        // Swallow so one bad subscriber cannot break others or the producer.
        // TODO: route to logger once available.
      }
    }
  }
}
