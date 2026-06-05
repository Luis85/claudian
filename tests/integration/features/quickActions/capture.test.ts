import type { ChatMessage } from '@/core/types';
import { eligibleMessageActions } from '@/features/chat/rendering/messageActions';
import { deriveSeedName, isCaptureEligible } from '@/features/quickActions/captureFromMessage';
import { parseQuickActionContent } from '@/features/quickActions/quickActionParse';
import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';

function makeAdapter(initial = new Map<string, string>()) {
  return {
    exists: jest.fn(async (p: string) => initial.has(p)),
    read: jest.fn(async (p: string) => initial.get(p) ?? ''),
    write: jest.fn(async (p: string, c: string) => { initial.set(p, c); }),
    delete: jest.fn(async (p: string) => { initial.delete(p); }),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => Array.from(initial.keys())),
    append: jest.fn(),
  } as any;
}

const captureAction = {
  id: 'capture-prompt-as-quick-action',
  label: 'Capture as quick action',
  icon: 'bookmark-plus',
  isEligible: isCaptureEligible,
  run: jest.fn(),
};

describe('capture flow integration', () => {
  it('shows the action for plain user messages and hides it for command prefixes', () => {
    const user: ChatMessage = { id: 'u', role: 'user', content: 'Summarize this PR', timestamp: 0 } as ChatMessage;
    const command: ChatMessage = { id: 'c', role: 'user', content: '/compact', timestamp: 0 } as ChatMessage;
    const assistant: ChatMessage = { id: 'a', role: 'assistant', content: 'sure', timestamp: 0 } as ChatMessage;

    expect(eligibleMessageActions([captureAction], user).map((a) => a.id)).toContain('capture-prompt-as-quick-action');
    expect(eligibleMessageActions([captureAction], command)).toEqual([]);
    expect(eligibleMessageActions([captureAction], assistant)).toEqual([]);
  });

  it('writes a parseable quick-action file when the seeded modal saves', async () => {
    const fs = new Map<string, string>();
    const storage = new QuickActionStorage(makeAdapter(fs), () => 'Quick Actions');

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Summarize the highlighted note in three bullet points.',
      timestamp: 0,
    } as ChatMessage;

    const action = {
      id: deriveSeedName(msg.content!),
      name: deriveSeedName(msg.content!),
      description: deriveSeedName(msg.content!),
      prompt: msg.content!,
      filePath: '',
    };

    const filePath = await storage.save(action);
    // deriveSeedName truncates the 54-char source to 50 chars + ellipsis, then
    // getFilePathForName slugifies non-alphanumerics (the trailing ellipsis
    // collapses), yielding the bullet-poi tail below.
    expect(filePath).toBe('Quick Actions/summarize-the-highlighted-note-in-three-bullet-poi.md');

    const parsed = parseQuickActionContent(fs.get(filePath)!, filePath);
    expect(parsed?.prompt).toBe(msg.content);
    expect(parsed?.name).toBe(deriveSeedName(msg.content!));
  });

  it('blocks a second capture against the same slug via the storage.exists guard', async () => {
    const fs = new Map<string, string>();
    const storage = new QuickActionStorage(makeAdapter(fs), () => 'Quick Actions');

    const action = { id: 'Dup', name: 'Dup', description: 'd', prompt: 'one', filePath: '' };
    const firstPath = await storage.save(action);
    expect(await storage.exists(firstPath)).toBe(true);

    const targetPath = storage.getFilePathForName('Dup');
    expect(targetPath).toBe(firstPath);
    expect(await storage.exists(targetPath)).toBe(true);
  });
});
