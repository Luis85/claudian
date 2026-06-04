import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ClaudeProviderState } from '@/providers/claude/types/providerState';
import type { CodexProviderState } from '@/providers/codex/types';
import type { CursorProviderState } from '@/providers/cursor/types';
import type { OpencodeProviderState } from '@/providers/opencode/types';

describe('history service buildPersistedProviderState typing', () => {
  it('claude returns ClaudeProviderState | undefined', () => {
    const svc = ProviderRegistry.getConversationHistoryService('claude');
    const result = svc.buildPersistedProviderState?.({ id: 'x', messages: [], providerState: {} } as never);
    const _typed: ClaudeProviderState | undefined = result as ClaudeProviderState | undefined;
    expect(_typed === undefined || typeof _typed === 'object').toBe(true);
  });

  it('codex returns CodexProviderState | undefined', () => {
    const svc = ProviderRegistry.getConversationHistoryService('codex');
    const result = svc.buildPersistedProviderState?.({ id: 'x', messages: [], providerState: {} } as never);
    const _typed: CodexProviderState | undefined = result as CodexProviderState | undefined;
    expect(_typed === undefined || typeof _typed === 'object').toBe(true);
  });

  it('opencode returns OpencodeProviderState | undefined', () => {
    const svc = ProviderRegistry.getConversationHistoryService('opencode');
    const result = svc.buildPersistedProviderState?.({
      id: 'x',
      messages: [],
      providerState: { databasePath: '/tmp/db' },
    } as never);
    const _typed: OpencodeProviderState | undefined = result as OpencodeProviderState | undefined;
    expect(_typed === undefined || typeof _typed === 'object').toBe(true);
  });

  it('cursor returns CursorProviderState | undefined', () => {
    const svc = ProviderRegistry.getConversationHistoryService('cursor');
    const result = svc.buildPersistedProviderState?.({
      id: 'x',
      messages: [],
      sessionId: 'sess',
      providerState: { chatSessionId: 'sess' },
    } as never);
    const _typed: CursorProviderState | undefined = result as CursorProviderState | undefined;
    expect(_typed === undefined || typeof _typed === 'object').toBe(true);
  });
});
