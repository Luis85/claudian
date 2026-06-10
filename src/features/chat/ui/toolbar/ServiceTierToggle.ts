import { setIcon } from 'obsidian';

import type { ProviderServiceTierToggleConfig } from '../../../../core/providers/types';
import { runToolbarAction, type ToolbarCallbacks } from './shared';

export class ServiceTierToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-service-tier-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'claudian-service-tier-button' });
    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-service-tier-icon' });
    setIcon(this.iconEl, 'zap');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change service tier');
    });
  }

  private getToggleConfig(): ProviderServiceTierToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getServiceTierToggle?.(this.callbacks.getSettings()) ?? null;
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl) return;

    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const current = this.callbacks.getSettings().serviceTier;
    const isActive = current === toggleConfig.activeValue;
    if (isActive) {
      this.buttonEl.addClass('active');
    } else {
      this.buttonEl.removeClass('active');
    }

    this.container.setAttribute('title', 'Toggle on/off fast mode');
  }

  private async toggle() {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().serviceTier;
    const next = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onServiceTierChange(next);
    this.updateDisplay();
  }
}
