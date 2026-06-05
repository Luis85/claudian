import type { StreamChunk } from '../../../../../src/core/types';
import {
  ChatTabStreamAdapter,
  type StreamingTabHandle,
} from '../../../../../src/features/tasks/execution/ChatTabStreamAdapter';
import type { StreamHandlers } from '../../../../../src/features/tasks/execution/ProviderStreamAdapter';

class FakeTabHandle implements StreamingTabHandle {
  followUps: string[] = [];
  canceled = false;
  private observer: ((chunk: StreamChunk) => void) | null = null;

  subscribe(observer: (chunk: StreamChunk) => void): () => void {
    this.observer = observer;
    return () => {
      if (this.observer === observer) this.observer = null;
    };
  }
  async sendFollowUp(content: string): Promise<void> {
    this.followUps.push(content);
  }
  cancel(): void {
    this.canceled = true;
  }
  emit(chunk: StreamChunk): void {
    this.observer?.(chunk);
  }
}

function captureHandlers() {
  const calls: Array<[string, unknown]> = [];
  const handlers: StreamHandlers = {
    onText: (c) => calls.push(['text', c]),
    onToolUse: (t) => calls.push(['tool', t]),
    onToolResult: (n, ok) => calls.push(['result', { name: n, ok }]),
    onError: (e) => calls.push(['error', e]),
    onEnd: (p) => calls.push(['end', p]),
  };
  return { calls, handlers };
}

describe('ChatTabStreamAdapter', () => {
  it('maps text chunks to onText and accumulates final content for onEnd', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);

    tab.emit({ type: 'text', content: 'Hello ' });
    tab.emit({ type: 'text', content: 'world' });
    tab.emit({ type: 'done' });

    expect(calls).toEqual([
      ['text', 'Hello '],
      ['text', 'world'],
      ['end', { status: 'completed', finalAssistantContent: 'Hello world' }],
    ]);
  });

  it('maps tool_use to onToolUse with a best-effort primary arg', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);

    tab.emit({ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/foo.ts' } });
    tab.emit({ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'a'.repeat(100) } });
    tab.emit({ type: 'tool_use', id: 't3', name: 'Grep', input: { pattern: 'needle' } });

    expect(calls[0]).toEqual(['tool', { name: 'Edit', primaryArg: 'src/foo.ts' }]);
    expect(calls[1]).toEqual(['tool', { name: 'Bash', primaryArg: 'a'.repeat(60) }]);
    expect(calls[2]).toEqual(['tool', { name: 'Grep', primaryArg: 'needle' }]);
  });

  it('resolves tool_result names from prior tool_use and reports ok/error', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);

    tab.emit({ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts' } });
    tab.emit({ type: 'tool_result', id: 't1', content: 'ok' });
    tab.emit({ type: 'tool_result', id: 'unknown', content: 'boom', isError: true });

    expect(calls).toContainEqual(['result', { name: 'Edit', ok: true }]);
    expect(calls).toContainEqual(['result', { name: 'unknown', ok: false }]);
  });

  it('reports activity for every chunk, including ones it does not map', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    let activity = 0;
    const handlers: StreamHandlers = {
      onText: () => {},
      onToolUse: () => {},
      onToolResult: () => {},
      onError: () => {},
      onEnd: () => {},
      onActivity: () => { activity += 1; },
    };
    adapter.subscribe(handlers);

    tab.emit({ type: 'thinking', content: 'reasoning…' });
    tab.emit({ type: 'tool_output', id: 't1', content: 'partial' });
    tab.emit({ type: 'text', content: 'hi' });

    expect(activity).toBe(3);
  });

  it('maps error chunks to onError', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);

    tab.emit({ type: 'error', content: 'kaboom' });
    expect(calls).toEqual([['error', 'kaboom']]);
  });

  it('forwards follow-ups and cancellation, and unsubscribes', () => {
    const tab = new FakeTabHandle();
    const adapter = new ChatTabStreamAdapter(tab);
    const { calls, handlers } = captureHandlers();
    const unsubscribe = adapter.subscribe(handlers);

    void adapter.sendFollowUp('reply');
    adapter.cancel();
    expect(tab.followUps).toEqual(['reply']);
    expect(tab.canceled).toBe(true);

    unsubscribe();
    tab.emit({ type: 'text', content: 'after' });
    expect(calls).toEqual([]);
  });
});
