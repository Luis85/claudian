import { setIcon } from 'obsidian';

export interface ContextCardData {
  files: string[];
  folders: string[];
}

export interface MessageContextCardCallbacks {
  onOpenFile?: (path: string) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

/** Renders a display-only "Attached context" card. Returns null when empty. */
export function renderMessageContextCard(
  containerEl: HTMLElement,
  data: ContextCardData,
  callbacks: MessageContextCardCallbacks = {},
): HTMLElement | null {
  const total = data.files.length + data.folders.length;
  if (total === 0) return null;

  const cardEl = containerEl.createDiv({ cls: 'claudian-context-card' });

  const headerEl = cardEl.createDiv({ cls: 'claudian-context-card-header' });
  setIcon(headerEl.createSpan({ cls: 'claudian-context-card-header-icon' }), 'paperclip');
  headerEl
    .createSpan({ cls: 'claudian-context-card-header-label' })
    .setText(`Attached context (${total})`);

  const listEl = cardEl.createDiv({ cls: 'claudian-context-card-list' });

  for (const path of data.files) {
    const rowEl = listEl.createDiv({
      cls: 'claudian-context-card-row claudian-context-card-row--file',
    });
    setIcon(rowEl.createSpan({ cls: 'claudian-context-card-row-icon' }), 'file-text');
    const nameEl = rowEl.createSpan({ cls: 'claudian-context-card-row-name' });
    nameEl.setText(basename(path));
    nameEl.setAttribute('title', path);
    if (callbacks.onOpenFile) {
      rowEl.addClass('claudian-context-card-row--clickable');
      rowEl.addEventListener('click', () => callbacks.onOpenFile?.(path));
    }
  }

  // Folder rows are display-only: no onOpenFile (no Obsidian API to open a folder).
  for (const path of data.folders) {
    const rowEl = listEl.createDiv({
      cls: 'claudian-context-card-row claudian-context-card-row--folder',
    });
    setIcon(rowEl.createSpan({ cls: 'claudian-context-card-row-icon' }), 'folder');
    const nameEl = rowEl.createSpan({ cls: 'claudian-context-card-row-name' });
    nameEl.setText(`${basename(path)}/`);
    nameEl.setAttribute('title', path);
  }

  return cardEl;
}
