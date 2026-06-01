import type { ToolCallInfo } from '@/core/types';
import { ToolCallIndex } from '@/features/chat/controllers/toolCallIndex';

function tool(id: string, name = 'Read'): ToolCallInfo {
  return { id, name, input: {}, status: 'completed' };
}

describe('ToolCallIndex', () => {
  it('resolves an indexed tool call without consulting the array', () => {
    const index = new ToolCallIndex();
    const a = tool('a');
    index.add(a);

    // Pass an empty array: a hit must come from the map, not the fallback.
    expect(index.get('a', [])).toBe(a);
  });

  it('falls back to the backing array when an id was never indexed', () => {
    const index = new ToolCallIndex();
    const a = tool('a');
    const b = tool('b');
    index.add(a);

    expect(index.get('b', [a, b])).toBe(b);
  });

  it('returns undefined when an id is in neither the map nor the array', () => {
    const index = new ToolCallIndex();
    index.add(tool('a'));

    expect(index.get('missing', [tool('a')])).toBeUndefined();
    expect(index.get('missing', undefined)).toBeUndefined();
  });

  it('reindex replaces the map contents wholesale', () => {
    const index = new ToolCallIndex();
    index.add(tool('old'));

    const fresh = [tool('x'), tool('y')];
    index.reindex(fresh);

    // 'old' is gone from the map; with an empty fallback it cannot resolve.
    expect(index.get('old', [])).toBeUndefined();
    expect(index.get('x', [])).toBe(fresh[0]);
    expect(index.get('y', [])).toBe(fresh[1]);
  });

  it('reindex with undefined clears the map', () => {
    const index = new ToolCallIndex();
    index.add(tool('a'));
    index.reindex(undefined);

    expect(index.get('a', [])).toBeUndefined();
  });

  it('clear empties the map but leaves array fallback intact', () => {
    const index = new ToolCallIndex();
    const a = tool('a');
    index.add(a);
    index.clear();

    expect(index.get('a', [])).toBeUndefined();
    expect(index.get('a', [a])).toBe(a);
  });

  it('add updates the entry for a reused id', () => {
    const index = new ToolCallIndex();
    const first = tool('a');
    const second = tool('a');
    index.add(first);
    index.add(second);

    expect(index.get('a', [])).toBe(second);
  });
});
