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

export interface ProviderStreamAdapter {
  subscribe(handlers: StreamHandlers): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}
