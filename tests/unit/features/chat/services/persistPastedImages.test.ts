import type { App, TFile } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

jest.mock('@/core/logging/Logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

function image(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: 'img-1',
    name: 'clipboard.png',
    mediaType: 'image/png',
    data: Buffer.from('hello').toString('base64'),
    size: 5,
    source: 'paste',
    ...overrides,
  };
}

function mockApp(overrides?: Partial<{ availablePath: string; createBinary: jest.Mock }>): App {
  const created: Record<string, TFile> = {};
  const createBinary = overrides?.createBinary ?? jest.fn(async (path: string) => {
    const file = { path, name: path.split('/').pop() ?? path, basename: 'x', extension: 'png' } as unknown as TFile;
    created[path] = file;
    return file;
  });
  return {
    fileManager: {
      getAvailablePathForAttachment: jest.fn(async (name: string) => overrides?.availablePath ?? `attachments/${name}`),
    },
    vault: { createBinary },
  } as unknown as App;
}

describe('persistPastedImages', () => {
  it('writes images without path to the vault and stamps path + name', async () => {
    const app = mockApp({ availablePath: 'attachments/Pasted image 20260604120000.png' });
    const img = image();
    await persistPastedImages(app, [img], { now: new Date('2026-06-04T12:00:00Z') });

    expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith('Pasted image 20260604120000.png');
    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    const [calledPath, buffer] = (app.vault.createBinary as jest.Mock).mock.calls[0];
    expect(calledPath).toBe('attachments/Pasted image 20260604120000.png');
    expect(Buffer.from(buffer).toString('utf8')).toBe('hello');
    expect(img.path).toBe('attachments/Pasted image 20260604120000.png');
    expect(img.name).toBe('Pasted image 20260604120000.png');
  });

  it('skips images that already have a path', async () => {
    const app = mockApp();
    const img = image({ path: 'attachments/existing.png' });
    await persistPastedImages(app, [img], { now: new Date('2026-06-04T12:00:00Z') });

    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(img.path).toBe('attachments/existing.png');
  });

  it('routes mediaType to file extension', async () => {
    const app = mockApp();
    const jpg = image({ mediaType: 'image/jpeg', id: 'a' });
    const gif = image({ mediaType: 'image/gif', id: 'b' });
    const webp = image({ mediaType: 'image/webp', id: 'c' });
    await persistPastedImages(app, [jpg, gif, webp], { now: new Date('2026-06-04T12:00:00Z') });

    const names = (app.fileManager.getAvailablePathForAttachment as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'Pasted image 20260604120000.jpg',
      'Pasted image 20260604120000.gif',
      'Pasted image 20260604120000.webp',
    ]);
  });

  it('continues other images when one createBinary throws and leaves path undefined', async () => {
    const app = mockApp({
      createBinary: jest.fn()
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce({ path: 'attachments/b.png', name: 'b.png', basename: 'b', extension: 'png' } as unknown as TFile),
    });
    const a = image({ id: 'a' });
    const b = image({ id: 'b' });
    await persistPastedImages(app, [a, b], { now: new Date('2026-06-04T12:00:00Z') });

    expect(a.path).toBeUndefined();
    expect(b.path).toBe('attachments/b.png');
  });

  it('runs writes sequentially (not in parallel) to avoid same-stamp collisions', async () => {
    const order: string[] = [];
    const app = mockApp({
      createBinary: jest.fn(async (path: string) => {
        order.push(`start:${path}`);
        await new Promise((r) => setTimeout(r, 0));
        order.push(`end:${path}`);
        return { path, name: path.split('/').pop() ?? path, basename: 'x', extension: 'png' } as unknown as TFile;
      }),
    });
    const a = image({ id: 'a' });
    const b = image({ id: 'b' });
    await persistPastedImages(app, [a, b], { now: new Date('2026-06-04T12:00:00Z') });

    expect(order[0]).toMatch(/^start:/);
    expect(order[1]).toMatch(/^end:/);
    expect(order[2]).toMatch(/^start:/);
    expect(order[3]).toMatch(/^end:/);
  });
});
