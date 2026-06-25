import { type App,Modal } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import { t } from '@/i18n/i18n';

import type { QuickAction } from '../types';

export interface QuickActionLaunchModelOption {
  value: string;
  label: string;
}

export interface QuickActionLaunchProvider {
  id: ProviderId;
  displayName: string;
  models: QuickActionLaunchModelOption[];
}

export interface QuickActionLaunchModalOptions {
  app: App;
  action: QuickAction;
  presetProviderId: ProviderId;
  presetModel: string;
  enabledProviders: QuickActionLaunchProvider[];
  resolveDefaultModelForProvider: (providerId: ProviderId) => string;
  fallbackNotice?: {
    storedProviderLabel: string;
    storedModelLabel: string;
  };
  onConfirm: (choice: { providerId: ProviderId; model: string }) => void;
}

/**
 * Confirmation modal opened by `launchQuickAction` whenever a quick-action
 * fires from outside an active chat tab. Forces the user to confirm
 * provider+model before dispatch so the wrong model never receives the prompt.
 */
export class QuickActionLaunchModal extends Modal {
  private readonly options: QuickActionLaunchModalOptions;
  private providerSelect: HTMLSelectElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;

  constructor(options: QuickActionLaunchModalOptions) {
    super(options.app);
    this.options = options;
  }

  onOpen(): void {
    this.modalEl?.addClass?.('specorator-qa-launch-modal');
    const root = this.contentEl;
    root.empty();

    // Register Enter-to-Run before rendering so the binding survives any render error.
    this.scope?.register?.([], 'Enter', (event) => {
      if (this.options.enabledProviders.length === 0) return;
      event.preventDefault();
      const btn = this.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]');
      btn?.click();
    });

    const rawName = this.options.action.name?.trim();
    const name = rawName && rawName.length > 0
      ? rawName
      : t('quickActions.launchModal.untitledFallback');
    this.titleEl.setText(t('quickActions.launchModal.title', { name }));

    if (this.options.fallbackNotice) {
      const notice = root.createDiv({
        cls: 'specorator-qa-launch-notice',
        attr: { 'data-testid': 'qa-fallback-notice', role: 'alert' },
      });
      notice.setText(t('quickActions.launchModal.fallbackNotice', {
        provider: this.options.fallbackNotice.storedProviderLabel,
        model: this.options.fallbackNotice.storedModelLabel,
      }));
    }

    if (this.options.enabledProviders.length === 0) {
      const emptyId = 'specorator-qa-empty-' + Math.random().toString(36).slice(2, 9);
      const empty = root.createDiv({
        cls: 'specorator-qa-launch-empty',
        attr: { id: emptyId, 'data-testid': 'qa-empty', 'aria-live': 'polite' },
      });
      empty.setText(t('quickActions.launchModal.noProvidersEnabled'));
      this.renderActions(root, /* runDisabled */ true, emptyId);
      return;
    }

    this.renderProviderRow(root);
    this.renderModelRow(root);
    this.renderActions(root, /* runDisabled */ false);

    const runBtn = this.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]');
    runBtn?.focus();
  }

  onClose(): void {
    this.modalEl?.removeClass?.('specorator-qa-launch-modal');
    this.contentEl.empty();
    this.providerSelect = null;
    this.modelSelect = null;
  }

  private renderProviderRow(root: HTMLElement): void {
    const selectId = 'specorator-qa-provider-' + Math.random().toString(36).slice(2, 9);
    const row = root.createDiv({ cls: 'specorator-qa-launch-row' });
    row.createEl('label', {
      text: t('quickActions.launchModal.providerLabel'),
      attr: { for: selectId },
    });
    const select = row.createEl('select', {
      attr: { id: selectId, 'data-testid': 'qa-provider' },
    });
    for (const provider of this.options.enabledProviders) {
      const opt = select.createEl('option', { text: provider.displayName });
      opt.value = provider.id;
      if (provider.id === this.options.presetProviderId) opt.selected = true;
    }
    select.addEventListener('change', () => {
      const next = select.value as ProviderId;
      const defaultModel = this.options.resolveDefaultModelForProvider(next);
      this.renderModelOptions(next, defaultModel);
      this.modelSelect?.focus();
    });
    this.providerSelect = select;
  }

  private renderModelRow(root: HTMLElement): void {
    const selectId = 'specorator-qa-model-' + Math.random().toString(36).slice(2, 9);
    const row = root.createDiv({ cls: 'specorator-qa-launch-row' });
    row.createEl('label', {
      text: t('quickActions.launchModal.modelLabel'),
      attr: { for: selectId },
    });
    const select = row.createEl('select', {
      attr: { id: selectId, 'data-testid': 'qa-model' },
    });
    this.modelSelect = select;
    this.renderModelOptions(this.options.presetProviderId, this.options.presetModel);
  }

  private renderModelOptions(providerId: ProviderId, selectedValue: string): void {
    if (!this.modelSelect) return;
    this.modelSelect.empty();
    const provider = this.options.enabledProviders.find((p) => p.id === providerId);
    const models = provider?.models ?? [];
    for (const model of models) {
      const opt = this.modelSelect.createEl('option', { text: model.label });
      opt.value = model.value;
      if (model.value === selectedValue) opt.selected = true;
    }
    if (this.modelSelect.value !== selectedValue && models.length > 0) {
      this.modelSelect.value = models[0].value;
    }
  }

  private renderActions(root: HTMLElement, runDisabled: boolean, describedById?: string): void {
    const actions = root.createDiv({ cls: 'specorator-qa-launch-actions' });

    // DOM order: Cancel first, Run second. Visual order is reversed via
    // `flex-direction: row-reverse` in CSS so Run appears on the right while
    // Tab order naturally ends on Run as the primary action.
    const cancel = actions.createEl('button', {
      text: t('quickActions.launchModal.cancelButton'),
      attr: { 'data-testid': 'qa-cancel' },
    });
    cancel.addEventListener('click', () => this.close());

    const run = actions.createEl('button', {
      text: t('quickActions.launchModal.runButton'),
      attr: { 'data-testid': 'qa-run' },
    });
    run.addClass('mod-cta');
    run.disabled = runDisabled;
    if (runDisabled && describedById) {
      run.setAttribute('aria-describedby', describedById);
    }
    run.addEventListener('click', () => {
      if (!this.providerSelect || !this.modelSelect) return;
      const choice = {
        providerId: this.providerSelect.value as ProviderId,
        model: this.modelSelect.value,
      };
      this.options.onConfirm(choice);
      this.close();
    });
  }
}
