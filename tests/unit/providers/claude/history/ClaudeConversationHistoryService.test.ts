import type { HydrationContext } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { ClaudeConversationHistoryService } from '@/providers/claude/history/ClaudeConversationHistoryService';
import * as Store from '@/providers/claude/history/ClaudeHistoryStore';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 't',
    messages: [],
    providerId: 'claude',
    sessionId: 'sdk-sess-a',
    providerState: { providerSessionId: 'sdk-sess-a' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Conversation;
}
const ctx: HydrationContext = { vaultPath: '/vault', reason: 'open' };

describe('ClaudeConversationHistoryService.hydrateConversationHistory', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns empty:no-session when vaultPath is null', async () => {
    const svc = new ClaudeConversationHistoryService();
    const out = await svc.hydrateConversationHistory(makeConversation(), { vaultPath: null, reason: 'open' });
    expect(out.kind).toBe('empty');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'empty') expect(out.reason).toBe('no-session');
  });

  it('returns loaded with a composite sourceRef covering previous + current sessions', async () => {
    jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
    jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never],
      skippedLines: 0,
    });
    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation({
      providerState: {
        providerSessionId: 'sdk-sess-current',
        previousProviderSessionIds: ['sdk-sess-prev-1', 'sdk-sess-prev-2'],
      },
    });
    const out = await svc.hydrateConversationHistory(conv, ctx);
    expect(out.kind).toBe('loaded');
    if (out.kind === 'loaded') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.sourceRef).toContain('sdk-sess-current');
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.sourceRef).toContain('sdk-sess-prev-1');
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.sourceRef).toContain('sdk-sess-prev-2');
    }
  });

  it('cache key includes resumeAtMessageId so rewind invalidates the cache', async () => {
    jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
    const loadSpy = jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never],
      skippedLines: 0,
    });
    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation();

    const first = await svc.hydrateConversationHistory(conv, ctx);
    if (first.kind === 'loaded') conv.messages = first.messages;

    (conv as unknown as { resumeAtMessageId: string }).resumeAtMessageId = 'm-prior';
    const second = await svc.hydrateConversationHistory(conv, ctx);

    expect(second.kind).toBe('loaded');
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('propagates ctx.signal.aborted mid-load between previous-session reads', async () => {
    jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
    const controller = new AbortController();
    let callCount = 0;
    jest.spyOn(Store, 'loadSDKSessionMessages').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) controller.abort();
      return { messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never], skippedLines: 0 };
    });

    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation({
      providerState: {
        providerSessionId: 'sdk-sess-current',
        previousProviderSessionIds: ['sdk-sess-prev-1', 'sdk-sess-prev-2'],
      },
    });
    const out = await svc.hydrateConversationHistory(conv, { ...ctx, signal: controller.signal });

    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('cancelled');
    expect(callCount).toBe(1);
  });

  it('returns error:store-unreadable when every load reports an error', async () => {
    jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
    jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
      messages: [],
      skippedLines: 0,
      error: 'simulated SDK load failure',
    });
    const svc = new ClaudeConversationHistoryService();
    const out = await svc.hydrateConversationHistory(makeConversation(), ctx);
    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('store-unreadable');
  });

  it('returns empty:no-session when every previousSessionId is missing on disk', async () => {
    jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(false);
    const svc = new ClaudeConversationHistoryService();
    const out = await svc.hydrateConversationHistory(makeConversation(), ctx);
    expect(out.kind).toBe('empty');
  });
});

describe('ClaudeConversationHistoryService.deleteConversationSession', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns deleted with the SDK session path when deletion succeeds', async () => {
    const deleteSpy = jest.spyOn(Store, 'deleteSDKSession').mockResolvedValue(undefined);
    const svc = new ClaudeConversationHistoryService();
    const out = await svc.deleteConversationSession(makeConversation(), ctx);
    expect(deleteSpy).toHaveBeenCalledWith('/vault', 'sdk-sess-a');
    expect(out.kind).toBe('deleted');
  });

  it('returns no-op:no-session when sessionId is unresolved or vaultPath is null', async () => {
    const svc = new ClaudeConversationHistoryService();
    const out = await svc.deleteConversationSession(
      makeConversation({ sessionId: null, providerState: {} }),
      ctx,
    );
    expect(out).toEqual({ kind: 'no-op', reason: 'no-session' });
  });
});

describe('ClaudeConversationHistoryService.forkSupport', () => {
  it('is defined because Claude supports fork', () => {
    const svc = new ClaudeConversationHistoryService();
    expect(svc.forkSupport).toBeDefined();
    expect(typeof svc.forkSupport?.isPendingForkConversation).toBe('function');
    expect(typeof svc.forkSupport?.buildForkProviderState).toBe('function');
  });
});
