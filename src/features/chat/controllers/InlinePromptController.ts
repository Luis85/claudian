import { Notice } from 'obsidian';

import type { ApprovalCallbackOptions, ApprovalDecisionOption } from '../../../core/runtime/types';
import type { ApprovalDecision, ExitPlanModeDecision } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { buildPlanArtifactFromChatState } from '../../../utils/planArtifact';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePlanApproval, type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import { setToolIcon } from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  'Deny': 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    label,
    value: label,
    decision,
  }));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface InlinePromptControllerDeps {
  state: ChatState;
  getInputContainerEl: () => HTMLElement;
  renderContent: (el: HTMLElement, markdown: string) => Promise<void>;
  hideThinkingIndicator: () => void;
  getPlanPathPrefix: () => string | undefined;
}

/**
 * Owns the inline prompts that block a turn on user input — tool-approval
 * cards, ask-user-question, exit-plan-mode, and the post-plan approval card —
 * plus the input-container hide/restore and the "needs attention" tab badge
 * that accompany them. Extracted from `InputController`; the runtime reaches
 * these through `InputController`'s RuntimeHost-wired delegators, and the
 * post-plan flow calls `showPlanApproval` directly.
 */
export class InlinePromptController {
  private deps: InlinePromptControllerDeps;
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private inputContainerHideDepth = 0;

  constructor(deps: InlinePromptControllerDeps) {
    this.deps = deps;
  }

  async handleApprovalRequest(
    toolName: string,
    _input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    // Build header element, then detach — InlineAskUserQuestion will re-attach it
    const headerEl = parentEl.createDiv({ cls: 'claudian-ask-approval-info' });
    headerEl.remove();

    const toolEl = headerEl.createDiv({ cls: 'claudian-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'claudian-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'claudian-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({ text: approvalOptions.decisionReason, cls: 'claudian-ask-approval-reason' });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({ text: approvalOptions.blockedPath, cls: 'claudian-ask-approval-blocked-path' });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({ text: `Agent: ${approvalOptions.agentID}`, cls: 'claudian-ask-approval-agent' });
    }

    headerEl.createDiv({ text: description, cls: 'claudian-ask-approval-desc' });

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });
    const input = {
      questions: [{
        question: 'Allow this action?',
        options: questionOptions,
        isOther: false,
        isSecret: false,
      }],
    };

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingApprovalInline = inline; },
      undefined,
      { title: 'Permission required', headerEl, showCustomInput: false, immediateSelect: true },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(t('chat.input.unexpectedApprovalSelection', { value: String(selectedValue) }));
      return 'cancel';
    }

    const decision = optionDecisionMap.get(selectedValue);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: selectedValue,
    };
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingAskInline = inline; },
      signal,
    );
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);
    // UX-2: every inline question (approval, ask-user, post-plan approval)
    // surfaces a tab-bar "needs attention" badge so background tabs that
    // are blocked on the user become visible without switching to them.
    this.deps.state.needsAttention = true;

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          setPending(null);
          this.deps.state.needsAttention = false;
          this.restoreInputContainer(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (err) {
        setPending(null);
        this.deps.state.needsAttention = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    const { state } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    this.deps.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);
    // UX-2: surface "needs attention" while the exit-plan-mode prompt blocks.
    state.needsAttention = true;

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderContent(el, markdown);

    const planPathPrefix = this.deps.getPlanPathPrefix();

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          state.needsAttention = false;
          this.restoreInputContainer(inputContainerEl);
          resolve(decision);
        },
        signal,
        renderContent,
        planPathPrefix,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        state.needsAttention = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval(true);
    // UX-2: dismissing flushes every pending prompt above; clear the
    // attention flag so the tab badge returns to its idle state.
    this.deps.state.needsAttention = false;
    this.resetInputContainerVisibility();
  }

  showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      return Promise.resolve({ decision: null, invalidated: false });
    }

    this.hideInputContainer(inputContainerEl);
    this.pendingPlanApprovalInvalidated = false;
    // UX-2: post-plan approval prompt is another tab-blocking input.
    this.deps.state.needsAttention = true;

    const planPathPrefix = this.deps.getPlanPathPrefix();
    const artifact = buildPlanArtifactFromChatState({
      planFilePath: this.deps.state.planFilePath,
    });
    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderContent(el, markdown);

    return new Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>((resolve, reject) => {
      const inline = new InlinePlanApproval(
        parentEl,
        (decision: PlanApprovalDecision | null) => {
          const invalidated = this.pendingPlanApprovalInvalidated;
          this.pendingPlanApprovalInvalidated = false;
          this.pendingPlanApproval = null;
          this.deps.state.needsAttention = false;
          this.restoreInputContainer(inputContainerEl);
          resolve({ decision, invalidated });
        },
        { artifact, planPathPrefix, renderContent },
      );
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.deps.state.needsAttention = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) {
      return;
    }

    if (invalidated) {
      this.pendingPlanApprovalInvalidated = true;
    }
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('claudian-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) {
      inputContainerEl.removeClass('claudian-hidden');
    }
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth > 0) {
      this.inputContainerHideDepth = 0;
      this.deps.getInputContainerEl().removeClass('claudian-hidden');
    }
  }
}
