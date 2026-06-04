import { TFile, TFolder } from 'obsidian';

import { detectPayload } from '@/features/chat/controllers/dropPayloadDetection';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeFile(path: string, type = 'application/octet-stream', size = 100): any {
  return { name: path.split(/[\\/]/).pop(), type, size, path };
}

function makeDataTransfer(opts: {
  types?: string[];
  files?: any[];
  items?: any[];
} = {}): any {
  return {
    types: opts.types ?? [],
    files: opts.files ?? [],
    items: opts.items ?? [],
  };
}

describe('detectPayload', () => {
  it('returns empty payload when no relevant data', () => {
    const payload = detectPayload(makeDataTransfer(), null);
    expect(payload).toEqual({
      vaultFiles: [],
      vaultFolders: [],
      osImageFiles: [],
      osFiles: [],
      osFolders: [],
      unknown: 0,
    });
  });

  it('routes Obsidian internal TFile drag to vaultFiles', () => {
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    const dragManager = { draggable: { type: 'file' as const, file: tFile } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFiles).toEqual([tFile]);
    expect(payload.osImageFiles).toHaveLength(0);
  });

  it('routes Obsidian internal TFolder drag to vaultFolders', () => {
    const tFolder = Object.assign(new TFolder(), { path: 'notes/sub' });
    const dragManager = { draggable: { type: 'folder' as const, file: tFolder } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFolders).toEqual([tFolder]);
  });

  it('routes Obsidian internal multi-file drag to vaultFiles', () => {
    const f1 = Object.assign(new TFile(), { path: 'a.md' });
    const f2 = Object.assign(new TFile(), { path: 'b.md' });
    const dragManager = { draggable: { type: 'files' as const, files: [f1, f2] } };
    const payload = detectPayload(makeDataTransfer(), dragManager);
    expect(payload.vaultFiles).toEqual([f1, f2]);
  });

  it('routes OS image files to osImageFiles', () => {
    const file = makeFile('/tmp/x.png', 'image/png');
    const dt = makeDataTransfer({ types: ['Files'], files: [file] });
    const payload = detectPayload(dt, null);
    expect(payload.osImageFiles).toEqual([file]);
    expect(payload.osFiles).toHaveLength(0);
  });

  it('routes OS non-image files to osFiles', () => {
    const file = makeFile('/tmp/x.md', 'text/markdown');
    const dt = makeDataTransfer({ types: ['Files'], files: [file] });
    const payload = detectPayload(dt, null);
    expect(payload.osFiles).toEqual([file]);
    expect(payload.osImageFiles).toHaveLength(0);
  });

  it('routes OS folders (webkitGetAsEntry isDirectory) to osFolders', () => {
    const file = makeFile('/tmp/folder', '', 0);
    const items = [{
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      getAsFile: () => file,
    }];
    const dt = makeDataTransfer({ types: ['Files'], files: [file], items });
    const payload = detectPayload(dt, null);
    expect(payload.osFolders).toEqual([{ path: '/tmp/folder' }]);
    expect(payload.osFiles).toHaveLength(0);
  });

  it('prefers internal drag when both internal and OS markers are present', () => {
    const tFile = Object.assign(new TFile(), { path: 'a.md' });
    const dragManager = { draggable: { type: 'file' as const, file: tFile } };
    const dt = makeDataTransfer({
      types: ['Files'],
      files: [makeFile('/tmp/x.png', 'image/png')],
    });
    const payload = detectPayload(dt, dragManager);
    expect(payload.vaultFiles).toEqual([tFile]);
    expect(payload.osImageFiles).toHaveLength(0);
  });
});
