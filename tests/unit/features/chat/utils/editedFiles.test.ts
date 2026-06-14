import type { App } from 'obsidian';

import type { ChatMessage, ToolCallInfo } from '@/core/types';
import {
  collectDeletedPathsFromToolCall,
  collectEditedPathsFromToolCall,
  deriveEditedFilesFromMessages,
  type EditedFileEntry,
  mergeEditedFileEntry,
} from '@/features/chat/utils/editedFiles';

jest.mock('@/utils/fileLink', () => ({
  // Echo the path back as "openable" except a sentinel that simulates a
  // deleted / out-of-vault file.
  resolveOpenableVaultPath: jest.fn((_app: unknown, path: string) =>
    path === 'gone.md' ? null : path,
  ),
}));

function toolCall(overrides: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    id: overrides.id ?? 'tc',
    name: overrides.name ?? 'Write',
    input: overrides.input ?? {},
    status: overrides.status ?? 'completed',
    ...overrides,
  };
}

function assistantMessage(toolCalls: ToolCallInfo[], id = 'm'): ChatMessage {
  return { id, role: 'assistant', content: '', timestamp: 1, toolCalls };
}

describe('collectEditedPathsFromToolCall', () => {
  it('marks a fresh Write as created and a Write that removes lines as edited', () => {
    expect(collectEditedPathsFromToolCall(toolCall({ name: 'Write', input: { file_path: 'a.md' } })))
      .toEqual([{ path: 'a.md', changeKind: 'created' }]);

    const overwrite = toolCall({
      name: 'Write',
      input: { file_path: 'a.md' },
      diffData: { filePath: 'a.md', diffLines: [], stats: { added: 2, removed: 3 } },
    });
    expect(collectEditedPathsFromToolCall(overwrite)).toEqual([{ path: 'a.md', changeKind: 'edited' }]);
  });

  it('marks Edit and NotebookEdit as edited', () => {
    expect(collectEditedPathsFromToolCall(toolCall({ name: 'Edit', input: { file_path: 'a.ts' } })))
      .toEqual([{ path: 'a.ts', changeKind: 'edited' }]);
    expect(collectEditedPathsFromToolCall(toolCall({ name: 'NotebookEdit', input: { notebook_path: 'nb.ipynb' } })))
      .toEqual([{ path: 'nb.ipynb', changeKind: 'edited' }]);
  });

  it('falls back to diffData.filePath when the input has no path', () => {
    const tc = toolCall({
      name: 'Edit',
      input: {},
      diffData: { filePath: 'resolved.md', diffLines: [], stats: { added: 1, removed: 1 } },
    });
    expect(collectEditedPathsFromToolCall(tc)).toEqual([{ path: 'resolved.md', changeKind: 'edited' }]);
  });

  it('ignores non-editing tools', () => {
    expect(collectEditedPathsFromToolCall(toolCall({ name: 'Read', input: { file_path: 'a.md' } }))).toEqual([]);
    expect(collectEditedPathsFromToolCall(toolCall({ name: 'Bash', input: { command: 'ls' } }))).toEqual([]);
  });

  it('parses apply_patch markers, mapping Add to created and Update to edited, dropping deletions', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: new.ts',
      '+content',
      '*** Update File: existing.ts',
      '-old',
      '+new',
      '*** Delete File: removed.ts',
      '*** End Patch',
    ].join('\n');

    expect(collectEditedPathsFromToolCall(toolCall({ name: 'apply_patch', input: { patch } }))).toEqual([
      { path: 'new.ts', changeKind: 'created' },
      { path: 'existing.ts', changeKind: 'edited' },
    ]);
  });

  it('records the destination path for an apply_patch rename (Move to)', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old-name.ts',
      '*** Move to: src/new-name.ts',
      '@@',
      '-a',
      '+b',
      '*** End Patch',
    ].join('\n');

    expect(collectEditedPathsFromToolCall(toolCall({ name: 'apply_patch', input: { patch } }))).toEqual([
      { path: 'src/new-name.ts', changeKind: 'edited' },
    ]);
  });

  it('parses a legacy apply_patch changes[] array as edits', () => {
    const tc = toolCall({ name: 'apply_patch', input: { changes: [{ path: 'x.ts' }, { path: 'y.ts' }] } });
    expect(collectEditedPathsFromToolCall(tc)).toEqual([
      { path: 'x.ts', changeKind: 'edited' },
      { path: 'y.ts', changeKind: 'edited' },
    ]);
  });

  it('honors structured apply_patch change kinds: skips deletes, marks adds, prefers move targets', () => {
    const tc = toolCall({
      name: 'apply_patch',
      input: {
        changes: [
          { path: 'added.ts', kind: 'add' },
          { path: 'updated.ts', kind: 'update' },
          { path: 'gone.ts', kind: 'delete' },
          { path: 'old.ts', kind: 'update', new_path: 'new.ts' },
        ],
      },
    });
    expect(collectEditedPathsFromToolCall(tc)).toEqual([
      { path: 'added.ts', changeKind: 'created' },
      { path: 'updated.ts', changeKind: 'edited' },
      { path: 'new.ts', changeKind: 'edited' },
    ]);
  });
});

describe('collectDeletedPathsFromToolCall', () => {
  it('collects patch-text Delete File markers', () => {
    const patch = [
      '*** Begin Patch',
      '*** Delete File: notes/gone.md',
      '*** Update File: notes/kept.md',
      '*** End Patch',
    ].join('\n');
    expect(collectDeletedPathsFromToolCall(toolCall({ name: 'apply_patch', input: { patch } })))
      .toEqual(['notes/gone.md']);
  });

  it('collects structured changes[] deletes by kind/type', () => {
    const tc = toolCall({
      name: 'apply_patch',
      input: { changes: [{ path: 'a.ts', kind: 'delete' }, { path: 'b.ts', type: 'remove' }, { path: 'c.ts', kind: 'update' }] },
    });
    expect(collectDeletedPathsFromToolCall(tc)).toEqual(['a.ts', 'b.ts']);
  });

  it('returns nothing for non-apply_patch tools', () => {
    expect(collectDeletedPathsFromToolCall(toolCall({ name: 'Edit', input: { file_path: 'a.md' } }))).toEqual([]);
  });
});

describe('mergeEditedFileEntry', () => {
  it('dedupes by path and moves the most recent to the front', () => {
    let list: EditedFileEntry[] = [];
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'edited' });
    list = mergeEditedFileEntry(list, { path: 'b.md', changeKind: 'edited' });
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'edited' });

    expect(list.map((e) => e.path)).toEqual(['a.md', 'b.md']);
  });

  it('keeps created sticky across later edits', () => {
    let list: EditedFileEntry[] = [];
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'created' });
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'edited' });

    expect(list).toEqual([{ path: 'a.md', changeKind: 'created' }]);
  });

  it('upgrades edited to created when a later create signal arrives', () => {
    let list: EditedFileEntry[] = [];
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'edited' });
    list = mergeEditedFileEntry(list, { path: 'a.md', changeKind: 'created' });

    expect(list).toEqual([{ path: 'a.md', changeKind: 'created' }]);
  });
});

describe('deriveEditedFilesFromMessages', () => {
  const app = {} as App;

  it('collects completed edit tools across messages, most-recent first', () => {
    const messages: ChatMessage[] = [
      assistantMessage([toolCall({ id: '1', name: 'Write', input: { file_path: 'a.md' } })], 'm1'),
      assistantMessage([toolCall({ id: '2', name: 'Edit', input: { file_path: 'b.ts' } })], 'm2'),
    ];

    expect(deriveEditedFilesFromMessages(app, messages)).toEqual([
      { path: 'b.ts', changeKind: 'edited' },
      { path: 'a.md', changeKind: 'created' },
    ]);
  });

  it('ignores running/errored tool calls, reads, and unresolvable paths', () => {
    const messages: ChatMessage[] = [
      assistantMessage([
        toolCall({ id: '1', name: 'Write', input: { file_path: 'gone.md' } }),
        toolCall({ id: '2', name: 'Read', input: { file_path: 'a.md' } }),
        toolCall({ id: '3', name: 'Edit', input: { file_path: 'pending.ts' }, status: 'running' }),
        toolCall({ id: '4', name: 'Edit', input: { file_path: 'failed.ts' }, status: 'error' }),
        toolCall({ id: '5', name: 'Write', input: { file_path: 'kept.md' } }),
      ]),
    ];

    expect(deriveEditedFilesFromMessages(app, messages)).toEqual([
      { path: 'kept.md', changeKind: 'created' },
    ]);
  });

  it('returns an empty list when there are no tool calls', () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', content: 'hi', timestamp: 1 },
      assistantMessage([], 'm'),
    ];
    expect(deriveEditedFilesFromMessages(app, messages)).toEqual([]);
  });
});
