import * as fs from 'fs';
import type * as osTypes from 'os';
import * as path from 'path';

import type { HydrationContext } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { CursorConversationHistoryService } from '@/providers/cursor/history/CursorConversationHistoryService';
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
} from '@/providers/cursor/history/cursorHistoryStore';
import * as Store from '@/providers/cursor/history/cursorHistoryStore';

function makeConversation(sessionId: string): Conversation {
  return {
    id: 'conv-1',
    title: 'Test',
    messages: [],
    createdAt: 0,
    lastActiveAt: 0,
    sessionId: null,
    providerId: 'cursor',
    providerState: { chatSessionId: sessionId },
  } as unknown as Conversation;
}

describe('CursorConversationHistoryService — no out-of-band error getter', () => {
  it('does not expose getLastHistoryLoadError', () => {
    const svc = new CursorConversationHistoryService();
    expect((svc as unknown as { getLastHistoryLoadError?: unknown }).getLastHistoryLoadError).toBeUndefined();
  });

  it('does not expose forkSupport (Cursor capabilities.supportsFork === false)', () => {
    const svc = new CursorConversationHistoryService();
    expect(svc.forkSupport).toBeUndefined();
  });
});

describe('CursorConversationHistoryService.hydrateConversationHistoryV2', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns error:sqlite-unavailable when node:sqlite cannot be required', async () => {
    jest.spyOn(Store, 'resolveCursorStoreDbPath').mockReturnValue('/tmp/cursor.db');
    jest.spyOn(Store, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
      messages: [],
      error: { code: 'sqlite-unavailable', message: 'Cursor history requires node:sqlite.' },
    });
    const svc = new CursorConversationHistoryService();
    const out = await svc.hydrateConversationHistoryV2(makeConversation('s'), {
      vaultPath: '/vault',
      reason: 'open',
    });
    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('sqlite-unavailable');
  });
});

describe('CursorConversationHistoryService.deleteConversationSessionV2', () => {
  const realOs = jest.requireActual<typeof osTypes>('os');
  let tmpHome: string;
  let homedirSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'claudian-cursor-delete-'));
    homedirSpy = jest.spyOn(realOs, 'homedir').mockReturnValue(tmpHome);
  });
  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function plantChatDir(hash: string, sessionId: string): string {
    const dir = path.join(tmpHome, '.cursor', 'chats', hash, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'store.db'), '');
    return dir;
  }

  function ctxFor(vaultPath: string): HydrationContext {
    return { vaultPath, reason: 'open' };
  }

  it('returns deleted with the normalized-hash directory in paths', async () => {
    const vault = '/vault/Test';
    const sessionId = 'sess-normalized';
    const dir = plantChatDir(cursorWorkspaceHash(vault), sessionId);

    const svc = new CursorConversationHistoryService();
    const out = await svc.deleteConversationSessionV2(makeConversation(sessionId), ctxFor(vault));

    expect(out.kind).toBe('deleted');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'deleted') expect(out.paths).toContain(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('also removes the legacy-hash directory and reports both paths', async () => {
    const vault = 'D:\\\\Projects\\\\Test';
    const sessionId = 'sess-legacy';
    const legacyDir = plantChatDir(cursorWorkspaceHashLegacy(vault), sessionId);

    const svc = new CursorConversationHistoryService();
    const out = await svc.deleteConversationSessionV2(makeConversation(sessionId), ctxFor(vault));

    expect(out.kind).toBe('deleted');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'deleted') expect(out.paths).toContain(legacyDir);
    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it('returns error:invalid-session-id when sessionId fails validation', async () => {
    const vault = '/vault/Test';
    const chatsRoot = path.join(tmpHome, '.cursor', 'chats');
    fs.mkdirSync(chatsRoot, { recursive: true });
    fs.writeFileSync(path.join(chatsRoot, 'sentinel'), '');

    const svc = new CursorConversationHistoryService();
    const out = await svc.deleteConversationSessionV2(makeConversation('.'), ctxFor(vault));

    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('invalid-session-id');
    expect(fs.existsSync(path.join(chatsRoot, 'sentinel'))).toBe(true);
  });

  it('returns no-op:no-session when sessionId is null or vaultPath is null', async () => {
    const svc = new CursorConversationHistoryService();
    const conv = { ...makeConversation('s'), providerState: {} } as Conversation;
    const out = await svc.deleteConversationSessionV2(conv, { vaultPath: null, reason: 'open' });
    expect(out).toEqual({ kind: 'no-op', reason: 'no-session' });
  });
});
