import { setIcon } from 'obsidian';

export type PillKind = 'current' | 'file' | 'folder';

export interface FileChipsViewCallbacks {
  onRemove: (path: string, kind: PillKind) => void;
  onOpenFile: (path: string) => void;
}

export interface PillData {
  currentNote: string | null;
  files: string[];
  folders: string[];
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export class FileChipsView {
  private containerEl: HTMLElement;
  private callbacks: FileChipsViewCallbacks;
  private fileIndicatorEl: HTMLElement;

  constructor(containerEl: HTMLElement, callbacks: FileChipsViewCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;

    const firstChild = this.containerEl.firstChild;
    this.fileIndicatorEl = this.containerEl.createDiv({ cls: 'claudian-file-indicator' });
    if (firstChild) {
      this.containerEl.insertBefore(this.fileIndicatorEl, firstChild);
    }
  }

  destroy(): void {
    this.fileIndicatorEl.remove();
  }

  renderPills(data: PillData): void {
    this.fileIndicatorEl.empty();

    const current = data.currentNote;
    // Dedupe: a file equal to the current note renders once, as the current pill.
    const files = data.files.filter((p) => p !== current);

    const total = (current ? 1 : 0) + files.length + data.folders.length;
    if (total === 0) {
      this.fileIndicatorEl.removeClass('claudian-visible-flex');
      this.fileIndicatorEl.addClass('claudian-hidden');
      return;
    }

    this.fileIndicatorEl.addClass('claudian-visible-flex');
    this.fileIndicatorEl.removeClass('claudian-hidden');

    if (current) {
      this.renderPill(current, 'current', 'file-text', basename(current), true);
    }
    for (const path of files) {
      this.renderPill(path, 'file', 'file-text', basename(path), true);
    }
    for (const path of data.folders) {
      this.renderPill(path, 'folder', 'folder', `${basename(path)}/`, false);
    }
  }

  private renderPill(
    path: string,
    kind: PillKind,
    iconName: string,
    label: string,
    openable: boolean,
  ): void {
    const chipEl = this.fileIndicatorEl.createDiv({
      cls: `claudian-file-chip claudian-file-chip--${kind}`,
    });

    const iconEl = chipEl.createSpan({ cls: 'claudian-file-chip-icon' });
    setIcon(iconEl, iconName);

    const nameEl = chipEl.createSpan({ cls: 'claudian-file-chip-name' });
    nameEl.setText(label);
    nameEl.setAttribute('title', path);

    const removeEl = chipEl.createSpan({ cls: 'claudian-file-chip-remove' });
    removeEl.setText('×');
    removeEl.setAttribute('aria-label', 'Remove');

    if (openable) {
      chipEl.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.claudian-file-chip-remove')) {
          this.callbacks.onOpenFile(path);
        }
      });
    }

    removeEl.addEventListener('click', () => {
      this.callbacks.onRemove(path, kind);
    });
  }
}
