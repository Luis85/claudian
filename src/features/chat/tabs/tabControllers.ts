import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { findRewindContext } from '../rewind';
import { getTabProviderId } from './providerResolution';
import {
  buildTabConversationController,
  buildTabInputController,
  buildTabMessageRenderer,
  buildTabNavigationController,
  buildTabSelectionControllers,
  buildTabStreamController,
} from './tabControllerSetup';
import { getTabCapabilities, type ProviderCatalogInfo } from './tabShared';
import type { TabData } from './types';

export interface ForkContext {
  messages: ChatMessage[];
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  resumeAt: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  // Keep fork numbering stable by excluding non-semantic user messages.
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

interface ForkSource {
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  sourceTitle?: string;
  currentNote?: string;
}

/**
 * Resolves session ID and conversation metadata needed for forking.
 * Prefers the live service session ID; falls back to persisted conversation metadata.
 * Shows a notice and returns null when no session can be resolved.
 */
function resolveForkSource(tab: TabData, plugin: ClaudianPlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  // Delegate session ID resolution to the runtime when available;
  // fall back to persisted conversation metadata when no runtime is active.
  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : ProviderRegistry
      .getConversationHistoryService(conversation?.providerId ?? tab.providerId)
      .resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    providerId: getTabProviderId(tab, plugin, conversation),
    sourceSessionId,
    sourceProviderState: conversation?.providerState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

/**
 * Builds the fork request payload from a resolved source plus the per-call
 * checkpoint fields (the only parts that differ between single-message and
 * fork-all). Keeps the shared `source.*` mapping in one place.
 */
function buildForkContext(
  source: ForkSource,
  checkpoint: { messages: ChatMessage[]; resumeAt: string; forkAtUserMessage: number },
): ForkContext {
  return {
    messages: checkpoint.messages,
    providerId: source.providerId,
    sourceSessionId: source.sourceSessionId,
    sourceProviderState: source.sourceProviderState,
    resumeAt: checkpoint.resumeAt,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: checkpoint.forkAtUserMessage,
    currentNote: source.currentNote,
  };
}

/**
 * Shared fork guard: fork must be supported and the tab must not be streaming.
 * Surfaces the matching notice and returns false when forking can't proceed.
 */
function canFork(tab: TabData, plugin: ClaudianPlugin): boolean {
  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice(t('chat.fork.unsupportedProvider'));
    return false;
  }

  if (tab.state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return false;
  }

  return true;
}

async function handleForkRequest(
  tab: TabData,
  plugin: ClaudianPlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!canFork(tab, plugin)) return;

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback(buildForkContext(source, {
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    resumeAt: rewindCtx.prevAssistantUuid,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
  }));
}

async function handleForkAll(
  tab: TabData,
  plugin: ClaudianPlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!canFork(tab, plugin)) return;

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback(buildForkContext(source, {
    messages: deepCloneMessages(msgs),
    resumeAt: lastAssistantUuid,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
  }));
}

export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void {
  // Pre-bind the fork affordances here so the setup builders never import the
  // fork handlers from this module (that would form an import cycle).
  const forkMessageCallback = forkRequestCallback
    ? (userMessageId: string) => handleForkRequest(tab, plugin, userMessageId, forkRequestCallback)
    : undefined;
  const forkAllCallback = forkRequestCallback
    ? () => handleForkAll(tab, plugin, forkRequestCallback)
    : undefined;

  // Fixed construction order: later builders read controllers (and the renderer)
  // constructed by earlier ones, so these calls are not independently reorderable.
  buildTabMessageRenderer(tab, plugin, component, forkMessageCallback);
  buildTabSelectionControllers(tab, plugin);
  buildTabStreamController(tab, plugin);
  buildTabConversationController(tab, plugin, component, getProviderCatalogConfig);
  buildTabInputController(tab, plugin, openConversation, forkAllCallback);
  buildTabNavigationController(tab, plugin);
}

