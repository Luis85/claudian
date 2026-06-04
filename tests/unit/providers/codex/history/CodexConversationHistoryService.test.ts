import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { HydrationContext } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { CodexConversationHistoryService } from '@/providers/codex/history/CodexConversationHistoryService';
import * as Store from '@/providers/codex/history/CodexHistoryStore';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 't',
    messages: [],
    providerId: 'codex',
    sessionId: 'thread-a',
    providerState: { threadId: 'thread-a', sessionFilePath: '/codex/sess-a.jsonl' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Conversation;
}
const ctx: HydrationContext = { vaultPath: null, reason: 'open' };

describe('CodexConversationHistoryService.hydrateConversationHistoryV2', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns empty:no-session when there is no thread id and no session file path', async () => {
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation({ sessionId: null, providerState: {} });
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('empty');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'empty') expect(out.reason).toBe('no-session');
  });

  it('returns loaded with a stable sourceRef and the parsed messages on normal hydration', async () => {
    jest.spyOn(Store, 'parseCodexSessionFile').mockReturnValue([
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never,
    ]);
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('loaded');
    if (out.kind === 'loaded') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.sourceRef).toBe('thread-a::/codex/sess-a.jsonl');
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.messages.length).toBe(1);
    }
  });

  it('returns empty:no-rows when the session file parses to zero messages', async () => {
    jest.spyOn(Store, 'parseCodexSessionFile').mockReturnValue([]);
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('empty');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'empty') expect(out.reason).toBe('no-rows');
  });

  it('bypasses the hydration cache for established forks (re-runs the merge on every open)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-codex-fork-'));
    const transcript = path.join(dir, 'sess.jsonl');
    fs.writeFileSync(transcript, '{}');
    const turnsSpy = jest.spyOn(Store, 'parseCodexSessionTurns').mockReturnValue([
      { turnId: 't1', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never] },
    ]);

    try {
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation({
        sessionId: null,
        providerState: {
          threadId: 'fork-thread',
          sessionFilePath: transcript,
          forkSource: { sessionId: 'src', resumeAt: 't1' },
          forkSourceSessionFilePath: transcript,
        },
      });

      const first = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(first.kind).toBe('loaded');
      if (first.kind === 'loaded') conv.messages = first.messages;
      const callsAfterFirst = turnsSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);

      // A normal conversation with non-empty messages would short-circuit to
      // `cached` here; an established fork must re-run the source+fork merge so a
      // resolved-later or grown transcript is never served stale.
      const second = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(second.kind).toBe('loaded');
      expect(turnsSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns error:fork-checkpoint-not-found when resumeAt is missing in the source transcript', async () => {
    jest.spyOn(Store, 'parseCodexSessionTurns').mockReturnValue([
      { turnId: 't0', messages: [{ id: 'm0', role: 'user', content: 'hi', timestamp: 1 } as never] },
    ]);
    const conv = makeConversation({
      sessionId: null,
      providerState: {
        forkSource: { sessionId: 'src', resumeAt: 'NEVER' },
        forkSourceSessionFilePath: '/codex/src.jsonl',
      },
    });
    const svc = new CodexConversationHistoryService();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('fork-checkpoint-not-found');
  });
});

describe('CodexConversationHistoryService.deleteConversationSessionV2', () => {
  it('returns no-op:provider-owned (codex native transcripts are never deleted)', async () => {
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.deleteConversationSessionV2(conv, ctx);
    expect(out).toEqual({ kind: 'no-op', reason: 'provider-owned' });
  });
});

describe('CodexConversationHistoryService.forkSupport', () => {
  it('is defined because Codex supports fork', () => {
    const svc = new CodexConversationHistoryService();
    expect(svc.forkSupport).toBeDefined();
    expect(typeof svc.forkSupport?.isPendingForkConversation).toBe('function');
    expect(typeof svc.forkSupport?.buildForkProviderState).toBe('function');
  });

  it('isPendingForkConversation returns true when forkSource is set and threadId/sessionId are absent', () => {
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation({
      sessionId: null,
      providerState: { forkSource: { sessionId: 'src', resumeAt: 't1' } },
    });
    expect(svc.forkSupport?.isPendingForkConversation(conv)).toBe(true);
  });
});
