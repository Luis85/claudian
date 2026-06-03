import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { RewindFilesResult } from '@anthropic-ai/claude-agent-sdk';
import { itPosix } from '@test/helpers/platform';

import type { ChatRewindMode } from '@/core/runtime/types';
import {
  type ClaudeRewindBackup,
  createClaudeRewindBackup,
  executeClaudeRewind,
  type ExecuteClaudeRewindDeps,
} from '@/providers/claude/runtime/ClaudeRewindService';

function makeRewindDeps(overrides: Partial<ExecuteClaudeRewindDeps> = {}): {
  deps: ExecuteClaudeRewindDeps;
  closePersistentQuery: jest.Mock;
  setPendingResumeAt: jest.Mock;
  rewindFiles: jest.Mock;
} {
  const closePersistentQuery = jest.fn();
  const setPendingResumeAt = jest.fn();
  const rewindFiles = (overrides.rewindFiles as jest.Mock | undefined)
    ?? jest.fn(async () => ({ canRewind: false } as RewindFilesResult));
  return {
    deps: {
      assistantMessageId: 'asst-1',
      mode: 'code-and-conversation' as ChatRewindMode,
      closePersistentQuery,
      setPendingResumeAt,
      vaultPath: null,
      ...overrides,
      rewindFiles,
    },
    closePersistentQuery,
    setPendingResumeAt,
    rewindFiles,
  };
}

describe('createClaudeRewindBackup', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'claudian-rewind-ws-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns null when filesChanged is undefined', async () => {
    await expect(createClaudeRewindBackup(undefined, workspace)).resolves.toBeNull();
  });

  it('returns null when filesChanged is empty', async () => {
    await expect(createClaudeRewindBackup([], workspace)).resolves.toBeNull();
  });

  it('backs up a file and restores its original content', async () => {
    const file = path.join(workspace, 'note.md');
    await fsp.writeFile(file, 'original', 'utf-8');

    const backup = (await createClaudeRewindBackup([file], null)) as ClaudeRewindBackup;
    await fsp.writeFile(file, 'mutated', 'utf-8');
    await backup.restore();

    await expect(fsp.readFile(file, 'utf-8')).resolves.toBe('original');
    await backup.cleanup();
  });

  it('backs up a directory recursively and restores it', async () => {
    const dir = path.join(workspace, 'subdir');
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'a.txt'), 'A', 'utf-8');
    await fsp.mkdir(path.join(dir, 'nested'));
    await fsp.writeFile(path.join(dir, 'nested', 'b.txt'), 'B', 'utf-8');

    const backup = (await createClaudeRewindBackup([dir], null)) as ClaudeRewindBackup;
    await fsp.rm(path.join(dir, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'a.txt'), 'mutated', 'utf-8');
    await backup.restore();

    await expect(fsp.readFile(path.join(dir, 'a.txt'), 'utf-8')).resolves.toBe('A');
    await expect(fsp.readFile(path.join(dir, 'nested', 'b.txt'), 'utf-8')).resolves.toBe('B');
    await backup.cleanup();
  });

  itPosix(
    'records a symlink target and recreates it on restore',
    async () => {
      const target = path.join(workspace, 'real.txt');
      const link = path.join(workspace, 'link.txt');
      await fsp.writeFile(target, 'real', 'utf-8');
      await fsp.symlink(target, link);

      const backup = (await createClaudeRewindBackup([link], null)) as ClaudeRewindBackup;
      await fsp.unlink(link);
      await backup.restore();

      const after = await fsp.readlink(link);
      expect(after).toBe(target);
      await backup.cleanup();
    },
  );

  it('records a missing path and removes any file recreated since the backup', async () => {
    const file = path.join(workspace, 'never-existed.md');
    expect(existsSync(file)).toBe(false);

    const backup = (await createClaudeRewindBackup([file], null)) as ClaudeRewindBackup;
    // Simulate the rewind creating the file out of nothing.
    await fsp.writeFile(file, 'created during rewind', 'utf-8');
    await backup.restore();

    // Restore deletes paths that did not exist before.
    expect(existsSync(file)).toBe(false);
    await backup.cleanup();
  });

  it('handles mixed file and missing entries in one backup', async () => {
    const present = path.join(workspace, 'present.md');
    const missing = path.join(workspace, 'missing.md');
    await fsp.writeFile(present, 'original', 'utf-8');

    const backup = (await createClaudeRewindBackup(
      [present, missing],
      null,
    )) as ClaudeRewindBackup;
    await fsp.writeFile(present, 'changed', 'utf-8');
    await fsp.writeFile(missing, 'created', 'utf-8');
    await backup.restore();

    await expect(fsp.readFile(present, 'utf-8')).resolves.toBe('original');
    expect(existsSync(missing)).toBe(false);
    await backup.cleanup();
  });

  it('resolves relative paths against the provided vaultPath', async () => {
    const file = path.join(workspace, 'note.md');
    await fsp.writeFile(file, 'V', 'utf-8');

    const backup = (await createClaudeRewindBackup(['note.md'], workspace)) as ClaudeRewindBackup;
    await fsp.writeFile(file, 'V2', 'utf-8');
    await backup.restore();

    await expect(fsp.readFile(file, 'utf-8')).resolves.toBe('V');
    await backup.cleanup();
  });

  it('cleanup removes the backup directory off-disk', async () => {
    const file = path.join(workspace, 'a.md');
    await fsp.writeFile(file, 'x', 'utf-8');

    // Snapshot the set of dirs in os.tmpdir() matching the prefix before/after
    // to confirm cleanup deletes exactly one entry.
    const prefix = 'claudian-rewind-';
    const before = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));

    const backup = (await createClaudeRewindBackup([file], null)) as ClaudeRewindBackup;
    const during = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));
    expect(during.length).toBe(before.length + 1);

    await backup.cleanup();
    const after = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));
    expect(after.length).toBe(before.length);
  });
});

describe('executeClaudeRewind', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'claudian-rewind-exec-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('mode "conversation"', () => {
    it('notifies pending resume, closes the query, and returns canRewind:true with empty filesChanged', async () => {
      const { deps, closePersistentQuery, setPendingResumeAt, rewindFiles } = makeRewindDeps({
        mode: 'conversation',
      });
      const result = await executeClaudeRewind('user-1', deps);

      expect(result).toEqual({ canRewind: true, filesChanged: [] });
      expect(setPendingResumeAt).toHaveBeenCalledWith('asst-1');
      expect(closePersistentQuery).toHaveBeenCalledWith('conversation rewind');
      // Conversation mode never invokes the file-rewind SDK helper.
      expect(rewindFiles).not.toHaveBeenCalled();
    });
  });

  describe('mode "code-and-conversation"', () => {
    it('returns the preview unchanged when preview.canRewind is false', async () => {
      const preview: RewindFilesResult = { canRewind: false };
      const { deps, closePersistentQuery, setPendingResumeAt, rewindFiles } = makeRewindDeps({
        rewindFiles: jest.fn().mockResolvedValueOnce(preview),
      });

      const result = await executeClaudeRewind('user-1', deps);
      expect(result).toBe(preview);
      // No callbacks fire when the preview already refused the rewind.
      expect(setPendingResumeAt).not.toHaveBeenCalled();
      expect(closePersistentQuery).not.toHaveBeenCalled();
      expect(rewindFiles).toHaveBeenCalledTimes(1);
      expect(rewindFiles).toHaveBeenCalledWith('user-1', true);
    });

    it('merges preview filesChanged/insertions/deletions into the success result', async () => {
      const file = path.join(workspace, 'note.md');
      await fsp.writeFile(file, 'before', 'utf-8');

      const preview: RewindFilesResult = {
        canRewind: true,
        filesChanged: [file],
        insertions: 4,
        deletions: 2,
      };
      const success: RewindFilesResult = { canRewind: true, filesChanged: ['other-file.md'] };
      const rewindFiles = jest
        .fn()
        .mockResolvedValueOnce(preview)
        .mockResolvedValueOnce(success);
      const { deps, closePersistentQuery, setPendingResumeAt } = makeRewindDeps({ rewindFiles });

      const result = await executeClaudeRewind('user-1', deps);

      // Preview metadata overrides the success result's filesChanged so the
      // caller can show the same file list it previewed (rewindFiles can omit it).
      expect(result).toMatchObject({
        canRewind: true,
        filesChanged: [file],
        insertions: 4,
        deletions: 2,
      });
      expect(setPendingResumeAt).toHaveBeenCalledWith('asst-1');
      expect(closePersistentQuery).toHaveBeenCalledWith('rewind');
      expect(rewindFiles).toHaveBeenNthCalledWith(1, 'user-1', true);
      expect(rewindFiles).toHaveBeenNthCalledWith(2, 'user-1');
    });

    it('restores from backup and closes with "rewind failed" when the actual rewind reports !canRewind', async () => {
      const file = path.join(workspace, 'note.md');
      await fsp.writeFile(file, 'original', 'utf-8');

      const preview: RewindFilesResult = {
        canRewind: true,
        filesChanged: [file],
        insertions: 1,
        deletions: 1,
      };
      const failure: RewindFilesResult = { canRewind: false };
      const rewindFiles = jest
        .fn<Promise<RewindFilesResult>, [string, boolean?]>()
        .mockImplementationOnce(async () => preview)
        .mockImplementationOnce(async () => {
          // The SDK contract: the second call may mutate the file before
          // reporting failure. The backup must restore it.
          await fsp.writeFile(file, 'mid-rewind mutation', 'utf-8');
          return failure;
        });
      const { deps, closePersistentQuery, setPendingResumeAt } = makeRewindDeps({ rewindFiles });

      const result = await executeClaudeRewind('user-1', deps);
      expect(result).toBe(failure);
      expect(setPendingResumeAt).not.toHaveBeenCalled();
      expect(closePersistentQuery).toHaveBeenCalledWith('rewind failed');
      await expect(fsp.readFile(file, 'utf-8')).resolves.toBe('original');
    });

    it('restores from backup and rethrows when the second rewindFiles call throws', async () => {
      const file = path.join(workspace, 'note.md');
      await fsp.writeFile(file, 'original', 'utf-8');

      const preview: RewindFilesResult = { canRewind: true, filesChanged: [file] };
      const rewindFiles = jest
        .fn<Promise<RewindFilesResult>, [string, boolean?]>()
        .mockImplementationOnce(async () => preview)
        .mockImplementationOnce(async () => {
          await fsp.writeFile(file, 'partial', 'utf-8');
          throw new Error('rewind boom');
        });
      const { deps, closePersistentQuery, setPendingResumeAt } = makeRewindDeps({ rewindFiles });

      await expect(executeClaudeRewind('user-1', deps)).rejects.toThrow(
        /Rewind failed but files were restored: rewind boom/,
      );
      expect(setPendingResumeAt).not.toHaveBeenCalled();
      expect(closePersistentQuery).toHaveBeenCalledWith('rewind failed');
      await expect(fsp.readFile(file, 'utf-8')).resolves.toBe('original');
    });

    it('wraps non-Error throw values as "Unknown error"', async () => {
      const file = path.join(workspace, 'note.md');
      await fsp.writeFile(file, 'original', 'utf-8');

      const preview: RewindFilesResult = { canRewind: true, filesChanged: [file] };
      const rewindFiles = jest
        .fn<Promise<RewindFilesResult>, [string, boolean?]>()
        .mockImplementationOnce(async () => preview)
        .mockImplementationOnce(async () => {
          throw 'string-rejection';
        });
      const { deps } = makeRewindDeps({ rewindFiles });

      await expect(executeClaudeRewind('user-1', deps)).rejects.toThrow(
        /Rewind failed but files were restored: Unknown error/,
      );
    });

    it('cleans up the backup directory even on the success path (no orphan tmpdir)', async () => {
      const file = path.join(workspace, 'note.md');
      await fsp.writeFile(file, 'before', 'utf-8');

      const prefix = 'claudian-rewind-';
      const before = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));

      const rewindFiles = jest
        .fn()
        .mockResolvedValueOnce({ canRewind: true, filesChanged: [file] } as RewindFilesResult)
        .mockResolvedValueOnce({ canRewind: true, filesChanged: [] } as RewindFilesResult);
      const { deps } = makeRewindDeps({ rewindFiles });

      await executeClaudeRewind('user-1', deps);

      const after = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));
      expect(after.length).toBe(before.length);
    });
  });

  // The dual-failure branch ("rewind throws and rollback also throws → close +
  // throw 'Rewind failed and files could not be fully restored: ...'") is not
  // covered here: it requires injecting a failure into the per-entry restore
  // path, and createClaudeRewindBackup is a same-module helper that
  // executeClaudeRewind constructs directly. Exercising it cleanly would mean
  // either exporting the backup factory as a swappable dep or adding a
  // jest.spyOn against the module namespace — both push test seams into
  // production. Left for follow-up if the branch starts misbehaving in the
  // field.
});
