import {
  mapCursorToolName,
  normalizeCursorPersistedToolCall,
  normalizeCursorPersistedToolResult,
  normalizeCursorToolCompletion,
  normalizeCursorToolStart,
  readCursorToolEnvelope,
  resolveCursorToolKind,
} from '@/providers/cursor/runtime/cursorToolNormalization';

describe('readCursorToolEnvelope', () => {
  it('finds the first *ToolCall key and exposes args/result/description', () => {
    const env = readCursorToolEnvelope({
      description: 'Echo hi',
      shellToolCall: { args: { command: 'echo hi' }, result: { success: { stdout: 'hi' } } },
    });
    expect(env).not.toBeNull();
    expect(env?.kind).toBe('shellToolCall');
    expect(env?.args).toEqual({ command: 'echo hi' });
    expect(env?.result).toEqual({ success: { stdout: 'hi' } });
    expect(env?.description).toBe('Echo hi');
  });

  it('returns null when the envelope has no recognizable tool kind', () => {
    expect(readCursorToolEnvelope({ function: { name: 'foo' } })).toBeNull();
    expect(readCursorToolEnvelope(undefined)).toBeNull();
  });
});

describe('mapCursorToolName', () => {
  it.each([
    ['readToolCall', 'Read'],
    ['writeToolCall', 'Write'],
    ['editToolCall', 'Write'],
    ['replaceEnvToolCall', 'Edit'],
    ['shellToolCall', 'Bash'],
    ['globToolCall', 'Glob'],
    ['grepToolCall', 'Grep'],
    ['lsToolCall', 'LS'],
    ['webFetchToolCall', 'WebFetch'],
    ['fetchToolCall', 'WebFetch'],
    ['webSearchToolCall', 'WebSearch'],
    ['updateTodosToolCall', 'TodoWrite'],
    ['readTodosToolCall', 'TodoWrite'],
    ['askQuestionToolCall', 'AskUserQuestion'],
    ['taskToolCall', 'Agent'],
    ['mcpToolCall', 'Mcp'],
  ])('%s normalizes to %s', (kind, expected) => {
    expect(mapCursorToolName(kind)).toBe(expected);
  });

  it('falls back to a humanized kind when unknown', () => {
    expect(mapCursorToolName('frobnicateToolCall')).toBe('frobnicate');
    expect(mapCursorToolName('weirdKey')).toBe('weirdKey');
  });
});

describe('normalizeCursorToolStart', () => {
  it('translates editToolCall args into Write input shape', () => {
    const out = normalizeCursorToolStart({
      kind: 'editToolCall',
      args: { path: '/x/a.txt', streamContent: 'hello' },
      result: undefined,
      description: undefined,
    });
    expect(out).toEqual({ name: 'Write', input: { file_path: '/x/a.txt', content: 'hello' } });
  });

  it('flattens grep args into the shared shape', () => {
    const out = normalizeCursorToolStart({
      kind: 'grepToolCall',
      args: { pattern: 'foo', path: '/x', caseInsensitive: true, multiline: false },
      result: undefined,
      description: undefined,
    });
    expect(out).toEqual({
      name: 'Grep',
      input: { pattern: 'foo', path: '/x', '-i': true },
    });
  });

  it('keeps unknown args verbatim for other tools', () => {
    const out = normalizeCursorToolStart({
      kind: 'computerUseToolCall',
      args: { foo: 1, bar: 'baz' },
      result: undefined,
      description: undefined,
    });
    expect(out.name).toBe('ComputerUse');
    expect(out.input).toEqual({ foo: 1, bar: 'baz' });
  });
});

describe('normalizeCursorToolCompletion', () => {
  it('extracts file content from a successful read', () => {
    const out = normalizeCursorToolCompletion({
      kind: 'readToolCall',
      args: { path: 'a.md' },
      result: { success: { content: 'hello world' } },
      description: undefined,
    });
    expect(out).toEqual({ name: 'Read', content: 'hello world', isError: false });
  });

  it('joins shell stdout/stderr/exit code into a terminal-style result', () => {
    const out = normalizeCursorToolCompletion({
      kind: 'shellToolCall',
      args: { command: 'do' },
      result: {
        success: { stdout: 'out\n', stderr: 'warn\n', exitCode: 1 },
      },
      description: undefined,
    });
    expect(out.content).toContain('out');
    expect(out.content).toContain('[stderr]');
    expect(out.content).toContain('warn');
    expect(out.content).toContain('Exit code: 1');
  });

  it('produces a unifiedDiff toolUseResult for editToolCall', () => {
    const out = normalizeCursorToolCompletion({
      kind: 'editToolCall',
      args: { path: '/x/a.txt', streamContent: 'b' },
      result: {
        success: {
          path: '/x/a.txt',
          diffString: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b',
          beforeFullFileContent: 'a',
          afterFullFileContent: 'b',
        },
      },
      description: undefined,
    });
    expect(out.toolUseResult).toBeDefined();
    expect(out.toolUseResult).toMatchObject({
      filePath: '/x/a.txt',
      unifiedDiff: expect.stringContaining('+b'),
    });
  });

  it('flags errors when the result envelope carries an error payload', () => {
    const out = normalizeCursorToolCompletion({
      kind: 'readToolCall',
      args: { path: 'missing' },
      result: { error: { code: 'ENOENT', message: 'not found' } },
      description: undefined,
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('not found');
  });
});

describe('resolveCursorToolKind', () => {
  it('accepts native *ToolCall keys', () => {
    expect(resolveCursorToolKind('grepToolCall')).toBe('grepToolCall');
  });

  it('maps SDK tool names back to kinds', () => {
    expect(resolveCursorToolKind('Read')).toBe('readToolCall');
    expect(resolveCursorToolKind('Bash')).toBe('shellToolCall');
  });

  it('disambiguates Write vs Edit from args', () => {
    expect(resolveCursorToolKind('Write', { streamContent: 'x' })).toBe('editToolCall');
    expect(resolveCursorToolKind('Write', { oldString: 'a', newString: 'b' })).toBe('replaceEnvToolCall');
    expect(resolveCursorToolKind('Write', { path: '/x' })).toBe('writeToolCall');
  });
});

describe('normalizeCursorPersistedToolCall', () => {
  it('normalizes history tool-call rows', () => {
    expect(normalizeCursorPersistedToolCall('readToolCall', { path: 'a.md' })).toEqual({
      name: 'Read',
      input: { file_path: 'a.md' },
    });
  });
});

describe('normalizeCursorPersistedToolResult', () => {
  it('formats history tool-result payloads without raw JSON', () => {
    const out = normalizeCursorPersistedToolResult(
      'readToolCall',
      { success: { content: 'hello' } },
      { path: 'a.md' },
    );
    expect(out).toMatchObject({ name: 'Read', content: 'hello', isError: false });
  });

  it('accepts a full envelope in the result field', () => {
    const out = normalizeCursorPersistedToolResult(
      'tool',
      {
        shellToolCall: {
          args: { command: 'echo hi' },
          result: { success: { stdout: 'hi\n', stderr: '', exitCode: 0 } },
        },
      },
      {},
    );
    expect(out).toMatchObject({ name: 'Bash', content: 'hi', isError: false });
  });
});
