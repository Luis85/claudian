import * as fs from 'fs';
import * as nodePath from 'path';

import type { ExitPlanModeDecision } from '../../../core/types/tools';
import {
  activateInlineCard,
  CHOICE_CARD_HINTS_TEXT,
  InlineChoiceList,
} from './inlineChoiceCard';
import type { RenderContentFn } from './MessageRenderer';
import { renderPlanContentPreview } from './planContentPreview';

export class InlineExitPlanMode {
  private containerEl: HTMLElement;
  private input: Record<string, unknown>;
  private resolveCallback: (decision: ExitPlanModeDecision | null) => void;
  private resolved = false;
  private signal?: AbortSignal;
  private renderContent?: RenderContentFn;
  private planPathPrefix?: string;
  private planContent: string | null = null;
  private planReadError: string | null = null;

  private rootEl!: HTMLElement;
  private choices: InlineChoiceList | null = null;
  private disposeActivation: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (decision: ExitPlanModeDecision | null) => void,
    signal?: AbortSignal,
    renderContent?: RenderContentFn,
    planPathPrefix?: string,
  ) {
    this.containerEl = containerEl;
    this.input = input;
    this.resolveCallback = resolve;
    this.signal = signal;
    this.renderContent = renderContent;
    this.planPathPrefix = planPathPrefix;
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'claudian-plan-approval-inline' });

    const titleEl = this.rootEl.createDiv({ cls: 'claudian-plan-inline-title' });
    titleEl.setText('Plan complete');

    this.planContent = this.readPlanContent();
    renderPlanContentPreview({
      rootEl: this.rootEl,
      content: this.planContent,
      errorMessage: this.planReadError
        ? `Could not read plan file: ${this.planReadError}. "Approve (new session)" will not include plan details.`
        : null,
      renderContent: this.renderContent,
    });

    const allowedPrompts = this.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
    if (allowedPrompts && Array.isArray(allowedPrompts) && allowedPrompts.length > 0) {
      const permEl = this.rootEl.createDiv({ cls: 'claudian-plan-permissions' });
      permEl.createDiv({ text: 'Requested permissions:', cls: 'claudian-plan-permissions-label' });
      const listEl = permEl.createEl('ul', { cls: 'claudian-plan-permissions-list' });
      for (const perm of allowedPrompts) {
        listEl.createEl('li', { text: perm.prompt });
      }
    }

    this.choices = new InlineChoiceList(
      this.rootEl,
      [
        {
          kind: 'action',
          label: 'Approve (new session)',
          onSelect: () => this.handleResolve({
            type: 'approve-new-session',
            planContent: this.extractPlanContent(),
          }),
        },
        {
          kind: 'action',
          label: 'Approve (current session)',
          onSelect: () => this.handleResolve({ type: 'approve' }),
        },
        {
          kind: 'input',
          placeholder: 'Enter feedback to continue planning...',
          onSubmit: (text) => this.handleResolve({ type: 'feedback', text }),
        },
      ],
      () => this.handleResolve(null),
    );
    this.choices.render(this.rootEl.createDiv({ cls: 'claudian-ask-list' }));

    this.rootEl.createDiv({ text: CHOICE_CARD_HINTS_TEXT, cls: 'claudian-ask-hints' });

    this.disposeActivation = activateInlineCard({
      rootEl: this.rootEl,
      onKeyDown: (e) => this.choices?.handleKeyDown(e),
      signal: this.signal,
      onAbort: () => this.handleResolve(null),
    });
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private readPlanContent(): string | null {
    const planFilePath = this.input.planFilePath as string | undefined;
    if (!planFilePath) return null;

    const resolved = nodePath.resolve(planFilePath).replace(/\\/g, '/');
    if (!this.planPathPrefix || !resolved.includes(this.planPathPrefix)) {
      this.planReadError = 'path outside allowed plan directory';
      return null;
    }

    try {
      const content = fs.readFileSync(planFilePath, 'utf-8');
      return content.trim() || null;
    } catch (err) {
      this.planReadError = err instanceof Error ? err.message : 'unknown error';
      return null;
    }
  }

  private extractPlanContent(): string {
    if (this.planContent) {
      return `Implement this plan:\n\n${this.planContent}`;
    }
    return 'Implement the approved plan.';
  }

  private handleResolve(decision: ExitPlanModeDecision | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.disposeActivation?.();
      this.disposeActivation = null;
      this.rootEl?.remove();
      this.resolveCallback(decision);
    }
  }
}
