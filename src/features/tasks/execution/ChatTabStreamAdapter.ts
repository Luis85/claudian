import type { StreamChunk } from '../../../core/types';
import type { ProviderStreamAdapter, StreamHandlers } from './ProviderStreamAdapter';

/**
 * The slice of a chat tab the adapter drives. Expressed structurally so this
 * tasks-feature module never imports chat types; the chat view's `TaskRunTabHandle`
 * satisfies it by shape.
 */
export interface StreamingTabHandle {
  subscribe(observer: (chunk: StreamChunk) => void): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}

/**
 * Provider-neutral stream adapter: maps the chat tab's normalized
 * {@link StreamChunk} flow onto the work-order runner's {@link StreamHandlers}.
 * One implementation covers every provider because each provider runtime already
 * normalizes its raw stream to `StreamChunk` before the feature layer sees it.
 */
export class ChatTabStreamAdapter implements ProviderStreamAdapter {
  constructor(private readonly handle: StreamingTabHandle) {}

  subscribe(handlers: StreamHandlers): () => void {
    let assistantContent = '';
    const toolNames = new Map<string, string>();
    return this.handle.subscribe((chunk) => {
      // Every chunk — including thinking/usage/subagent ones not mapped below —
      // counts as activity so the runner's stale check sees a live stream.
      handlers.onActivity?.();
      switch (chunk.type) {
        case 'text':
          assistantContent += chunk.content;
          handlers.onText(chunk.content);
          break;
        case 'tool_use':
          toolNames.set(chunk.id, chunk.name);
          handlers.onToolUse({ name: chunk.name, primaryArg: extractPrimaryArg(chunk.input) });
          break;
        case 'tool_result':
          handlers.onToolResult(toolNames.get(chunk.id) ?? chunk.id, !chunk.isError);
          break;
        case 'error':
          handlers.onError(chunk.content);
          break;
        case 'done':
          handlers.onEnd({ status: 'completed', finalAssistantContent: assistantContent });
          break;
        default:
          break;
      }
    });
  }

  sendFollowUp(content: string): Promise<void> {
    return this.handle.sendFollowUp(content);
  }

  cancel(): void {
    this.handle.cancel();
  }
}

/**
 * Best-effort one-line tool argument for the ledger, across all providers. Tool
 * inputs are already normalized, so the common keys (file path, command, search
 * pattern) cover Edit/Write/Read, Bash/exec/shell, and Grep/Glob alike.
 */
function extractPrimaryArg(input: Record<string, unknown>): string | null {
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.command === 'string') return input.command.slice(0, 60);
  if (typeof input.pattern === 'string') return input.pattern;
  return null;
}
