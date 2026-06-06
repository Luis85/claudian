export interface StreamToolUse {
  name: string;
  primaryArg: string | null;
}

export interface StreamHandlers {
  onText(chunk: string): void;
  onToolUse(tool: StreamToolUse): void;
  onToolResult(name: string, ok: boolean): void;
  onError(error: string): void;
  onEnd(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): void;
  /**
   * Any stream activity (including chunks not mapped above, e.g. thinking/usage/
   * subagent). Lets the runner treat ongoing-but-quiet streams as alive so the
   * stale-heartbeat check doesn't cancel them.
   */
  onActivity?(): void;
}

/**
 * Settlement of a follow-up turn, reported back to the runner so it can finish a
 * turn that emits no stream `done`. Returned (rather than signalled via a stream
 * chunk) so it is tied to this specific send — a late `done` from an earlier
 * turn cannot be mistaken for this turn's end. `void` means the adapter does not
 * report outcomes (the runner then relies on stream chunks; used by tests).
 */
export type FollowUpOutcome =
  | { ok: true; finalAssistantContent: string }
  | { ok: false; error: string };

export interface ProviderStreamAdapter {
  subscribe(handlers: StreamHandlers): () => void;
  /** Resolves when the follow-up turn settles; see {@link FollowUpOutcome}. */
  sendFollowUp(content: string): Promise<FollowUpOutcome | void>;
  cancel(): void;
}
