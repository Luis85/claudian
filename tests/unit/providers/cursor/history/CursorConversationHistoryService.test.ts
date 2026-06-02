import * as fs from 'fs';
import type * as osTypes from 'os';
import * as path from 'path';

import type { Conversation } from '@/core/types';
import { CursorConversationHistoryService } from '@/providers/cursor/history/CursorConversationHistoryService';
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
} from '@/providers/cursor/history/cursorHistoryStore';

describe('CursorConversationHistoryService getLastHistoryLoadError', () => {
  it('returns no error before hydration runs', () => {
    const service = new CursorConversationHistoryService();
    expect(service.getLastHistoryLoadError('conv-1')).toBeUndefined();
  });

  // Engineer note: end-to-end coverage of the redaction contract lives in
  // tests/unit/providers/cursor/history/cursorHistoryStore.test.ts, which
  // already asserts that loadCursorChatMessagesFromStoreResult never leaks
  // the raw home directory. Arranging a real Conversation + on-disk DB layout
  // inside the service test would require duplicating that surface area, so
  // we gate the getter contract here and rely on the store-level test for
  // the redaction guarantee.
});

describe('CursorConversationHistoryService.deleteConversationSession', () => {
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

  it('removes the normalized-hash chat directory', async () => {
    const vault = '/vault/Test';
    const sessionId = 'sess-normalized';
    const dir = plantChatDir(cursorWorkspaceHash(vault), sessionId);
    expect(fs.existsSync(dir)).toBe(true);

    const service = new CursorConversationHistoryService();
    await service.deleteConversationSession(makeConversation(sessionId), vault);

    expect(fs.existsSync(dir)).toBe(false);
  });

  it('also removes the legacy-hash chat directory so transcripts are not left behind on upgrade', async () => {
    // Mirrors resolveCursorStoreDbPath's two-hash fallback. If a session was
    // created with the pre-normalization hash, deleting only the normalized
    // path would orphan the on-disk transcript.
    const vault = 'D:\\Projects\\Test';
    const sessionId = 'sess-legacy';
    const legacyDir = plantChatDir(cursorWorkspaceHashLegacy(vault), sessionId);
    expect(fs.existsSync(legacyDir)).toBe(true);

    const service = new CursorConversationHistoryService();
    await service.deleteConversationSession(makeConversation(sessionId), vault);

    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it('does nothing when sessionId is "." (validator rejects pure-dot ids)', async () => {
    // Defense-in-depth: even though `.` was caught by the validator, assert
    // here that the service genuinely bails — the workspace chat root must
    // not be deleted under any circumstance.
    const vault = '/vault/Test';
    const chatsRoot = path.join(tmpHome, '.cursor', 'chats');
    fs.mkdirSync(chatsRoot, { recursive: true });
    fs.writeFileSync(path.join(chatsRoot, 'sentinel'), '');

    const service = new CursorConversationHistoryService();
    await service.deleteConversationSession(makeConversation('.'), vault);

    expect(fs.existsSync(path.join(chatsRoot, 'sentinel'))).toBe(true);
  });
});
