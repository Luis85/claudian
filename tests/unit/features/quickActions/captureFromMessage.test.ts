import { Notice } from 'obsidian';

import type { ChatMessage, ImageAttachment } from '@/core/types';
import { deriveSeedName, isCaptureEligible, openCaptureFromMessage } from '@/features/quickActions/captureFromMessage';

import { createStorageMock } from './_helpers/quickActionStorageMock';

jest.mock('obsidian', () => ({ Notice: jest.fn() }));

let lastSeed: { name?: string; prompt?: string } | undefined;
let lastOnSave: ((action: any) => Promise<void>) | undefined;

jest.mock('@/features/quickActions/ui/QuickActionEditorModal', () => ({
  QuickActionEditorModal: jest.fn().mockImplementation((_app, _existing, onSave, _storage, seed) => ({
    open: jest.fn(() => {
      lastSeed = seed;
      lastOnSave = onSave;
    }),
  })),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

function userMsg(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: partial.id ?? 'u1',
    role: 'user',
    content: partial.content ?? '',
    displayContent: partial.displayContent,
    timestamp: 0,
    contentBlocks: partial.contentBlocks,
    images: partial.images,
  } as ChatMessage;
}

function makeImage(): ImageAttachment {
  return {
    id: 'img-1',
    name: 'pic.png',
    mediaType: 'image/png',
    data: 'aGVsbG8=',
    size: 5,
    source: 'paste',
  };
}

describe('isCaptureEligible', () => {
  it('is true for plain user prose', () => {
    expect(isCaptureEligible(userMsg({ content: 'Summarize this note.' }))).toBe(true);
  });

  it('is false for assistant role', () => {
    expect(isCaptureEligible({ ...userMsg({ content: 'hi' }), role: 'assistant' } as ChatMessage)).toBe(false);
  });

  it('is false when both content and displayContent are empty', () => {
    expect(isCaptureEligible(userMsg({ content: '', displayContent: '' }))).toBe(false);
  });

  it('is false for image-only messages (no text)', () => {
    expect(isCaptureEligible(userMsg({ content: '', images: [makeImage()] }))).toBe(false);
  });

  it.each(['/compact', '$skill', '#instruction', '!ls -la'])(
    'is false for command prefix %s',
    (text) => {
      expect(isCaptureEligible(userMsg({ content: text }))).toBe(false);
    },
  );

  it('is true when text contains a slash mid-line', () => {
    expect(isCaptureEligible(userMsg({ content: 'Refactor /utils into smaller files' }))).toBe(true);
  });

  it('falls back to chatMessageText (contentBlocks) when content and displayContent are empty', () => {
    const msg = userMsg({
      content: '',
      displayContent: undefined,
      contentBlocks: [
        { type: 'text', content: 'block-sourced prose' },
        { type: 'tool_use', toolId: 't1' },
      ],
    });
    expect(isCaptureEligible(msg)).toBe(true);
  });

  it('is false when contentBlocks fallback only contains a leading command char', () => {
    const msg = userMsg({
      content: '',
      displayContent: undefined,
      contentBlocks: [{ type: 'text', content: '/compact' }],
    });
    expect(isCaptureEligible(msg)).toBe(false);
  });

  it('prefers displayContent over content when present', () => {
    expect(isCaptureEligible(userMsg({ content: '/compact', displayContent: 'human-readable prose' }))).toBe(true);
  });
});

describe('deriveSeedName', () => {
  it('returns short text unchanged', () => {
    expect(deriveSeedName('Short title')).toBe('Short title');
  });

  it('truncates and appends an ellipsis when longer than maxLen', () => {
    const long = 'a'.repeat(80);
    const out = deriveSeedName(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
  });

  it('uses only the first line for multi-line input', () => {
    expect(deriveSeedName('first line\nsecond line')).toBe('first line');
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveSeedName('   hello world   ')).toBe('hello world');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(deriveSeedName('   \n   ')).toBe('');
  });

  it('slices by code point so emoji input does not leave a lone surrogate', () => {
    const emoji = '😀'.repeat(60);
    const out = deriveSeedName(emoji, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(51);
    // No lone surrogate before the ellipsis: every high surrogate must be
    // immediately followed by a low surrogate. Walk the body and collect a
    // single boolean verdict so the assertion is unconditional.
    const beforeEllipsis = out.slice(0, -1);
    let allPaired = true;
    for (let i = 0; i < beforeEllipsis.length; i++) {
      const code = beforeEllipsis.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = beforeEllipsis.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          allPaired = false;
          break;
        }
        i++;
      }
    }
    expect(allPaired).toBe(true);
  });
});

function makePluginMock(overrides: any = {}) {
  return {
    app: { workspace: { openLinkText: jest.fn(async () => undefined) } },
    settings: { quickActionsFolder: 'Quick Actions' },
    quickActionStorage: createStorageMock(),
    quickActionFavoritesCache: { refresh: jest.fn() },
    logger: { scope: jest.fn(() => ({ warn: jest.fn() })) },
    ...overrides,
  } as any;
}

describe('openCaptureFromMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastSeed = undefined;
    lastOnSave = undefined;
  });

  it('surfaces a notice and does not open the modal when the folder setting is blank', () => {
    const plugin = makePluginMock({ settings: { quickActionsFolder: '' } });
    const msg = { id: 'm1', role: 'user', content: 'capture me', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect(Notice).toHaveBeenCalledWith('quickActions.capture.folderMissing');
    expect(lastSeed).toBeUndefined();
  });

  it('opens the editor modal pre-seeded with derived name and prompt body', () => {
    const plugin = makePluginMock();
    const msg = { id: 'm2', role: 'user', content: 'Summarize this note.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect(lastSeed).toEqual({
      name: 'Summarize this note.',
      prompt: 'Summarize this note.',
    });
  });

  it('runs save -> notice -> favoritesCache.refresh -> openLinkText in order on save', async () => {
    const saveSpy = jest.fn(async () => 'Quick Actions/captured.md');
    const plugin = makePluginMock({ quickActionStorage: createStorageMock({ save: saveSpy }) });
    const msg = { id: 'm3', role: 'user', content: 'Capture this prompt body.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);
    const action = { name: 'Capture this prompt body.', prompt: 'Capture this prompt body.', filePath: '' } as any;

    await lastOnSave!(action);

    expect(saveSpy).toHaveBeenCalledWith(action);
    expect(Notice).toHaveBeenCalledWith('quickActions.capture.saved');
    expect(plugin.quickActionFavoritesCache.refresh).toHaveBeenCalled();
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Quick Actions/captured.md', '', 'tab');

    const saveOrder = saveSpy.mock.invocationCallOrder[0];
    const noticeOrder = (Notice as unknown as jest.Mock).mock.invocationCallOrder.find(
      (_, i) => ((Notice as unknown as jest.Mock).mock.calls[i] ?? [])[0] === 'quickActions.capture.saved',
    );
    const refreshOrder = (plugin.quickActionFavoritesCache.refresh as jest.Mock).mock.invocationCallOrder[0];
    const openOrder = (plugin.app.workspace.openLinkText as jest.Mock).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(noticeOrder as number);
    expect(noticeOrder).toBeLessThan(refreshOrder);
    expect(refreshOrder).toBeLessThan(openOrder);
  });

  it('logs and swallows openLinkText failures without rethrowing', async () => {
    const warn = jest.fn();
    const plugin = makePluginMock({
      app: { workspace: { openLinkText: jest.fn().mockRejectedValue(new Error('gone')) } },
      logger: { scope: jest.fn(() => ({ warn })) },
    });
    const msg = { id: 'm4', role: 'user', content: 'x', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    await expect(lastOnSave!({ name: 'x', prompt: 'x', filePath: '' } as any)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
