/**
 * Specorator - Rewind validation + notice-copy helpers.
 *
 * Extracted from ConversationController.rewind to keep it below the complexity
 * thresholds. The message-structure validation and the mode-dependent notice
 * copy are pure and carry most of the branching weight.
 */

import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatRewindMode, ChatRewindResult } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { findRewindContext } from '../rewind';

type RewindTarget =
  | { ok: true; userMsg: ChatMessage; userMessageId: string; prevAssistantUuid: string }
  | { ok: false; noticeKey: 'errMessageNotFound' | 'unavailableNoUuid' };

/**
 * Validates that `userMessageId` points at a rewindable user message and that a
 * prior assistant UUID exists to rewind to. Pure: emits no side effects, so the
 * caller owns the Notice. `errMessageNotFound` maps to the wrapped
 * `chat.rewind.failed` copy; `unavailableNoUuid` is a standalone notice.
 */
export function resolveRewindTarget(msgs: ChatMessage[], userMessageId: string): RewindTarget {
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    return { ok: false, noticeKey: 'errMessageNotFound' };
  }

  const userMsg = msgs[userIdx];
  if (!userMsg.userMessageId) {
    return { ok: false, noticeKey: 'unavailableNoUuid' };
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    return { ok: false, noticeKey: 'unavailableNoUuid' };
  }

  return {
    ok: true,
    userMsg,
    userMessageId: userMsg.userMessageId,
    prevAssistantUuid: rewindCtx.prevAssistantUuid,
  };
}

type RewindOutcome =
  | { ok: true; result: ChatRewindResult }
  | { ok: false; notice: string };

/**
 * Resolves the active runtime, dispatches the rewind, and validates the result.
 * Returns the rewind result on success or a ready-to-show notice on any failure
 * (missing/unsupported service, runtime throw, or a `canRewind: false` result).
 *
 * `rewind` is optional on ChatRuntime (ADR-0001 Phase 2); providers without the
 * capability omit the method entirely. The caller's `supportsRewind` gate
 * already blocks unsupported providers — the `typeof` check is the TS narrowing
 * for the runtime-side optional signature.
 */
export async function runRewind(
  agentService: ChatRuntime | null,
  userMessageId: string,
  prevAssistantUuid: string,
  mode: ChatRewindMode,
): Promise<RewindOutcome> {
  if (!agentService) {
    return { ok: false, notice: t('chat.rewind.failed', { error: t('chat.rewind.errServiceUnavailable') }) };
  }
  if (typeof agentService.rewind !== 'function') {
    return { ok: false, notice: t('chat.rewind.failed', { error: t('chat.rewind.errUnsupported') }) };
  }

  let result: ChatRewindResult;
  try {
    result = await agentService.rewind(userMessageId, prevAssistantUuid, mode);
  } catch (e) {
    return { ok: false, notice: t('chat.rewind.failed', { error: e instanceof Error ? e.message : t('chat.rewind.errUnknown') }) };
  }

  if (!result.canRewind) {
    return { ok: false, notice: t('chat.rewind.cannot', { error: result.error ?? t('chat.rewind.errUnknown') }) };
  }

  return { ok: true, result };
}

export function rewindConfirmMessage(mode: ChatRewindMode): string {
  return mode === 'conversation'
    ? t('chat.rewind.confirmMessageConversationOnly')
    : t('chat.rewind.confirmMessage');
}

export function rewindSaveFailedNotice(mode: ChatRewindMode, filesChanged: number, error: string): string {
  return mode === 'conversation'
    ? t('chat.rewind.noticeConversationOnlySaveFailed', { error })
    : t('chat.rewind.noticeSaveFailed', { count: String(filesChanged), error });
}

export function rewindSuccessNotice(mode: ChatRewindMode, filesChanged: number): string {
  return mode === 'conversation'
    ? t('chat.rewind.noticeConversationOnly')
    : t('chat.rewind.notice', { count: String(filesChanged) });
}
