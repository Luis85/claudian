import { Notice } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { deriveSeedName, isCaptureEligible, openCaptureFromMessage } from '@/features/quickActions/captureFromMessage';

jest.mock('obsidian', () => ({ Notice: jest.fn() }));

jest.mock('@/features/quickActions/QuickActionStorage', () => {
  const save = jest.fn(async (_a: any) => 'Quick Actions/seeded-name.md');
  return {
    QuickActionStorage: jest.fn().mockImplementation(() => ({
      save,
      exists: jest.fn(async () => false),
      getFilePathForName: jest.fn((n: string) => `Quick Actions/${n}.md`),
    })),
    __save: save,
  };
});

jest.mock('@/features/quickActions/ui/QuickActionEditorModal', () => {
  return {
    QuickActionEditorModal: jest.fn().mockImplementation((_app, _existing, onSave, _storage, seed) => ({
      open: jest.fn(() => { (globalThis as any).__lastSeed = seed; (globalThis as any).__lastOnSave = onSave; }),
    })),
  };
});

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
    expect(isCaptureEligible(userMsg({ content: '', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' } as never] }))).toBe(false);
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

  it('falls back to chatMessageText when displayContent is undefined', () => {
    expect(isCaptureEligible(userMsg({ content: 'fallback prose' }))).toBe(true);
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
});

function makePluginMock(overrides: any = {}) {
  return {
    app: { workspace: { openLinkText: jest.fn(async () => undefined) } },
    settings: { quickActionsFolder: 'Quick Actions' },
    storage: { getAdapter: jest.fn(() => ({})) },
    quickActionFavoritesCache: { refresh: jest.fn() },
    logger: { scope: jest.fn(() => ({ warn: jest.fn() })) },
    ...overrides,
  } as any;
}

describe('openCaptureFromMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (globalThis as any).__lastSeed;
    delete (globalThis as any).__lastOnSave;
  });

  it('surfaces a notice and does not open the modal when the folder setting is blank', () => {
    const plugin = makePluginMock({ settings: { quickActionsFolder: '' } });
    const msg = { id: 'm1', role: 'user', content: 'capture me', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect(Notice).toHaveBeenCalledWith('quickActions.capture.folderMissing');
    expect((globalThis as any).__lastSeed).toBeUndefined();
  });

  it('opens the editor modal pre-seeded with derived name and prompt body', () => {
    const plugin = makePluginMock();
    const msg = { id: 'm2', role: 'user', content: 'Summarize this note.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect((globalThis as any).__lastSeed).toEqual({
      name: 'Summarize this note.',
      prompt: 'Summarize this note.',
    });
  });

  it('runs save -> notice -> favoritesCache.refresh -> openLinkText in order on save', async () => {
    const plugin = makePluginMock();
    const msg = { id: 'm3', role: 'user', content: 'Capture this prompt body.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);
    const onSave = (globalThis as any).__lastOnSave as (a: any) => Promise<void>;
    const action = { name: 'Capture this prompt body.', prompt: 'Capture this prompt body.', filePath: '' } as any;

    await onSave(action);

    const save = (jest.requireMock('@/features/quickActions/QuickActionStorage') as any).__save;
    expect(save).toHaveBeenCalledWith(action);
    expect(Notice).toHaveBeenCalledWith('quickActions.capture.saved');
    expect(plugin.quickActionFavoritesCache.refresh).toHaveBeenCalled();
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Quick Actions/seeded-name.md', '', false);
  });

  it('logs and swallows openLinkText failures without rethrowing', async () => {
    const warn = jest.fn();
    const plugin = makePluginMock({
      app: { workspace: { openLinkText: jest.fn().mockRejectedValue(new Error('gone')) } },
      logger: { scope: jest.fn(() => ({ warn })) },
    });
    const msg = { id: 'm4', role: 'user', content: 'x', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);
    const onSave = (globalThis as any).__lastOnSave as (a: any) => Promise<void>;

    await expect(onSave({ name: 'x', prompt: 'x', filePath: '' } as any)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
