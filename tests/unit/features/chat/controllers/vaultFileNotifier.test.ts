/**
 * @jest-environment jsdom
 */
import type { App } from 'obsidian';

import { notifyApplyPatchFileChanges } from '@/features/chat/controllers/vaultFileNotifier';

jest.mock('@/utils/path', () => ({
  ...jest.requireActual('@/utils/path'),
  getVaultPath: jest.fn(() => '/vault'),
}));

function createApp(): { app: App; list: jest.Mock } {
  const list = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: {
      // No file is indexed yet, so each notify scans the parent directory.
      getAbstractFileByPath: jest.fn(() => null),
      adapter: { list },
      trigger: jest.fn(),
    },
  } as unknown as App;
  return { app, list };
}

describe('notifyApplyPatchFileChanges', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('refreshes the destination parent (not just the source) for a Move to rename', () => {
    const { app, list } = createApp();
    const patch = [
      '*** Begin Patch',
      '*** Update File: dirA/old.md',
      '*** Move to: dirB/new.md',
      '*** End Patch',
    ].join('\n');

    notifyApplyPatchFileChanges(app, { patch });
    jest.advanceTimersByTime(300);

    const scannedDirs = list.mock.calls.map((call) => call[0]);
    expect(scannedDirs).toContain('dirB');
    expect(scannedDirs).toContain('dirA');
  });

  it('refreshes the destination parent for a structured changes[] rename', () => {
    const { app, list } = createApp();

    notifyApplyPatchFileChanges(app, {
      changes: [{ path: 'dirA/old.md', movePath: 'dirB/new.md', kind: 'update' }],
    });
    jest.advanceTimersByTime(300);

    const scannedDirs = list.mock.calls.map((call) => call[0]);
    expect(scannedDirs).toContain('dirB');
    expect(scannedDirs).toContain('dirA');
  });

  it('refreshes Add/Update parents and skips nothing for a normal patch', () => {
    const { app, list } = createApp();
    const patch = [
      '*** Begin Patch',
      '*** Add File: notes/created.md',
      '*** Update File: notes/edited.md',
      '*** End Patch',
    ].join('\n');

    notifyApplyPatchFileChanges(app, { patch });
    jest.advanceTimersByTime(300);

    const scannedDirs = list.mock.calls.map((call) => call[0]);
    expect(scannedDirs).toContain('notes');
  });
});
