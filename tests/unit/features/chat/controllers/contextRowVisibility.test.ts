import { createMockEl } from '@test/helpers/mockElement';

import { updateContextRowHasContent } from '@/features/chat/controllers/contextRowVisibility';

function createContextRow(browserIndicator: HTMLElement | null): HTMLElement {
  const editorIndicator = createMockEl();
  editorIndicator.addClass('specorator-selection-indicator specorator-hidden');
  const canvasIndicator = createMockEl();
  canvasIndicator.addClass('specorator-canvas-indicator specorator-hidden');
  const fileIndicator = createMockEl();
  fileIndicator.addClass('specorator-file-indicator specorator-hidden');
  const imagePreview = createMockEl();
  imagePreview.addClass('specorator-image-preview specorator-hidden');
  const lookup = new Map<string, unknown>([
    ['.specorator-selection-indicator', editorIndicator],
    ['.specorator-browser-selection-indicator', browserIndicator],
    ['.specorator-canvas-indicator', canvasIndicator],
    ['.specorator-file-indicator', fileIndicator],
    ['.specorator-image-preview', imagePreview],
  ]);

  const contextRow = createMockEl();
  const toggle = contextRow.classList.toggle;
  contextRow.classList.toggle = jest.fn((cls: string, force?: boolean) => toggle(cls, force));
  contextRow.querySelector = jest.fn((selector: string) => lookup.get(selector) ?? null);
  return contextRow as unknown as HTMLElement;
}

describe('updateContextRowHasContent', () => {
  it('does not treat missing browser indicator as visible content', () => {
    const contextRowEl = createContextRow(null);

    expect(() => updateContextRowHasContent(contextRowEl)).not.toThrow();
    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', false);
  });

  it('treats browser indicator as visible only when it is not hidden', () => {
    const browserIndicator = createMockEl();
    browserIndicator.addClass('specorator-browser-selection-indicator');
    const contextRowEl = createContextRow(browserIndicator);

    updateContextRowHasContent(contextRowEl);

    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', true);
  });
});
