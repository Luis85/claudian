import * as crypto from 'crypto';
import * as fs from 'fs';
import type * as osType from 'os';
import * as path from 'path';

const os = jest.requireActual<typeof osType>('os');

import { TOOL_READ, TOOL_WRITE } from '@/core/tools/toolNames';
import {
  buildChatMessagesFromCursorHistoryRecords,
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
  loadCursorChatMessagesFromStoreResult,
  resolveCursorStoreDbPath,
} from '@/providers/cursor/history/cursorHistoryStore';

describe('cursorHistoryStore', () => {
  it('legacy hash matches raw md5 of workspace path (pre-normalization Cursor CLI behavior)', () => {
    const vaultPath = '/tmp/claudian-test-vault-path';
    expect(cursorWorkspaceHashLegacy(vaultPath)).toBe(
      crypto.createHash('md5').update(vaultPath).digest('hex'),
    );
  });
});

describe('buildChatMessagesFromCursorHistoryRecords', () => {
  it('normalizes tool-call and tool-result blobs like the live stream mapper', () => {
    const messages = buildChatMessagesFromCursorHistoryRecords([
      {
        rowId: 'user-1',
        record: { role: 'user', content: 'Please update README' },
      },
      {
        rowId: 'asst-1',
        record: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Reading first.' },
            {
              type: 'tool-call',
              toolCallId: 'tc-read',
              toolName: 'readToolCall',
              args: { path: 'README.md' },
            },
          ],
        },
      },
      {
        rowId: 'tool-1',
        record: {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'tc-read',
            result: { success: { content: '# Title' } },
          }],
        },
      },
      {
        rowId: 'asst-2',
        record: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Editing now.' },
            {
              type: 'tool-call',
              toolCallId: 'tc-edit',
              toolName: 'editToolCall',
              args: { path: 'README.md', streamContent: '# Title\n\nBody' },
            },
          ],
        },
      },
      {
        rowId: 'tool-2',
        record: {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'tc-edit',
            result: {
              success: {
                path: 'README.md',
                message: 'Updated',
                diffString: '@@ -1 +2 @@\n-# Title\n+# Title\n+\n+Body',
              },
            },
          }],
        },
      },
    ]);

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(messages[0].content).toBe('Please update README');

    const readAssistant = messages[1];
    expect(readAssistant.toolCalls?.[0]).toMatchObject({
      id: 'tc-read',
      name: TOOL_READ,
      input: { file_path: 'README.md' },
      status: 'completed',
      result: '# Title',
    });

    const editAssistant = messages[2];
    expect(editAssistant.toolCalls?.[0]).toMatchObject({
      id: 'tc-edit',
      name: TOOL_WRITE,
      input: { file_path: 'README.md', content: '# Title\n\nBody' },
      status: 'completed',
    });
    expect(editAssistant.toolCalls?.[0]?.diffData?.filePath).toBe('README.md');
    expect(editAssistant.toolCalls?.[0]?.diffData?.diffLines.length).toBeGreaterThan(0);
  });

  it('skips IDE bootstrap user blobs', () => {
    const messages = buildChatMessagesFromCursorHistoryRecords([
      {
        rowId: 'boot',
        record: { role: 'user', content: '<user_info>secret</user_info>' },
      },
      {
        rowId: 'real',
        record: { role: 'user', content: 'hello' },
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello');
  });
});

describe('cursorWorkspaceHash (normalized)', () => {
  const realPlatform = process.platform;
  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }
  afterEach(() => setPlatform(realPlatform));

  it('produces the same hash for differently-cased Windows paths', () => {
    setPlatform('win32');
    expect(cursorWorkspaceHash('D:\\Projects\\Claudian'))
      .toBe(cursorWorkspaceHash('d:\\projects\\claudian'));
  });

  it('keeps POSIX paths case-sensitive', () => {
    setPlatform('linux');
    expect(cursorWorkspaceHash('/home/user/Vault'))
      .not.toBe(cursorWorkspaceHash('/home/user/vault'));
  });

  it('normalizes trailing slashes', () => {
    setPlatform('linux');
    expect(cursorWorkspaceHash('/home/user/vault'))
      .toBe(cursorWorkspaceHash('/home/user/vault/'));
  });
});

describe('loadCursorChatMessagesFromStoreResult', () => {
  it('returns an error when the database cannot be opened', () => {
    const result = loadCursorChatMessagesFromStoreResult('/definitely/does/not/exist.db');
    expect(result.messages).toEqual([]);
    expect(result.error).toBeDefined();
    // After Task 5 the open path emits a structured HistoryLoadError.
    expect(typeof result.error).toBe('object');
    // eslint-disable-next-line jest/no-conditional-expect
    if (result.error && typeof result.error === 'object') expect(result.error.code).toBe('store-unreadable');
  });

  it('does not leak the home directory through the structured error', () => {
    const home = os.homedir();
    const dbPath = `${home}/.cursor/chats/abc/xyz/store.db`;
    const result = loadCursorChatMessagesFromStoreResult(dbPath);
    expect(result.error).toBeDefined();
    // Structured error: HOME must not leak through the user-facing message OR
    // the debug-only detail field that the leveled logger consumes. Detail
    // passes through `redactHomeInPath` before reaching callers; the underlying
    // node:sqlite open error doesn't always embed the path itself (depends on
    // Node build), so we assert non-leak rather than the sentinel presence.
    const err = result.error;
    if (err && typeof err === 'object') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(err.message).not.toContain(home);
      // eslint-disable-next-line jest/no-conditional-expect
      expect(err.detail ?? '').not.toContain(home);
    } else {
      // Legacy string path (kept for SQL-read inline failures).
      // eslint-disable-next-line jest/no-conditional-expect
      expect(err).not.toContain(home);
      // eslint-disable-next-line jest/no-conditional-expect
      expect(err).toContain('[HOME]');
    }
  });
});

describe('resolveCursorStoreDbPath two-hash fallback', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-test-home-'));
  let homedirSpy: jest.SpyInstance;
  beforeAll(() => { homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome); });
  afterAll(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('falls back to the legacy hash when the normalized hash has no store', () => {
    const vault = 'D:\\Projects\\Claudian';
    const legacy = cursorWorkspaceHashLegacy(vault);
    const legacyDir = path.join(tmpHome, '.cursor', 'chats', legacy, 'sess-123');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'store.db'), '');

    const resolved = resolveCursorStoreDbPath(vault, 'sess-123');
    expect(resolved).toBe(path.join(legacyDir, 'store.db'));
  });
});
