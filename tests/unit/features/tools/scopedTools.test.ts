import { toolCapabilityId } from '../../../../src/features/agents/roster/rosterCapabilities';
import { getScopedTools, scopedToolKey } from '../../../../src/features/tools/scopedTools';
import type { LoadedTool } from '../../../../src/features/tools/toolTypes';

function tool(id: string, opts: { name?: string; error?: string; noModule?: boolean } = {}): LoadedTool {
  if (opts.noModule) {
    return { id, error: opts.error };
  }
  return {
    id,
    error: opts.error,
    module: {
      manifest: {
        name: opts.name ?? id,
        description: '',
        // The scoping logic only ever reads manifest.name, so a minimal cast keeps
        // the fixture focused without standing up a real zod schema.
        input: {} as never,
      },
      handler: () => ({ content: [{ type: 'text', text: '' }] }),
    },
  };
}

describe('getScopedTools', () => {
  const alpha = tool('alpha', { name: 'search_tasks' });
  const beta = tool('beta', { name: 'list_notes' });
  const errored = tool('gamma', { name: 'broken', error: 'boom' });
  const noModule = tool('delta', { noModule: true });

  const raw: LoadedTool[] = [alpha, errored, beta, noModule];

  it('returns all error-free, module-bearing tools when the grant is absent', () => {
    expect(getScopedTools(raw)).toEqual([alpha, beta]);
  });

  it('returns all error-free tools when the grant is empty', () => {
    expect(getScopedTools(raw, [])).toEqual([alpha, beta]);
  });

  it('keeps only tools whose capability id is in a partial grant', () => {
    const grant = [toolCapabilityId('search_tasks')];
    expect(getScopedTools(raw, grant)).toEqual([alpha]);
  });

  it('excludes errored and module-less tools even when granted', () => {
    const grant = [
      toolCapabilityId('broken'),
      toolCapabilityId('search_tasks'),
      toolCapabilityId('delta'),
    ];
    expect(getScopedTools(raw, grant)).toEqual([alpha]);
  });
});

describe('scopedToolKey', () => {
  const alpha = tool('a', { name: 'zebra' });
  const beta = tool('b', { name: 'apple' });
  const errored = tool('c', { name: 'broken', error: 'boom' });

  it('is sorted by tool name', () => {
    expect(scopedToolKey([alpha, beta])).toBe('apple,zebra');
  });

  it('is order-independent across input permutations', () => {
    expect(scopedToolKey([alpha, beta])).toBe(scopedToolKey([beta, alpha]));
  });

  it('is stable across calls', () => {
    expect(scopedToolKey([alpha, beta])).toBe(scopedToolKey([alpha, beta]));
  });

  it('excludes errored tools from the key', () => {
    expect(scopedToolKey([alpha, beta, errored])).toBe('apple,zebra');
  });

  it('respects the grant scope', () => {
    expect(scopedToolKey([alpha, beta], [toolCapabilityId('apple')])).toBe('apple');
  });
});
