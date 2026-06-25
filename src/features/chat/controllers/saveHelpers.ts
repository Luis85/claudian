/**
 * Specorator - Conversation-save assembly helpers.
 *
 * Extracted from ConversationController.save to keep it below the complexity
 * thresholds. Gathering the optional context selections and assembling the
 * `Partial<Conversation>` update payload carry the bulk of the branching.
 */

import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { Conversation } from '../../../core/types';
import type SpecoratorPlugin from '../../../main';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';

/**
 * Lazily creates a conversation for an entry-point tab that now has messages,
 * setting `state.currentConversationId`. New conversations always use SDK-native
 * storage. No-op when a conversation already exists.
 */
export async function ensureConversationForSave(
  plugin: SpecoratorPlugin,
  state: ChatState,
  agentService: ChatRuntime | null,
): Promise<void> {
  if (state.currentConversationId || state.messages.length === 0) return;

  const conversation = await plugin.createConversation({
    providerId: agentService?.providerId,
    sessionId: agentService?.getSessionId() ?? undefined,
  });
  state.currentConversationId = conversation.id;
}

export function resolveSessionUpdates(
  agentService: ChatRuntime | null,
  conversation: Conversation | null,
  sessionInvalidated: boolean,
): Partial<Conversation> {
  if (!agentService) return {};
  return agentService.buildSessionUpdates({ conversation, sessionInvalidated }).updates;
}

export interface SaveSelections {
  currentNote: string | undefined;
  externalContextPaths: string[];
  enabledMcpServers: string[];
}

export function collectSaveSelections(
  fileCtx: FileContextManager | null,
  externalContextSelector: ExternalContextSelector | null,
  mcpServerSelector: McpServerSelector | null,
): SaveSelections {
  return {
    currentNote: fileCtx?.getCurrentNotePath() || undefined,
    externalContextPaths: externalContextSelector?.getExternalContexts() ?? [],
    enabledMcpServers: mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [],
  };
}

export interface BuildUpdatesInput {
  sessionUpdates: Partial<Conversation>;
  state: ChatState;
  selections: SaveSelections;
  workOrderPath: string | null;
  updateLastResponse: boolean;
  options?: { resumeAtMessageId?: string };
}

export function buildConversationUpdates(input: BuildUpdatesInput): Partial<Conversation> {
  const { sessionUpdates, state, selections, workOrderPath, updateLastResponse, options } = input;

  // `Partial<Conversation>`: a `null` from a normal tab omits the key and
  // leaves any stored value intact, so this only writes when the active tab
  // resolves to a work-order path.
  const updates: Partial<Conversation> = {
    ...sessionUpdates,
    messages: state.messages,
    currentNote: selections.currentNote,
    externalContextPaths: selections.externalContextPaths.length > 0
      ? selections.externalContextPaths
      : undefined,
    usage: state.usage ?? undefined,
    enabledMcpServers: selections.enabledMcpServers.length > 0
      ? selections.enabledMcpServers
      : undefined,
    ...(workOrderPath ? { workOrderPath } : {}),
  };

  if (updateLastResponse) {
    updates.lastResponseAt = Date.now();
  }

  if (options) {
    updates.resumeAtMessageId = options.resumeAtMessageId;
  }

  return updates;
}
