export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.specorator-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.specorator-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.specorator-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.specorator-file-indicator');
  const imagePreview = contextRowEl.querySelector('.specorator-image-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('specorator-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('specorator-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('specorator-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('specorator-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('specorator-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection || hasBrowserSelection || hasCanvasSelection || hasFileChips || hasImageChips
  );
}
