import type { StreamChunk } from '@/core/types';
import {
  AcpToolStreamAdapter,
  type AcpToolStreamPresentationAdapter,
} from '@/providers/acp/AcpToolStreamAdapter';
import type { AcpToolCall, AcpToolCallUpdate } from '@/providers/acp/types';

interface PresentationCalls {
  normalizeToolInput: jest.Mock;
  normalizeToolName: jest.Mock;
  normalizeToolUseResult: jest.Mock;
  resolveRawToolName: jest.Mock;
}

function makePresentation(): {
  adapter: AcpToolStreamPresentationAdapter;
  calls: PresentationCalls;
} {
  const calls: PresentationCalls = {
    normalizeToolInput: jest.fn(
      (_raw: string | undefined, input: Record<string, unknown>) => ({
        ...input,
        normalized: true,
      }),
    ),
    normalizeToolName: jest.fn((raw: string | undefined) => `norm:${raw ?? '<unset>'}`),
    normalizeToolUseResult: jest.fn(
      (_raw: string | undefined, input: Record<string, unknown>, rawOutput: unknown) =>
        input.expectResult ? { content: String(rawOutput ?? '') } : undefined,
    ),
    // Fall back to current name if no kind/title provided, otherwise prefer
    // kind. Lets tests prove the adapter consults resolveRawToolName every
    // time without mocking the whole normalization layer.
    resolveRawToolName: jest.fn(
      (current: string | undefined, update: { kind?: string | null; title?: string | null }) => {
        if (update.kind) return String(update.kind);
        if (update.title) return String(update.title);
        return current ?? '';
      },
    ),
  };
  return {
    adapter: {
      normalizeToolInput: calls.normalizeToolInput,
      normalizeToolName: calls.normalizeToolName,
      normalizeToolUseResult: calls.normalizeToolUseResult,
      resolveRawToolName: calls.resolveRawToolName,
    } as unknown as AcpToolStreamPresentationAdapter,
    calls,
  };
}

function toolCall(over: Partial<AcpToolCall> = {}): AcpToolCall {
  return {
    title: 'untitled',
    toolCallId: 'tc-1',
    ...over,
  };
}

function toolCallUpdate(over: Partial<AcpToolCallUpdate> = {}): AcpToolCallUpdate {
  return {
    toolCallId: 'tc-1',
    ...over,
  };
}

describe('AcpToolStreamAdapter', () => {
  describe('normalizeToolCall', () => {
    it('passes chunks through unchanged for types other than tool_use/tool_result', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const chunks: StreamChunk[] = [
        { type: 'text', content: 'hi' },
        { type: 'thinking', content: 'ponder' },
        { type: 'done' },
      ];
      const result = stream.normalizeToolCall(toolCall({ kind: 'read' }), chunks);
      expect(result).toEqual(chunks);
    });

    it('replaces tool_use input and name from the normalized state', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const result = stream.normalizeToolCall(
        toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }),
        [{ type: 'tool_use', id: 'tc-1', name: 'unused', input: { unused: true } }],
      );
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'tc-1',
          name: 'norm:edit',
          input: { file: 'a.md', normalized: true },
        },
      ]);
    });

    it('treats non-object rawInput (string, array, null) as an empty merge source', () => {
      // Each case still produces a normalizeToolInput call; the merge source is
      // {} so the resulting state.input only carries normalizer-added fields.
      const cases: unknown[] = ['ignored', ['a'], null];
      for (const raw of cases) {
        const { adapter } = makePresentation();
        const stream = new AcpToolStreamAdapter(adapter);
        const [chunk] = stream.normalizeToolCall(
          toolCall({ kind: 'search', rawInput: raw }),
          [{ type: 'tool_use', id: 'tc-1', name: 'x', input: {} }],
        );
        expect(chunk).toEqual({
          type: 'tool_use',
          id: 'tc-1',
          name: 'norm:search',
          input: { normalized: true },
        });
      }
    });

    it('attaches toolUseResult on tool_result chunks when the adapter returns one', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const [chunk] = stream.normalizeToolCall(
        toolCall({ kind: 'read', rawInput: { expectResult: true }, rawOutput: 'payload' }),
        [{ type: 'tool_result', id: 'tc-1', content: 'orig' }],
      );
      expect(chunk).toEqual({
        type: 'tool_result',
        id: 'tc-1',
        content: 'orig',
        toolUseResult: { content: 'payload' },
      });
    });

    it('leaves tool_result chunks unchanged when the adapter returns undefined', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const input: StreamChunk[] = [{ type: 'tool_result', id: 'tc-1', content: 'orig' }];
      const [chunk] = stream.normalizeToolCall(
        toolCall({ kind: 'read', rawInput: { expectResult: false } }),
        input,
      );
      expect(chunk).toEqual(input[0]);
    });

    it('passes rawOutput from the tool call into normalizeToolUseResult', () => {
      const { adapter, calls } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(
        toolCall({ kind: 'read', rawInput: { expectResult: true }, rawOutput: { v: 1 } }),
        [{ type: 'tool_result', id: 'tc-1', content: '' }],
      );
      expect(calls.normalizeToolUseResult).toHaveBeenCalledWith(
        'read',
        { expectResult: true, normalized: true },
        { v: 1 },
      );
    });
  });

  describe('normalizeToolCallUpdate', () => {
    it('injects a synthetic tool_use chunk when rawInput is defined, before the original chunks', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const result = stream.normalizeToolCallUpdate(
        toolCallUpdate({ kind: 'edit', rawInput: { file: 'a.md' } }),
        [{ type: 'text', content: 'tail' }],
      );
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'tc-1',
          name: 'norm:edit',
          input: { file: 'a.md', normalized: true },
        },
        { type: 'text', content: 'tail' },
      ]);
    });

    it('does not inject a synthetic tool_use chunk when rawInput is undefined', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      // Seed state so the update has a tool entry to update.
      stream.normalizeToolCall(toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }), []);
      const result = stream.normalizeToolCallUpdate(toolCallUpdate({ kind: 'edit' }), [
        { type: 'text', content: 'tail' },
      ]);
      expect(result).toEqual([{ type: 'text', content: 'tail' }]);
    });

    it('still injects a synthetic tool_use chunk when rawInput is explicitly null', () => {
      // Adapter uses `!== undefined` as the gate, so null counts as "defined"
      // and produces a synthetic chunk even though it merges as {}.
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const result = stream.normalizeToolCallUpdate(
        toolCallUpdate({ kind: 'edit', rawInput: null }),
        [],
      );
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'tc-1',
          name: 'norm:edit',
          input: { normalized: true },
        },
      ]);
    });

    it('merges new rawInput fields into the existing state (additive)', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }), []);
      const [synthetic] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ rawInput: { content: 'x' } }),
        [],
      );
      expect(synthetic).toEqual({
        type: 'tool_use',
        id: 'tc-1',
        name: 'norm:edit',
        input: { file: 'a.md', content: 'x', normalized: true },
      });
    });

    it('lets new rawInput keys overwrite prior values', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }), []);
      const [synthetic] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ rawInput: { file: 'b.md' } }),
        [],
      );
      expect(synthetic).toMatchObject({
        input: expect.objectContaining({ file: 'b.md' }),
      });
    });

    it('uses the most recent state on chunks that follow the synthetic injection', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const result = stream.normalizeToolCallUpdate(
        toolCallUpdate({ kind: 'edit', rawInput: { file: 'a.md' } }),
        [{ type: 'tool_use', id: 'tc-1', name: 'stale', input: { stale: true } }],
      );
      // Both the synthetic and the trailing tool_use chunk reflect state.
      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({ name: 'norm:edit', input: { file: 'a.md', normalized: true } });
    });

    it('passes rawOutput from the update into normalizeToolUseResult for tool_result chunks', () => {
      const { adapter, calls } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'read', rawInput: { expectResult: true } }), []);
      stream.normalizeToolCallUpdate(toolCallUpdate({ rawOutput: 'updated-output' }), [
        { type: 'tool_result', id: 'tc-1', content: '' },
      ]);
      const lastCall = calls.normalizeToolUseResult.mock.calls.at(-1);
      expect(lastCall).toEqual(['read', { expectResult: true, normalized: true }, 'updated-output']);
    });

    it('consults resolveRawToolName on every update so name resolution stays delegated', () => {
      const { adapter, calls } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'read' }), []);
      stream.normalizeToolCallUpdate(toolCallUpdate({ kind: 'edit' }), []);
      expect(calls.resolveRawToolName).toHaveBeenCalledTimes(2);
      // Second call gets the prior rawName ('read') as the `current` argument.
      expect(calls.resolveRawToolName.mock.calls[1][0]).toBe('read');
    });
  });

  describe('state lifecycle', () => {
    it('persists state across multiple updates for the same toolCallId', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }), []);
      stream.normalizeToolCallUpdate(toolCallUpdate({ rawInput: { line: 1 } }), []);
      const [synthetic] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ rawInput: { col: 2 } }),
        [],
      );
      expect(synthetic).toMatchObject({
        input: expect.objectContaining({ file: 'a.md', line: 1, col: 2 }),
      });
    });

    it('keeps independent state per toolCallId', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(
        toolCall({ toolCallId: 'a', kind: 'edit', rawInput: { file: 'a.md' } }),
        [],
      );
      stream.normalizeToolCall(
        toolCall({ toolCallId: 'b', kind: 'read', rawInput: { file: 'b.md' } }),
        [],
      );
      const [a] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ toolCallId: 'a', rawInput: { mark: 'A' } }),
        [],
      );
      const [b] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ toolCallId: 'b', rawInput: { mark: 'B' } }),
        [],
      );
      expect(a).toMatchObject({ id: 'a', input: expect.objectContaining({ file: 'a.md', mark: 'A' }) });
      expect(b).toMatchObject({ id: 'b', input: expect.objectContaining({ file: 'b.md', mark: 'B' }) });
    });

    it('reset() clears every prior state so updates start from a blank slate', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      stream.normalizeToolCall(toolCall({ kind: 'edit', rawInput: { file: 'a.md' } }), []);
      stream.reset();
      const [synthetic] = stream.normalizeToolCallUpdate(
        toolCallUpdate({ rawInput: { only: 'now' } }),
        [],
      );
      // After reset the prior `file: 'a.md'` is gone; only the new rawInput
      // keys (plus normalizer-added fields) survive.
      expect(synthetic).toMatchObject({ input: { only: 'now', normalized: true } });
      expect((synthetic as Extract<StreamChunk, { type: 'tool_use' }>).input.file).toBeUndefined();
    });

    it('treats updates to an unknown toolCallId as fresh state without throwing', () => {
      const { adapter } = makePresentation();
      const stream = new AcpToolStreamAdapter(adapter);
      const result = stream.normalizeToolCallUpdate(
        toolCallUpdate({ toolCallId: 'never-seen', kind: 'edit', rawInput: { fresh: 1 } }),
        [],
      );
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'never-seen',
          name: 'norm:edit',
          input: { fresh: 1, normalized: true },
        },
      ]);
    });
  });

  // Cancellation: AcpToolStreamAdapter is synchronous and has no I/O or
  // AbortSignal in its API. Cancellation belongs at the consumer of the
  // resulting chunk stream, not inside the normalizer.
});
