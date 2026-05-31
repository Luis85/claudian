import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { runColdStartQuery } from './claudeColdStartQuery';

export interface ClaudeAuxQueryRunnerOptions {
  /** Tools available to the model. Omit for the SDK default (all tools). */
  tools?: string[];
  hooks?: Options['hooks'];
  /** Disable thinking configuration (e.g. title generation). */
  disableThinking?: boolean;
  /** Default: SDK default (true). Set false for one-shot, non-resumable queries. */
  persistSession?: boolean;
  /**
   * Resolve the model for a query. Receives the per-query override from
   * AuxQueryConfig.model when present. Returns undefined to defer to the
   * provider setting inside the cold-start query.
   */
  resolveModel?: (override?: string) => string | undefined;
  /**
   * Provide a pre-fetched provider settings snapshot to the cold-start query
   * (e.g. inline edit, which reads scoped Claude settings).
   */
  resolveProviderSettings?: () => Record<string, unknown>;
}

/**
 * Adapts the Claude cold-start query to the shared AuxQueryRunner contract so
 * the QueryBacked* auxiliary services can drive title generation, instruction
 * refinement, and inline edit. Conversation continuity is preserved by tracking
 * the SDK session id and resuming it across calls; reset() ends the conversation.
 */
export class ClaudeAuxQueryRunner implements AuxQueryRunner {
  private sessionId: string | null = null;

  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly options: ClaudeAuxQueryRunnerOptions = {},
  ) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const result = await runColdStartQuery(
      {
        abortController: config.abortController,
        hooks: this.options.hooks,
        model: this.options.resolveModel?.(config.model) ?? config.model,
        onTextChunk: config.onTextChunk,
        persistSession: this.options.persistSession,
        plugin: this.plugin,
        providerSettings: this.options.resolveProviderSettings?.(),
        resumeSessionId: this.sessionId ?? undefined,
        systemPrompt: config.systemPrompt,
        thinking: this.options.disableThinking ? { disabled: true } : undefined,
        tools: this.options.tools,
      },
      prompt,
    );

    this.sessionId = result.sessionId;
    return result.text;
  }

  reset(): void {
    this.sessionId = null;
  }
}
