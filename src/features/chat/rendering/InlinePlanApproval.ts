import type { PlanArtifact } from '../../../core/types/plan';
import { readPlanMarkdownFromArtifact } from '../../../utils/planArtifact';
import {
  activateInlineCard,
  CHOICE_CARD_HINTS_TEXT,
  InlineChoiceList,
} from './inlineChoiceCard';
import type { RenderContentFn } from './MessageRenderer';
import { renderPlanContentPreview } from './planContentPreview';

export type PlanApprovalDecision =
  | { type: 'implement' }
  | { type: 'revise'; text: string }
  | { type: 'cancel' };

export interface InlinePlanApprovalOptions {
  artifact?: PlanArtifact;
  planPathPrefix?: string;
  renderContent?: RenderContentFn;
}

export class InlinePlanApproval {
  private containerEl: HTMLElement;
  private resolveCallback: (decision: PlanApprovalDecision | null) => void;
  private options: InlinePlanApprovalOptions;
  private resolved = false;

  private rootEl!: HTMLElement;
  private choices: InlineChoiceList | null = null;
  private disposeActivation: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    resolve: (decision: PlanApprovalDecision | null) => void,
    options: InlinePlanApprovalOptions = {},
  ) {
    this.containerEl = containerEl;
    this.resolveCallback = resolve;
    this.options = options;
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'specorator-plan-approval-inline' });

    this.rootEl.createDiv({ cls: 'specorator-plan-inline-title', text: 'Plan complete' });

    const { content, error } = readPlanMarkdownFromArtifact(
      this.options.artifact,
      this.options.planPathPrefix,
    );
    renderPlanContentPreview({
      rootEl: this.rootEl,
      content,
      errorMessage: error ? `Could not read plan file: ${error}` : null,
      renderContent: this.options.renderContent,
    });

    this.choices = new InlineChoiceList(
      this.rootEl,
      [
        {
          kind: 'action',
          label: 'Implement',
          onSelect: () => this.handleResolve({ type: 'implement' }),
        },
        {
          kind: 'input',
          placeholder: 'Enter feedback to revise plan...',
          onSubmit: (text) => this.handleResolve({ type: 'revise', text }),
        },
        {
          kind: 'action',
          label: 'Cancel',
          onSelect: () => this.handleResolve({ type: 'cancel' }),
        },
      ],
      () => this.handleResolve(null),
    );
    this.choices.render(this.rootEl.createDiv({ cls: 'specorator-ask-list' }));

    this.rootEl.createDiv({ text: CHOICE_CARD_HINTS_TEXT, cls: 'specorator-ask-hints' });

    this.disposeActivation = activateInlineCard({
      rootEl: this.rootEl,
      onKeyDown: (e) => this.choices?.handleKeyDown(e),
    });
  }

  destroy(): void {
    this.handleResolve(null);
  }

  // Back-compat seam: this state lived on the class before the choice list was
  // shared; existing specs still reach it, so delegate to the widget.
  private get focusedIndex(): number {
    return this.choices ? this.choices.focusedIndex : 0;
  }

  private get isInputFocused(): boolean {
    return this.choices?.isInputFocused ?? false;
  }

  private set isInputFocused(value: boolean) {
    if (this.choices) {
      this.choices.isInputFocused = value;
    }
  }

  private get feedbackInput(): HTMLInputElement | null {
    return this.choices?.inputEl ?? null;
  }

  private handleResolve(decision: PlanApprovalDecision | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.disposeActivation?.();
      this.disposeActivation = null;
      this.rootEl?.remove();
      this.resolveCallback(decision);
    }
  }
}
