import type { App } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredToolCall } from './ToolCallRenderer';

/**
 * Capability + app escapes the subagent projector reads from the owning
 * {@link MessageRenderer}; `getCapabilities` is live so a provider switch is
 * reflected without re-wiring.
 */
export interface MessageSubagentRendererDeps {
  readonly app: App;
  getCapabilities(): ProviderCapabilities;
}

/**
 * Projects Task / provider-lifecycle tool calls into `SubagentInfo` and renders
 * the stored subagent block. Extracted from `MessageRenderer` so the message
 * orchestrator delegates the (sync/async Task, spawn+wait consolidation,
 * async-status inference) projection to a focused sibling.
 */
export class MessageSubagentRenderer {
  constructor(private readonly deps: MessageSubagentRendererDeps) {}

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.deps.getCapabilities().providerId, toolName);
  }

  renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(this.deps.app, contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(this.deps.app, contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(this.deps.app, contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(this.deps.app, contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }
}
