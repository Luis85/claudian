import type { App } from 'obsidian';

import { SELECTION_POLL_INTERVAL_MS } from '../../../core/constants';
import { updateContextRowHasContent } from './contextRowVisibility';

/**
 * Shared skeleton for the selection-context controllers (editor, browser,
 * canvas): indicator/context-row wiring plus the poll-interval lifecycle.
 * Subclasses own what a "selection" is and how the indicator renders.
 */
export abstract class SelectionPollingController {
  protected app: App;
  protected indicatorEl: HTMLElement;
  protected inputEl: HTMLElement;
  protected contextRowEl: HTMLElement;
  protected onVisibilityChange: (() => void) | null;
  protected pollInterval: number | null = null;

  constructor(
    app: App,
    indicatorEl: HTMLElement,
    inputEl: HTMLElement,
    contextRowEl: HTMLElement,
    onVisibilityChange?: () => void,
  ) {
    this.app = app;
    this.indicatorEl = indicatorEl;
    this.inputEl = inputEl;
    this.contextRowEl = contextRowEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
  }

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = window.setInterval(() => {
      void this.poll();
    }, SELECTION_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.stopPolling();
    this.clear();
  }

  protected stopPolling(): void {
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  updateContextRowVisibility(): void {
    if (!this.contextRowEl) return;
    updateContextRowHasContent(this.contextRowEl);
    this.onVisibilityChange?.();
  }

  protected abstract poll(): void | Promise<void>;

  abstract clear(): void;
}
