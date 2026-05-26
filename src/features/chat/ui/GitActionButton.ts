import { setIcon } from 'obsidian';

import type { GitStatus } from '../services/GitService';

export interface GitActionCallbacks {
  subscribeGitStatus: (cb: (status: GitStatus) => void) => () => void;
  isGitActionsEnabled: () => boolean;
  onGitCommit: () => void;
}

export function shouldShowGitButton(status: GitStatus | null, enabled: boolean): boolean {
  return Boolean(status && status.isRepo && status.dirtyCount > 0 && enabled);
}

export class GitActionButton {
  readonly containerEl: HTMLElement;
  readonly buttonEl: HTMLElement;
  readonly badgeEl: HTMLElement;
  private readonly unsubscribe: () => void;
  private lastStatus: GitStatus | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: GitActionCallbacks) {
    this.containerEl = parentEl.createDiv({ cls: 'claudian-git-action' });
    this.buttonEl = this.containerEl.createDiv({ cls: 'claudian-git-action-btn' });

    const iconEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-icon' });
    setIcon(iconEl, 'git-commit-horizontal');
    this.badgeEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-badge' });

    this.buttonEl.addEventListener('click', (e) => {
      e?.stopPropagation();
      this.callbacks.onGitCommit();
    });

    this.unsubscribe = this.callbacks.subscribeGitStatus((status) => {
      this.lastStatus = status;
      this.updateDisplay();
    });

    this.updateDisplay();
  }

  updateDisplay(): void {
    const visible = shouldShowGitButton(this.lastStatus, this.callbacks.isGitActionsEnabled());
    this.containerEl.toggleClass('claudian-hidden', !visible);
    if (visible && this.lastStatus) {
      this.badgeEl.setText(String(this.lastStatus.dirtyCount));
      const count = this.lastStatus.dirtyCount;
      this.containerEl.setAttribute(
        'title',
        `Commit & push ${count} change${count === 1 ? '' : 's'}`,
      );
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
