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
  readonly labelEl: HTMLElement;
  readonly badgeEl: HTMLElement;
  private readonly unsubscribe: () => void;
  private lastStatus: GitStatus | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: GitActionCallbacks) {
    this.containerEl = parentEl.createDiv({ cls: 'claudian-git-action' });
    this.buttonEl = this.containerEl.createEl('button', {
      cls: 'claudian-git-action-btn',
      attr: {
        type: 'button',
        'aria-label': 'Commit and push changes',
      },
    });

    const iconEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-icon' });
    setIcon(iconEl, 'git-commit-horizontal');
    this.labelEl = this.buttonEl.createSpan({
      cls: 'claudian-git-action-label',
      text: 'Commit & push',
    });
    this.badgeEl = this.buttonEl.createSpan({ cls: 'claudian-git-action-badge' });

    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
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
      const changes = `${count} change${count === 1 ? '' : 's'}`;
      const label = `Commit and push ${changes}`;
      const title = `Ask the active agent to commit and push ${changes}.`;
      this.buttonEl.setAttribute('aria-label', label);
      this.buttonEl.setAttribute('title', title);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
