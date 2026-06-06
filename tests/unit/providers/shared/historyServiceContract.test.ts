// Provider registrations are imported here for their side effect — every
// provider must self-register so the contract matrix can address them by id.
import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type {
  HistoryLoadOutcome,
  HydrationContext,
  ProviderId,
} from '@/core/providers/types';
import type { ChatMessage, Conversation } from '@/core/types';
import * as ClaudeStore from '@/providers/claude/history/ClaudeHistoryStore';
import * as CodexStore from '@/providers/codex/history/CodexHistoryStore';
import * as CursorStore from '@/providers/cursor/history/cursorHistoryStore';
import * as OpencodeStore from '@/providers/opencode/history/OpencodeHistoryStore';

type Scenario =
  | 'loaded'
  | 'empty'
  | 'error-unreadable'
  | 'error-sqlite-unavailable'
  | 'cached'
  | 'force-refresh'
  | 'cancelled'
  | 'delete-no-session';

interface ProviderHarness {
  id: ProviderId;
  /**
   * How many times the provider's loader is expected to be invoked per
   * `hydrateConversationHistory` call when the path reaches `loadMessages`.
   * Claude walks `previousProviderSessionIds + current`, so its seed produces
   * two reads per hydration; the other providers do a single read.
   */
  callsPerHydrate: number;
  /**
   * Builds a fresh `Conversation` whose provider state yields a stable,
   * non-null cache key (so the `cached` scenario can verify the cache hit).
   */
  seedConversation: () => Conversation;
  /**
   * Installs scenario-specific spies on the provider's Store module exports
   * and returns the spies so the test can introspect call counts.
   */
  stubStore: (scenario: Scenario) => jest.SpyInstance[];
}

const SAMPLE_MESSAGE: ChatMessage = {
  id: 'm1',
  role: 'user',
  content: 'hi',
  timestamp: 1,
};

const CTX: HydrationContext = { vaultPath: '/vault', reason: 'open' };

// ---------------------------------------------------------------------------
// Per-provider harnesses
// ---------------------------------------------------------------------------

const claudeHarness: ProviderHarness = {
  id: 'claude',
  callsPerHydrate: 2,
  seedConversation: () => ({
    id: 'conv-claude',
    title: 't',
    messages: [],
    providerId: 'claude',
    sessionId: 'sdk-sess-curr',
    providerState: {
      providerSessionId: 'sdk-sess-curr',
      previousProviderSessionIds: ['sdk-sess-prev'],
    },
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Conversation),
  stubStore: (scenario) => {
    const spies: jest.SpyInstance[] = [];
    const existsSpy = jest.spyOn(ClaudeStore, 'sdkSessionExists');
    spies.push(existsSpy);

    switch (scenario) {
      case 'loaded':
      case 'cached':
      case 'force-refresh': {
        existsSpy.mockReturnValue(true);
        spies.push(
          jest.spyOn(ClaudeStore, 'loadSDKSessionMessages').mockResolvedValue({
            messages: [SAMPLE_MESSAGE],
            skippedLines: 0,
          }),
        );
        break;
      }
      case 'empty': {
        // No session files on disk → all-sessions-missing → empty:no-session.
        existsSpy.mockReturnValue(false);
        spies.push(
          jest.spyOn(ClaudeStore, 'loadSDKSessionMessages').mockResolvedValue({
            messages: [],
            skippedLines: 0,
          }),
        );
        break;
      }
      case 'error-unreadable': {
        existsSpy.mockReturnValue(true);
        spies.push(
          jest.spyOn(ClaudeStore, 'loadSDKSessionMessages').mockResolvedValue({
            messages: [],
            skippedLines: 0,
            error: 'simulated SDK load failure',
          }),
        );
        break;
      }
      case 'error-sqlite-unavailable': {
        // Claude's loader has no sqlite path; the closest analogue is "no
        // session on disk", which the service maps to empty:no-session.
        existsSpy.mockReturnValue(false);
        spies.push(
          jest.spyOn(ClaudeStore, 'loadSDKSessionMessages').mockResolvedValue({
            messages: [],
            skippedLines: 0,
          }),
        );
        break;
      }
      case 'cancelled': {
        existsSpy.mockReturnValue(true);
        spies.push(
          jest.spyOn(ClaudeStore, 'loadSDKSessionMessages').mockResolvedValue({
            messages: [SAMPLE_MESSAGE],
            skippedLines: 0,
          }),
        );
        break;
      }
      case 'delete-no-session': {
        spies.push(jest.spyOn(ClaudeStore, 'deleteSDKSession').mockResolvedValue(undefined));
        break;
      }
    }

    return spies;
  },
};

const codexHarness: ProviderHarness = {
  id: 'codex',
  callsPerHydrate: 1,
  seedConversation: () => ({
    id: 'conv-codex',
    title: 't',
    messages: [],
    providerId: 'codex',
    sessionId: 'thread-a',
    providerState: {
      threadId: 'thread-a',
      sessionFilePath: '/codex/sess-a.jsonl',
    },
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Conversation),
  stubStore: (scenario) => {
    const spies: jest.SpyInstance[] = [];

    switch (scenario) {
      case 'loaded':
      case 'cached':
      case 'force-refresh':
      case 'cancelled': {
        spies.push(
          jest.spyOn(CodexStore, 'parseCodexSessionFile').mockReturnValue([SAMPLE_MESSAGE]),
        );
        break;
      }
      case 'empty':
      case 'error-unreadable':
      case 'error-sqlite-unavailable': {
        // Codex JSONL parser swallows fs read errors and returns []; the
        // service maps empty results to empty:no-rows. The 'error-*'
        // scenarios collapse to the same outcome for Codex.
        spies.push(
          jest.spyOn(CodexStore, 'parseCodexSessionFile').mockReturnValue([]),
        );
        break;
      }
      case 'delete-no-session': {
        // Codex never deletes its native transcripts; no spies needed.
        break;
      }
    }

    return spies;
  },
};

const opencodeHarness: ProviderHarness = {
  id: 'opencode',
  callsPerHydrate: 1,
  seedConversation: () => ({
    id: 'conv-opencode',
    title: 't',
    messages: [],
    providerId: 'opencode',
    sessionId: 'sess-a',
    providerState: { databasePath: '/tmp/oc.db' },
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Conversation),
  stubStore: (scenario) => {
    const spies: jest.SpyInstance[] = [];

    switch (scenario) {
      case 'loaded':
      case 'cached':
      case 'force-refresh':
      case 'cancelled': {
        spies.push(
          jest.spyOn(OpencodeStore, 'loadOpencodeSessionMessages').mockResolvedValue({
            messages: [SAMPLE_MESSAGE],
          }),
        );
        break;
      }
      case 'empty': {
        spies.push(
          jest.spyOn(OpencodeStore, 'loadOpencodeSessionMessages').mockResolvedValue({
            messages: [],
          }),
        );
        break;
      }
      case 'error-unreadable': {
        spies.push(
          jest.spyOn(OpencodeStore, 'loadOpencodeSessionMessages').mockResolvedValue({
            messages: [],
            error: {
              code: 'store-unreadable',
              message: 'Could not read OpenCode session rows from SQLite.',
            },
          }),
        );
        break;
      }
      case 'error-sqlite-unavailable': {
        spies.push(
          jest.spyOn(OpencodeStore, 'loadOpencodeSessionMessages').mockResolvedValue({
            messages: [],
            error: {
              code: 'sqlite-unavailable',
              message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
            },
          }),
        );
        break;
      }
      case 'delete-no-session': {
        // Opencode never deletes its native transcripts; no spies needed.
        break;
      }
    }

    return spies;
  },
};

const cursorHarness: ProviderHarness = {
  id: 'cursor',
  callsPerHydrate: 1,
  seedConversation: () => ({
    id: 'conv-cursor',
    title: 't',
    messages: [],
    providerId: 'cursor',
    sessionId: null,
    providerState: { chatSessionId: 'cursor-sess-a' },
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Conversation),
  stubStore: (scenario) => {
    const spies: jest.SpyInstance[] = [];
    // A stable, non-null db path keeps the cache key deterministic across
    // hydrate calls so the `cached` scenario can verify the hit.
    const stubDbPath = '/cursor-fake/.cursor/chats/h/cursor-sess-a/store.db';
    const dbPathSpy = jest.spyOn(CursorStore, 'resolveCursorStoreDbPath');
    spies.push(dbPathSpy);

    switch (scenario) {
      case 'loaded':
      case 'cached':
      case 'force-refresh':
      case 'cancelled': {
        dbPathSpy.mockReturnValue(stubDbPath);
        spies.push(
          jest.spyOn(CursorStore, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
            messages: [SAMPLE_MESSAGE],
          }),
        );
        break;
      }
      case 'empty': {
        dbPathSpy.mockReturnValue(stubDbPath);
        spies.push(
          jest.spyOn(CursorStore, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
            messages: [],
          }),
        );
        break;
      }
      case 'error-unreadable': {
        dbPathSpy.mockReturnValue(stubDbPath);
        spies.push(
          jest.spyOn(CursorStore, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
            messages: [],
            error: 'Cursor history: SQL read failed (...)',
          }),
        );
        break;
      }
      case 'error-sqlite-unavailable': {
        dbPathSpy.mockReturnValue(stubDbPath);
        spies.push(
          jest.spyOn(CursorStore, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
            messages: [],
            error: {
              code: 'sqlite-unavailable',
              message: 'Cursor history requires Node 22.5+ (node:sqlite).',
            },
          }),
        );
        break;
      }
      case 'delete-no-session': {
        // Delete walks the chats dir using fs; no Store-level stub needed.
        // The test exercises the no-session path by zeroing vaultPath.
        break;
      }
    }

    return spies;
  },
};

const harnesses: ProviderHarness[] = [
  claudeHarness,
  codexHarness,
  opencodeHarness,
  cursorHarness,
];

// ---------------------------------------------------------------------------
// Parameterized contract suite
// ---------------------------------------------------------------------------

describe.each(harnesses)('history service contract — $id', (h) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function service() {
    return ProviderRegistry.getConversationHistoryService(h.id);
  }

  it('loaded: messages present, sourceRef set', async () => {
    h.stubStore('loaded');
    const conv = h.seedConversation();
    const out = await service().hydrateConversationHistory(conv, CTX);
    expect(out.kind).toBe('loaded');
    if (out.kind === 'loaded') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.messages.length).toBeGreaterThan(0);
      // eslint-disable-next-line jest/no-conditional-expect
      expect(typeof out.sourceRef).toBe('string');
    }
  });

  it('empty: returns empty when the loader produces zero rows', async () => {
    h.stubStore('empty');
    const conv = h.seedConversation();
    const out = await service().hydrateConversationHistory(conv, CTX);
    expect(out.kind).toBe('empty');
  });

  it('error-unreadable: returns error (or empty for Codex JSONL swallowing)', async () => {
    h.stubStore('error-unreadable');
    const conv = h.seedConversation();
    const out = await service().hydrateConversationHistory(conv, CTX);
    // Codex parses JSONL with fs.readFileSync wrapped in try/catch, so a
    // simulated read failure surfaces as an empty parse result, not an
    // error. Every other provider must surface a structured error.
    const expectedKind = h.id === 'codex' ? 'empty' : 'error';
    expect(out.kind).toBe(expectedKind);
  });

  it('error-sqlite-unavailable: maps to empty for Claude/Codex, error for Opencode/Cursor', async () => {
    h.stubStore('error-sqlite-unavailable');
    const conv = h.seedConversation();
    const out = await service().hydrateConversationHistory(conv, CTX);
    // Claude + Codex have no sqlite path. The harness drives them down
    // their equivalent dead-end (missing session / empty JSONL), which
    // maps to `empty` in the contract. Opencode/Cursor surface the
    // structured error verbatim.
    const surfacesSqliteUnavailable = h.id === 'opencode' || h.id === 'cursor';
    const expectedKind = surfacesSqliteUnavailable ? 'error' : 'empty';
    expect(out.kind).toBe(expectedKind);
    const errorCode = out.kind === 'error' ? out.error.code : null;
    const expectedCode = surfacesSqliteUnavailable ? 'sqlite-unavailable' : null;
    expect(errorCode).toBe(expectedCode);
  });

  it('cached: second hydration with stable state returns cached', async () => {
    const spies = h.stubStore('cached');
    const conv = h.seedConversation();
    const first = await service().hydrateConversationHistory(conv, CTX);
    expect(first.kind).toBe('loaded');
    if (first.kind === 'loaded') {
      // BaseHistoryService only seeds the cache when conversation.messages is
      // populated; ConversationStore owns this assignment in production.
      conv.messages = first.messages;
    }
    const second = await service().hydrateConversationHistory(conv, CTX);
    expect(second.kind).toBe('cached');
    // The loader spies (last entry after any path-resolver) should have been
    // hit exactly `callsPerHydrate` times total — the second call is served
    // from cache without touching the Store loader again.
    const loaderSpy = spies[spies.length - 1];
    expect(loaderSpy).toHaveBeenCalledTimes(h.callsPerHydrate);
  });

  it('force-refresh: bypasses cache and re-invokes the loader', async () => {
    const spies = h.stubStore('force-refresh');
    const conv = h.seedConversation();
    const first = await service().hydrateConversationHistory(conv, CTX);
    if (first.kind === 'loaded') {
      conv.messages = first.messages;
    }
    const second = await service().hydrateConversationHistory(conv, {
      ...CTX,
      forceRefresh: true,
    });
    expect(second.kind).toBe('loaded');
    const loaderSpy = spies[spies.length - 1];
    expect(loaderSpy).toHaveBeenCalledTimes(h.callsPerHydrate * 2);
  });

  it('cancelled: aborted signal returns error:cancelled without touching the loader', async () => {
    const spies = h.stubStore('cancelled');
    const controller = new AbortController();
    controller.abort();
    const conv = h.seedConversation();
    const out = await service().hydrateConversationHistory(conv, {
      ...CTX,
      signal: controller.signal,
    });
    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('cancelled');
    // The base class short-circuits before reaching `loadMessages`, so the
    // loader spy (the last spy added by the harness) should never have run.
    const loaderSpy = spies[spies.length - 1];
    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it('delete: returns no-op (or deleted with empty paths) when no session can be resolved', async () => {
    h.stubStore('delete-no-session');
    // Strip the seed of any disk-resolvable identity so every provider falls
    // into its "nothing to delete" branch.
    const conv = h.seedConversation();
    (conv as { sessionId: string | null }).sessionId = null;
    (conv as { providerState: Record<string, unknown> }).providerState = {};

    const out = await service().deleteConversationSession(conv, {
      vaultPath: null,
      reason: 'open',
    });

    // Contract: when no session is resolvable, providers either return a
    // `no-op` (Claude, Codex, Opencode, Cursor on null vaultPath) or a
    // `deleted` with no removed paths. `error` would mean we destroyed
    // state we couldn't even identify, which is a regression.
    expect(['no-op', 'deleted']).toContain(out.kind);
    const deletedPaths = out.kind === 'deleted' ? out.paths : [];
    expect(deletedPaths).toEqual([]);
  });
});

// Defensive helper: pins that HistoryLoadOutcome covers all kinds we exercise.
// Catches accidental kind drift before it propagates into renderers.
function _exhaustiveOutcomeCheck(outcome: HistoryLoadOutcome): string {
  switch (outcome.kind) {
    case 'loaded': return 'loaded';
    case 'cached': return 'cached';
    case 'empty': return 'empty';
    case 'error': return 'error';
  }
}
// Reference the helper so lint's no-unused-vars stays quiet without an
// inline disable; the call is dead code in jest but keeps the type guard live.
void _exhaustiveOutcomeCheck;
