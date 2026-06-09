import { setIcon } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import { runToolbarAction, type ToolbarCallbacks } from './shared';

export class PlanModeToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-plan-mode-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render(): void {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'claudian-plan-mode-button' });
    this.buttonEl.setAttr('aria-label', t('chat.planMode.ariaLabel'));
    this.buttonEl.setAttr('title', t('chat.planMode.titleInactive'));

    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-plan-mode-icon' });
    setIcon(this.iconEl, 'map');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(async () => {
        if (this.callbacks.onPlanModeToggle) {
          await this.callbacks.onPlanModeToggle();
        }
        this.updateDisplay();
      }, t('chat.planMode.toggleFailed'));
    });
  }

  private getPlanValue(): string | null {
    const toggleConfig = this.callbacks.getUIConfig().getPermissionModeToggle?.();
    const planValue = toggleConfig?.planValue;
    return typeof planValue === 'string' && planValue ? planValue : null;
  }

  updateDisplay(): void {
    if (!this.buttonEl || !this.iconEl) {
      return;
    }

    const capabilities = this.callbacks.getCapabilities();
    const planValue = this.getPlanValue();
    const canShow = this.visible
      && Boolean(this.callbacks.onPlanModeToggle)
      && capabilities.supportsPlanMode
      && Boolean(planValue);

    if (!canShow) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const isActive = this.callbacks.getSettings().permissionMode === planValue;
    this.buttonEl.toggleClass('active', isActive);
    this.buttonEl.setAttr(
      'aria-pressed',
      isActive ? 'true' : 'false',
    );
    this.buttonEl.setAttr(
      'title',
      isActive ? t('chat.planMode.titleActive') : t('chat.planMode.titleInactive'),
    );
  }
}
