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
}

export interface ProviderStreamAdapter {
  subscribe(handlers: StreamHandlers): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}
