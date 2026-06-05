import * as os from 'node:os';
import * as path from 'node:path';

import type { HydrationContext } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { extractLastUsageFromSdkMessages } from '@/providers/claude/history/ClaudeConversationHistoryService';
import * as ClaudeStore from '@/providers/claude/history/ClaudeHistoryStore';
import {
  CodexConversationHistoryService,
  extractLastUsageFromCodexJsonl,
} from '@/providers/codex/history/CodexConversationHistoryService';
import * as CodexStore from '@/providers/codex/history/CodexHistoryStore';
import { CursorConversationHistoryService, extractLastUsageFromCursorRecords } from '@/providers/cursor/history/CursorConversationHistoryService';
import * as CursorStore from '@/providers/cursor/history/cursorHistoryStore';
import {
  extractLastUsageFromOpencodeMessageData,
  OpencodeConversationHistoryService,
} from '@/providers/opencode/history/OpencodeConversationHistoryService';
import * as OpencodeStore from '@/providers/opencode/history/OpencodeHistoryStore';

const CTX: HydrationContext = { vaultPath: '/vault', reason: 'open' };

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'c1',
    title: 't',
    messages: [],
    providerId: 'claude',
    sessionId: null,
    providerState: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Conversation;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

describe('Claude extractLastUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads usage from the last main-agent assistant row + result modelUsage', async () => {
    const messages = [
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 30,
          },
        },
      },
      {
        type: 'result',
        modelUsage: { 'claude-sonnet-4': { contextWindow: 200_000 } },
      },
    ];

    const usage = extractLastUsageFromSdkMessages(messages);
    expect(usage).not.toBeNull();
    expect(usage?.model).toBe('claude-sonnet-4');
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.cacheCreationInputTokens).toBe(50);
    expect(usage?.cacheReadInputTokens).toBe(30);
    expect(usage?.contextTokens).toBe(180);
    expect(usage?.contextWindow).toBe(200_000);
    expect(usage?.contextWindowIsAuthoritative).toBe(true);
  });

  it('skips subagent assistant rows (parent_tool_use_id present)', () => {
    const messages = [
      {
        type: 'assistant',
        parent_tool_use_id: 'task-1',
        message: {
          model: 'claude-sonnet-4',
          usage: { input_tokens: 99999 },
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-sonnet-4',
          usage: { input_tokens: 200 },
        },
      },
    ];
    const usage = extractLastUsageFromSdkMessages(messages);
    expect(usage?.inputTokens).toBe(200);
  });

  it('returns null when no assistant usage is present', () => {
    expect(extractLastUsageFromSdkMessages([{ type: 'user' }])).toBeNull();
    expect(extractLastUsageFromSdkMessages([])).toBeNull();
  });

  it('returns null when assistant has usage but no model id', () => {
    const messages = [
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { usage: { input_tokens: 100 } },
      },
    ];
    expect(extractLastUsageFromSdkMessages(messages)).toBeNull();
  });

  it('falls back to heuristic context window when result has no modelUsage', () => {
    const messages = [
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-sonnet-4',
          usage: { input_tokens: 100 },
        },
      },
    ];
    const usage = extractLastUsageFromSdkMessages(messages);
    expect(usage?.contextWindow).toBe(200_000); // CONTEXT_WINDOW_STANDARD
    expect(usage?.contextWindowIsAuthoritative).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

describe('Codex extractLastUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads usage from the last event_msg/token_count row', () => {
    const lines = [
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', model_context_window: 272000 } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user' }, model: 'gpt-5.5' }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 4000,
              cached_input_tokens: 800,
              output_tokens: 1000,
              reasoning_output_tokens: 300,
            },
          },
        },
      }),
    ];
    const usage = extractLastUsageFromCodexJsonl(lines.join('\n'));
    expect(usage).not.toBeNull();
    expect(usage?.inputTokens).toBe(4000);
    expect(usage?.cacheReadInputTokens).toBe(800);
    expect(usage?.outputTokens).toBe(1000);
    expect(usage?.reasoningOutputTokens).toBe(300);
    // contextTokens = input + output + reasoning (cached_input is part of input on the wire)
    expect(usage?.contextTokens).toBe(5300);
    expect(usage?.contextWindow).toBe(272000);
    expect(usage?.contextWindowIsAuthoritative).toBe(true);
  });

  it('returns null when the JSONL has no token_count event', () => {
    expect(extractLastUsageFromCodexJsonl('')).toBeNull();
    expect(extractLastUsageFromCodexJsonl(JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }))).toBeNull();
  });

  it('falls back to default primary model when no model id is in the transcript', () => {
    const line = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 100 } },
      },
    });
    const usage = extractLastUsageFromCodexJsonl(line);
    expect(usage?.model).toBe('gpt-5.5');
  });

  it('service.extractLastUsage swallows fs failures and returns null', async () => {
    jest
      .spyOn(CodexStore, 'findCodexSessionFile')
      .mockReturnValue('/no/such/file.jsonl');
    const svc = new CodexConversationHistoryService();
    const conv = makeConversation({
      providerId: 'codex',
      sessionId: 'thread-a',
      providerState: { threadId: 'thread-a' },
    });
    expect(await svc.extractLastUsage(conv, CTX)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opencode
// ---------------------------------------------------------------------------

describe('Opencode extractLastUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads tokens + modelID from the last assistant message data', () => {
    const usage = extractLastUsageFromOpencodeMessageData({
      role: 'assistant',
      modelID: 'opencode/claude-opus-4',
      tokens: {
        input: 1200,
        output: 800,
        reasoning: 100,
        cache: { read: 500, write: 50 },
      },
      cost: 0.42,
    });
    expect(usage).not.toBeNull();
    expect(usage?.model).toBe('opencode/claude-opus-4');
    expect(usage?.inputTokens).toBe(1200);
    expect(usage?.outputTokens).toBe(800);
    expect(usage?.thoughtTokens).toBe(100);
    expect(usage?.cacheReadInputTokens).toBe(500);
    expect(usage?.cacheCreationInputTokens).toBe(50);
    expect(usage?.contextTokens).toBe(1200 + 800 + 500 + 50);
    expect(usage?.costUsd).toBe(0.42);
  });

  it('returns null when tokens are all zero', () => {
    const usage = extractLastUsageFromOpencodeMessageData({
      role: 'assistant',
      modelID: 'x',
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    expect(usage).toBeNull();
  });

  it('returns null when modelID is missing', () => {
    const usage = extractLastUsageFromOpencodeMessageData({
      role: 'assistant',
      tokens: { input: 100, output: 50 },
    });
    expect(usage).toBeNull();
  });

  it('service.extractLastUsage returns null when no row is loaded', async () => {
    jest.spyOn(OpencodeStore, 'loadOpencodeLastAssistantData').mockResolvedValue(null);
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'opencode',
      sessionId: 'sess-a',
    });
    expect(await svc.extractLastUsage(conv, CTX)).toBeNull();
  });

  it('service.extractLastUsage returns null when conversation has no sessionId', async () => {
    const loadSpy = jest
      .spyOn(OpencodeStore, 'loadOpencodeLastAssistantData')
      .mockResolvedValue({});
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'opencode',
      sessionId: null,
    });
    expect(await svc.extractLastUsage(conv, CTX)).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('service.extractLastUsage wires the loaded row through the extractor', async () => {
    jest.spyOn(OpencodeStore, 'loadOpencodeLastAssistantData').mockResolvedValue({
      role: 'assistant',
      modelID: 'opencode/claude-sonnet-4',
      tokens: { input: 100, output: 50 },
    });
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'opencode',
      sessionId: 'sess-a',
    });
    const usage = await svc.extractLastUsage(conv, CTX);
    expect(usage?.model).toBe('opencode/claude-sonnet-4');
    expect(usage?.inputTokens).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

describe('Cursor extractLastUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads usage + model from raw blob records', () => {
    const records = [
      { type: 'system', model: 'cursor-sonnet-4' },
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hi back' },
      {
        type: 'usage',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
      },
    ];
    const usage = extractLastUsageFromCursorRecords(records);
    expect(usage).not.toBeNull();
    expect(usage?.model).toBe('cursor-sonnet-4');
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
    expect(usage?.contextTokens).toBe(150);
  });

  it('returns null when no model is stamped in the records', () => {
    const records = [
      {
        type: 'usage',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ];
    expect(extractLastUsageFromCursorRecords(records)).toBeNull();
  });

  it('returns null when no usage record is present', () => {
    const records = [
      { type: 'system', model: 'cursor-sonnet-4' },
      { type: 'user', content: 'hi' },
    ];
    expect(extractLastUsageFromCursorRecords(records)).toBeNull();
  });

  it('walks back to front so the latest usage event wins', () => {
    const records = [
      { type: 'system', model: 'cursor-sonnet-4' },
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      { type: 'usage', usage: { input_tokens: 999, output_tokens: 50, total_tokens: 1049 } },
    ];
    const usage = extractLastUsageFromCursorRecords(records);
    expect(usage?.inputTokens).toBe(999);
    expect(usage?.contextTokens).toBe(1049);
  });

  it('service.extractLastUsage returns null when db path is unresolved', async () => {
    jest.spyOn(CursorStore, 'resolveCursorStoreDbPath').mockReturnValue(null);
    const svc = new CursorConversationHistoryService();
    const conv = makeConversation({
      providerId: 'cursor',
      sessionId: null,
      providerState: { chatSessionId: 'sess-a' },
    });
    expect(await svc.extractLastUsage(conv, CTX)).toBeNull();
  });

  it('service.extractLastUsage feeds raw records into the extractor', async () => {
    jest.spyOn(CursorStore, 'resolveCursorStoreDbPath').mockReturnValue(
      path.join(os.tmpdir(), 'fake.db'),
    );
    jest.spyOn(CursorStore, 'loadCursorRawRecords').mockReturnValue([
      { type: 'system', model: 'cursor-sonnet-4' },
      { type: 'usage', usage: { input_tokens: 100, output_tokens: 50 } },
    ]);
    const svc = new CursorConversationHistoryService();
    const conv = makeConversation({
      providerId: 'cursor',
      sessionId: null,
      providerState: { chatSessionId: 'sess-a' },
    });
    const usage = await svc.extractLastUsage(conv, CTX);
    expect(usage?.model).toBe('cursor-sonnet-4');
    expect(usage?.inputTokens).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Claude live service path
// ---------------------------------------------------------------------------

describe('ClaudeConversationHistoryService.extractLastUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('walks the persisted JSONL via readSDKSession', async () => {
    // Lazy import to keep the test isolated from the contract suite's eager
    // self-registration imports above.
    const { ClaudeConversationHistoryService } = await import(
      '@/providers/claude/history/ClaudeConversationHistoryService'
    );
    jest.spyOn(ClaudeStore, 'readSDKSession').mockResolvedValue({
      messages: [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            model: 'claude-sonnet-4',
            usage: { input_tokens: 256 },
          },
        } as never,
      ],
      skippedLines: 0,
    });
    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'claude',
      sessionId: 'sdk-a',
      providerState: { providerSessionId: 'sdk-a' },
    });
    const usage = await svc.extractLastUsage(conv, CTX);
    expect(usage?.model).toBe('claude-sonnet-4');
    expect(usage?.inputTokens).toBe(256);
  });

  it('returns null when readSDKSession reports an error', async () => {
    const { ClaudeConversationHistoryService } = await import(
      '@/providers/claude/history/ClaudeConversationHistoryService'
    );
    jest.spyOn(ClaudeStore, 'readSDKSession').mockResolvedValue({
      messages: [],
      skippedLines: 0,
      error: 'simulated',
    });
    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'claude',
      sessionId: 'sdk-a',
      providerState: { providerSessionId: 'sdk-a' },
    });
    expect(await svc.extractLastUsage(conv, CTX)).toBeNull();
  });

  it('returns null when no vault path is provided', async () => {
    const { ClaudeConversationHistoryService } = await import(
      '@/providers/claude/history/ClaudeConversationHistoryService'
    );
    const svc = new ClaudeConversationHistoryService();
    const conv = makeConversation({
      providerId: 'claude',
      sessionId: 'sdk-a',
    });
    expect(await svc.extractLastUsage(conv, { vaultPath: null, reason: 'open' })).toBeNull();
  });
});

