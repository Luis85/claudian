import { Readable, Writable } from 'stream';

import {
  JsonRpcErrorResponse,
  type JsonRpcMessageStreams,
  JsonRpcStdioClient,
  JsonRpcTransportClosedError,
} from '@/core/transport/JsonRpcStdioClient';

function makeStreams(): {
  streams: JsonRpcMessageStreams;
  pushLine: (msg: unknown) => void;
  written: () => Array<Record<string, unknown>>;
  fireClose: (error?: Error) => void;
} {
  const input = new Readable({ read() {} });
  const writes: string[] = [];
  const output = new Writable({
    write(chunk, _enc, cb) { writes.push(chunk.toString()); cb(); },
  });
  let closeListener: ((error?: Error) => void) | null = null;
  const streams: JsonRpcMessageStreams = {
    input,
    output,
    onClose: (listener) => { closeListener = listener; return () => { closeListener = null; }; },
  };
  return {
    streams,
    pushLine: (msg) => input.push(`${JSON.stringify(msg)}\n`),
    written: () => writes.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    fireClose: (error) => closeListener?.(error),
  };
}

describe('JsonRpcStdioClient', () => {
  afterEach(() => jest.useRealTimers());

  it('correlates a response to its request by id', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    const p = client.request('ping', { a: 1 });
    expect(h.written()[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ping', params: { a: 1 } });
    h.pushLine({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('rejects with JsonRpcErrorResponse carrying method/code/data', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    const p = client.request('boom');
    h.pushLine({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope', data: { x: 1 } } });
    await expect(p).rejects.toMatchObject({
      name: 'JsonRpcErrorResponse', method: 'boom', code: -32000, message: 'nope', data: { x: 1 },
    });
    expect(await p.catch((e) => e)).toBeInstanceOf(JsonRpcErrorResponse);
  });

  it('times out a request', async () => {
    jest.useFakeTimers();
    const client = new JsonRpcStdioClient(makeStreams().streams);
    const p = client.request('slow', undefined, { timeoutMs: 1000 });
    jest.advanceTimersByTime(1000);
    await expect(p).rejects.toThrow('Request timeout: slow (1000ms)');
  });

  it('aborts a request via AbortSignal', async () => {
    const controller = new AbortController();
    const client = new JsonRpcStdioClient(makeStreams().streams);
    const p = client.request('cancelable', undefined, { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow('Request aborted: cancelable');
  });

  it('rejects all pending requests on dispose', async () => {
    const client = new JsonRpcStdioClient(makeStreams().streams);
    const a = client.request('one');
    const b = client.request('two');
    client.dispose(new Error('shutting down'));
    await expect(a).rejects.toThrow('shutting down');
    await expect(b).rejects.toThrow('shutting down');
  });

  it('rejects pending requests when the stream closes', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    const p = client.request('orphaned');
    h.fireClose(new Error('process exited'));
    await expect(p).rejects.toThrow('process exited');
  });

  it('dispatches notifications to every handler and supports unsubscribe', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    client.start();
    const a = jest.fn();
    const b = jest.fn();
    client.onNotification('event', a);
    const offB = client.onNotification('event', b);
    h.pushLine({ jsonrpc: '2.0', method: 'event', params: { n: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).toHaveBeenCalledWith({ n: 1 });
    offB();
    h.pushLine({ jsonrpc: '2.0', method: 'event', params: { n: 2 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('routes a server request to its handler (with id) and replies with the result', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    client.start();
    const handler = jest.fn(async (params: unknown, id: unknown) => ({ echoed: params, forId: id }));
    client.onRequest('ask', handler);
    h.pushLine({ jsonrpc: '2.0', id: 7, method: 'ask', params: { q: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledWith({ q: 1 }, 7);
    expect(h.written().find((m) => m.id === 7)).toMatchObject({ id: 7, result: { echoed: { q: 1 }, forId: 7 } });
  });

  it('replies -32601 for an unhandled server request', async () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    client.start();
    h.pushLine({ jsonrpc: '2.0', id: 9, method: 'unknown', params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.written().find((m) => m.id === 9)).toMatchObject({ id: 9, error: { code: -32601 } });
  });

  it('ignores malformed and empty lines', () => {
    const h = makeStreams();
    const client = new JsonRpcStdioClient(h.streams);
    client.start();
    (h.streams.input as Readable).push('not json\n');
    (h.streams.input as Readable).push('\n');
    // no throw, no pending effect
    expect(client.isClosed).toBe(false);
  });

  it('throws on request after dispose and no-ops notify', async () => {
    const client = new JsonRpcStdioClient(makeStreams().streams);
    client.dispose();
    await expect(client.request('x')).rejects.toBeInstanceOf(JsonRpcTransportClosedError);
    expect(() => client.notify('y')).not.toThrow();
  });
});
