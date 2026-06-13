import type { RenderContentFn } from './MessageRenderer';

/**
 * Renders the plan-content preview block shared by the two plan-approval cards
 * ({@link InlineExitPlanMode} and {@link InlinePlanApproval}). When `content`
 * is present it renders through the provided markdown renderer (falling back to
 * a plain text div); when only `error` is present it renders the read-error
 * notice. The error copy differs per card, so the formatted message is passed in
 * rather than built here.
 */
export function renderPlanContentPreview(params: {
  rootEl: HTMLElement;
  content: string | null;
  errorMessage: string | null;
  renderContent?: RenderContentFn;
}): void {
  const { rootEl, content, errorMessage, renderContent } = params;

  if (content) {
    const previewEl = rootEl.createDiv({ cls: 'claudian-plan-content-preview' });
    if (renderContent) {
      void renderContent(previewEl, content);
    } else {
      previewEl.createDiv({ cls: 'claudian-plan-content-text', text: content });
    }
    return;
  }

  if (errorMessage) {
    rootEl.createDiv({
      cls: 'claudian-plan-content-preview claudian-plan-read-error',
      text: errorMessage,
    });
  }
}
