import type {
  FollowUpOutcome,
  ProviderStreamAdapter,
  StreamHandlers,
  StreamToolUse,
} from '../../src/features/tasks/execution/ProviderStreamAdapter';

type EndPayload = Parameters<StreamHandlers['onEnd']>[0];

export class SyntheticStreamAdapter implements ProviderStreamAdapter {
  followUps: string[] = [];
  canceled = false;
  private handlers: StreamHandlers | null = null;
  private endResolvers: Array<(payload: EndPayload) => void> = [];
  private followUpResolvers: Array<(outcome: FollowUpOutcome | void) => void> = [];

  subscribe(handlers: StreamHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  sendFollowUp(content: string): Promise<FollowUpOutcome | void> {
    this.followUps.push(content);
    // Stays pending until settleFollowUp() so a test can sequence the turn's
    // chunks (re-pause, late done) before reporting the settlement outcome.
    return new Promise((resolve) => { this.followUpResolvers.push(resolve); });
  }

  /** Settle the oldest pending sendFollowUp with the given outcome (omit for "no outcome"). */
  settleFollowUp(outcome?: FollowUpOutcome): void {
    const resolve = this.followUpResolvers.shift();
    resolve?.(outcome);
  }

  cancel(): void {
    this.canceled = true;
  }

  emitText(chunk: string): void { this.handlers?.onText(chunk); }
  emitToolUse(tool: StreamToolUse): void { this.handlers?.onToolUse(tool); }
  emitToolResult(name: string, ok: boolean): void { this.handlers?.onToolResult(name, ok); }
  emitError(error: string): void { this.handlers?.onError(error); }
  emitEnd(payload: EndPayload): void {
    this.handlers?.onEnd(payload);
    // Mirror reality: the chat send promise (and thus the run handle's terminal)
    // resolves only after the stream loop ends, i.e. after the `done` chunk.
    for (const resolve of this.endResolvers.splice(0)) resolve(payload);
  }

  /** Resolves the next time {@link emitEnd} is called — for wiring a handle terminal. */
  whenEnded(): Promise<EndPayload> {
    return new Promise((resolve) => { this.endResolvers.push(resolve); });
  }
}
