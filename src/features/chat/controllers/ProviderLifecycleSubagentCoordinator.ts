import type { ProviderSubagentLifecycleAdapter } from '../../../core/providers/types';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import type SpecoratorPlugin from '../../../main';
import { createSubagentBlock, finalizeSubagentBlock, type SubagentState } from '../rendering/SubagentRenderer';
import { appendToolCallToMessage, createRunningToolCall } from './toolCallAppend';

/**
 * Provider lifecycle subagents (spawn → wait/close): the CLI-provider tool
 * calls (Codex / Claude lifecycle adapters) that spawn a subagent, then resolve
 * it through a later wait/close tool. Owns the spawn-callId ↔ block and
 * agentId ↔ spawn-callId maps the lifecycle needs. Distinct from the
 * `SubagentManager`-mediated Task subagents (see `SubagentStreamCoordinator`).
 * `StreamController` routes `tool_use` here via `dispatchToolUse` and
 * `tool_result` via `handleProviderSubagentResult`; the shared streaming
 * primitives arrive as `deps` callbacks.
 */
export interface ProviderLifecycleSubagentCoordinatorDeps {
  plugin: SpecoratorPlugin;
  state: { currentContentEl: HTMLElement | null };
  findToolCall: (msg: ChatMessage, id: string) => ToolCallInfo | undefined;
  normalizeToolResultContent: (content: unknown) => string;
  getSubagentLifecycleAdapter: (toolName?: string) => ProviderSubagentLifecycleAdapter | null;
  flushPendingTools: () => void;
}

export class ProviderLifecycleSubagentCoordinator {
  private deps: ProviderLifecycleSubagentCoordinatorDeps;

  private lifecycleSubagentStates = new Map<string, SubagentState>(); // spawn callId → SubagentState
  private lifecycleAgentIdToSpawnId = new Map<string, string>();      // agentId → spawn callId

  constructor(deps: ProviderLifecycleSubagentCoordinatorDeps) {
    this.deps = deps;
  }

  /**
   * Routes a `tool_use` chunk to the provider spawn/hidden handlers. Returns
   * true when the tool was a provider lifecycle tool and was consumed.
   */
  dispatchToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
  ): boolean {
    const adapter = this.deps.getSubagentLifecycleAdapter(chunk.name);
    if (adapter?.isSpawnTool(chunk.name)) {
      this.handleProviderSubagentSpawn(chunk, msg, adapter);
      return true;
    }
    if (adapter?.isHiddenTool(chunk.name)) {
      this.handleProviderHiddenSubagentTool(chunk, msg);
      return true;
    }
    return false;
  }

  private handleProviderSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;

    const toolCall = createRunningToolCall(chunk);
    appendToolCallToMessage(msg, toolCall);

    // Render as subagent block immediately
    if (state.currentContentEl) {
      this.deps.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);

      const subagentState = createSubagentBlock(this.deps.plugin.app, state.currentContentEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
  }

  private handleProviderHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    // Track in toolCalls for data completeness, but don't create DOM or content block
    const toolCall = createRunningToolCall(chunk);
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
  }

  /**
   * Handles tool_result for provider lifecycle subagent tools.
   * Returns true if the result was consumed (caller should return early).
   */
  handleProviderSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage
  ): boolean {
    const existingToolCall = this.deps.findToolCall(msg, chunk.id);
    if (!existingToolCall) return false;
    const normalizedContent = this.deps.normalizeToolResultContent(chunk.content);

    const adapter = this.deps.getSubagentLifecycleAdapter(existingToolCall.name);
    if (!adapter) return false;

    if (adapter.isSpawnTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      this.applyProviderSubagentSpawnResult(chunk, msg, adapter, existingToolCall, normalizedContent);
      return true;
    }

    if (adapter.isWaitTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      this.applyProviderSubagentWaitResult(msg, adapter, existingToolCall);
      return true;
    }

    if (adapter.isCloseTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      return true;
    }

    return false;
  }

  /** Maps a completed spawn tool's result onto its lifecycle subagent block. */
  private applyProviderSubagentSpawnResult(
    chunk: { id: string; isError?: boolean },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
    existingToolCall: ToolCallInfo,
    normalizedContent: string,
  ): void {
    const spawnResult = adapter.extractSpawnResult(normalizedContent);
    if (spawnResult.agentId) {
      this.lifecycleAgentIdToSpawnId.set(spawnResult.agentId, chunk.id);
    }

    const subagentState = this.lifecycleSubagentStates.get(chunk.id);
    if (!subagentState) return;

    const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
    subagentState.info.description = subagentInfo.description;
    subagentState.info.prompt = subagentInfo.prompt;
    subagentState.labelEl.setText(
      subagentInfo.description.length > 40
        ? subagentInfo.description.substring(0, 40) + '...'
        : subagentInfo.description
    );

    if (chunk.isError) {
      finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
    }
  }

  /** Finalizes each spawned subagent block resolved by a completed wait tool. */
  private applyProviderSubagentWaitResult(
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
    existingToolCall: ToolCallInfo,
  ): void {
    for (const spawnId of adapter.resolveSpawnToolIds(
      existingToolCall,
      this.lifecycleAgentIdToSpawnId,
    )) {
      const spawnToolCall = this.deps.findToolCall(msg, spawnId);
      const subagentState = this.lifecycleSubagentStates.get(spawnId);
      if (!spawnToolCall || !subagentState) continue;

      const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
      subagentState.info.description = subagentInfo.description;
      subagentState.info.prompt = subagentInfo.prompt;

      if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
        finalizeSubagentBlock(
          subagentState,
          subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
          subagentInfo.status === 'error'
        );
      }
    }
  }
}
