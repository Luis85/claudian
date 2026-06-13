import { spawn } from 'child_process';
import * as readline from 'readline';

import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { RuntimeHost } from '../../../core/runtime/RuntimeHost';
import type {
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../../core/runtime/types';
import type { ChatMessage, Conversation, SlashCommand, StreamChunk } from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { CURSOR_PROVIDER_CAPABILITIES } from '../capabilities';
import { encodeCursorTurn } from '../prompt/encodeCursorTurn';
import { getCursorState, resolveCursorSessionId } from '../types';
import { acquireCursorAgentSpawnLock } from './cursorAgentSpawnLock';
import { buildCursorAnswerFollowUpPrompt } from './cursorAskUserQuestion';
import { forceKillCursorProcessTree } from './cursorProcessKill';
import {
  awaitCursorExitCode,
  resolveCursorQueryLaunch,
  spawnCursorChild,
} from './cursorQueryLaunch';
import type { CursorQueryChunkTracker } from './cursorQueryLifecycle';
import { finalizeCursorAgentStream, processCursorAgentNdjsonLines } from './cursorQueryProcessing';

const SIGKILL_TIMEOUT_MS = 3_000;

export class CursorChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId = 'cursor';

  private plugin: PluginContext;
  private ready = false;
  private readyListeners = new Set<(ready: boolean) => void>();
  private canceled = false;
  private child: ReturnType<typeof spawn> | null = null;
  private lastSessionId: string | null = null;
  private activeResumeId: string | null = null;
  private turnMetadata: ChatTurnMetadata = {};
  private readonly host: RuntimeHost;
  private askUserQuestionAbortController: AbortController | null = null;
  /** In-flight child termination, so a later cleanup() can await a cancel()-started kill. */
  private pendingTermination: Promise<void> | null = null;

  constructor(plugin: PluginContext, host: RuntimeHost) {
    this.plugin = plugin;
    this.host = host;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return CURSOR_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeCursorTurn(request);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.turnMetadata };
    this.turnMetadata = {};
    return metadata;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    if (!conversation) {
      this.activeResumeId = null;
      return;
    }
    this.activeResumeId = resolveCursorSessionId(conversation);
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const cli = this.plugin.getResolvedProviderCliPath('cursor');
    const nextReady = !!cli;
    if (this.ready !== nextReady) {
      this.ready = nextReady;
      for (const listener of this.readyListeners) {
        listener(nextReady);
      }
    }
    return nextReady;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.turnMetadata = {};
    this.canceled = false;
    this.askUserQuestionAbortController?.abort();
    this.askUserQuestionAbortController = new AbortController();

    const cli = this.plugin.getResolvedProviderCliPath('cursor');
    if (!cli) {
      yield { type: 'error', content: 'Cursor Agent CLI not found. Configure it in Cursor settings.' };
      yield { type: 'done' };
      return;
    }

    const resumeId = this.activeResumeId;

    yield {
      type: 'user_message_start',
      content: turn.persistedContent,
    };
    yield { type: 'assistant_message_start' };

    const { workspaceDir, launch, env, isPlanTurn, cleanupPromptFile } = resolveCursorQueryLaunch({
      plugin: this.plugin,
      cli,
      turn,
      conversationHistory,
      queryOptions,
      resumeId,
    });
    const releaseSpawnLock = await acquireCursorAgentSpawnLock();
    let chunkTracker: CursorQueryChunkTracker;
    try {
      const spawned = spawnCursorChild(spawn, launch, env, workspaceDir);
      const child = spawned.child;
      this.child = child;

      const rl = readline.createInterface({ input: child.stdout! });

      try {
        async function* ndjsonLines(): AsyncGenerator<string> {
          for await (const line of rl) {
            yield line;
          }
        }

        const stream = processCursorAgentNdjsonLines(ndjsonLines(), {
          askCallback: (input, signal) => this.host.askUser(input, signal),
          askSignal: this.askUserQuestionAbortController?.signal,
          isPlanTurn,
          isCanceled: () => this.canceled,
          onSessionId: (sessionId) => {
            this.lastSessionId = sessionId;
          },
        });

        let next = await stream.next();
        while (!next.done) {
          yield next.value;
          next = await stream.next();
        }
        chunkTracker = next.value;
      } finally {
        rl.close();
      }

      const exitCode = await awaitCursorExitCode(child, spawned.hadSpawnError);

      this.child = null;
      this.askUserQuestionAbortController?.abort();
      this.askUserQuestionAbortController = null;

      const { completionChunks, turnMetadata } = finalizeCursorAgentStream(
        chunkTracker,
        isPlanTurn,
        {
          canceled: this.canceled,
          sawDone: chunkTracker.sawDone,
          exitCode,
          stderr: spawned.stderrText(),
        },
      );
      yield* completionChunks;

      this.applyCursorTurnResult(chunkTracker, turnMetadata);
    } finally {
      cleanupPromptFile?.();
      releaseSpawnLock();
    }
  }

  /**
   * Commits per-turn state after the stream drains: promote the new session id
   * to the active resume id, merge plan/turn metadata, and stage any collected
   * AskUserQuestion answers as an auto-resumed follow-up. The follow-up is
   * skipped on cancel so a torn-down turn never auto-fires another query.
   */
  private applyCursorTurnResult(
    chunkTracker: CursorQueryChunkTracker,
    turnMetadata: ChatTurnMetadata,
  ): void {
    if (this.lastSessionId) {
      this.activeResumeId = this.lastSessionId;
    }

    this.turnMetadata = { ...this.turnMetadata, ...turnMetadata };

    if (chunkTracker.askUserAnswers.length > 0 && !this.canceled) {
      this.turnMetadata.autoFollowUpText = buildCursorAnswerFollowUpPrompt(chunkTracker.askUserAnswers);
    }
  }

  cancel(): void {
    // Fire-and-forget mid-turn cancellation: tear the child down without making
    // callers wait. cleanup() reuses the same termination flow but awaits exit.
    void this.terminateChild();
  }

  /**
   * Sends SIGTERM, escalates to SIGKILL if the child ignores it, and resolves
   * once the child has actually exited. A hard give-up ceiling guarantees the
   * promise can never hang teardown even if 'exit' never fires. Mirrors
   * AcpSubprocess.shutdown() so provider switch/reinit can await child exit.
   */
  private terminateChild(): Promise<void> {
    this.canceled = true;
    this.askUserQuestionAbortController?.abort();
    this.askUserQuestionAbortController = null;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      // A termination may already be in flight from a prior cancel(); return it so
      // cleanup() awaits the real child exit instead of resolving early (which would
      // re-introduce the switch/reinit overlap this guards against).
      return this.pendingTermination ?? Promise.resolve();
    }
    this.child = null;

    const termination = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(killTimer);
        window.clearTimeout(giveUpTimer);
        child.off('exit', onExit);
        resolve();
      };
      const onExit = () => finish();
      // Escalate if cursor-agent (or a descendant holding a pipe open) ignores
      // SIGTERM, so cancel/teardown can't hang on child exit. On Windows this
      // tree-kills via taskkill to also reap orphaned bash/git grandchildren.
      const killTimer = window.setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          forceKillCursorProcessTree(child);
        }
      }, SIGKILL_TIMEOUT_MS);
      // Hard ceiling: never let teardown hang if 'exit' never fires.
      const giveUpTimer = window.setTimeout(finish, SIGKILL_TIMEOUT_MS * 2);

      child.once('exit', onExit);
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already gone between the guard and the kill — nothing to await.
        finish();
      }
    });
    this.pendingTermination = termination;
    return termination;
  }

  resetSession(): void {
    this.lastSessionId = null;
    this.activeResumeId = null;
  }

  getSessionId(): string | null {
    return this.lastSessionId;
  }

  consumeSessionInvalidation(): boolean {
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  async cleanup(): Promise<void> {
    // Await the child's actual exit so provider switch/reinit never overlaps the
    // outgoing CLI process with a freshly constructed replacement runtime.
    await this.terminateChild();
    this.readyListeners.clear();
  }

  // rewind() omitted — Cursor Agent does not support rewind
  // (supportsRewind: false). Callers gate on capability; ADR-0001 Phase 2.

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    if (params.sessionInvalidated && params.conversation) {
      return {
        updates: {
          sessionId: null,
          providerState: undefined,
        },
      };
    }

    const sid = this.lastSessionId;
    const existing = params.conversation ? getCursorState(params.conversation.providerState) : {};
    const providerState: Record<string, unknown> = { ...existing };
    if (sid) {
      providerState.chatSessionId = sid;
    }

    return {
      updates: {
        sessionId: sid,
        providerState: Object.keys(providerState).length > 0 ? providerState : undefined,
      },
    };
  }

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    return null;
  }

}
