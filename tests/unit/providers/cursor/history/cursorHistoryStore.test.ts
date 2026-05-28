import * as crypto from 'crypto';

import { TOOL_READ, TOOL_WRITE } from '@/core/tools/toolNames';
import {
  buildChatMessagesFromCursorHistoryRecords,
  cursorWorkspaceHash,
} from '@/providers/cursor/history/cursorHistoryStore';

describe('cursorHistoryStore', () => {
  it('hashes workspace path with md5 hex like Cursor CLI', () => {
    const vaultPath = '/tmp/claudian-test-vault-path';
    expect(cursorWorkspaceHash(vaultPath)).toBe(
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
