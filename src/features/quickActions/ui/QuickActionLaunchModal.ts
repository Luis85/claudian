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
    storedProviderId: ProviderId;
    storedModel: string;
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
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-qa-launch-modal');

    root.createEl('h3', {
      text: t('quickActions.launchModal.title', { name: this.options.action.name }),
    });

    if (this.options.fallbackNotice) {
      const notice = root.createDiv({
        cls: 'claudian-qa-launch-notice',
        attr: { 'data-testid': 'qa-fallback-notice' },
      });
      notice.setText(t('quickActions.launchModal.fallbackNotice', {
        provider: this.options.fallbackNotice.storedProviderId,
        model: this.options.fallbackNotice.storedModel,
      }));
    }

    if (this.options.enabledProviders.length === 0) {
      const empty = root.createDiv({
        cls: 'claudian-qa-launch-empty',
        attr: { 'data-testid': 'qa-empty' },
      });
      empty.setText(t('quickActions.launchModal.noProvidersEnabled'));
      this.renderActions(root, /* runDisabled */ true);
      return;
    }

    this.renderProviderRow(root);
    this.renderModelRow(root);
    this.renderActions(root, /* runDisabled */ false);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderProviderRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'claudian-qa-launch-row' });
    row.createEl('label', { text: t('quickActions.launchModal.providerLabel') });
    const select = row.createEl('select', { attr: { 'data-testid': 'qa-provider' } });
    for (const provider of this.options.enabledProviders) {
      const opt = select.createEl('option', { text: provider.displayName });
      opt.value = provider.id;
      if (provider.id === this.options.presetProviderId) opt.selected = true;
    }
    select.addEventListener('change', () => {
      const next = select.value as ProviderId;
      const defaultModel = this.options.resolveDefaultModelForProvider(next);
      this.renderModelOptions(next, defaultModel);
    });
    this.providerSelect = select;
  }

  private renderModelRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'claudian-qa-launch-row' });
    row.createEl('label', { text: t('quickActions.launchModal.modelLabel') });
    const select = row.createEl('select', { attr: { 'data-testid': 'qa-model' } });
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

  private renderActions(root: HTMLElement, runDisabled: boolean): void {
    const actions = root.createDiv({ cls: 'claudian-qa-launch-actions' });

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
