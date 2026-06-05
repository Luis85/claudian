import type {
  ProviderStreamAdapter,
  StreamHandlers,
  StreamToolUse,
} from '../../src/features/tasks/execution/ProviderStreamAdapter';

type EndPayload = Parameters<StreamHandlers['onEnd']>[0];

export class SyntheticStreamAdapter implements ProviderStreamAdapter {
  followUps: string[] = [];
  canceled = false;
  private handlers: StreamHandlers | null = null;

  subscribe(handlers: StreamHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  async sendFollowUp(content: string): Promise<void> {
    this.followUps.push(content);
  }

  cancel(): void {
    this.canceled = true;
  }

  emitText(chunk: string): void { this.handlers?.onText(chunk); }
  emitToolUse(tool: StreamToolUse): void { this.handlers?.onToolUse(tool); }
  emitToolResult(name: string, ok: boolean): void { this.handlers?.onToolResult(name, ok); }
  emitError(error: string): void { this.handlers?.onError(error); }
  emitEnd(payload: EndPayload): void { this.handlers?.onEnd(payload); }
}
