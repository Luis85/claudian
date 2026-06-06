/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import type { QuickAction } from '@/features/quickActions/types';
import {
  QuickActionLaunchModal,
  type QuickActionLaunchModalOptions,
} from '@/features/quickActions/ui/QuickActionLaunchModal';

jest.mock('obsidian', () => {
  class Modal {
    contentEl = document.createElement('div');
    modalEl = document.createElement('div');
    scope = { register: jest.fn() };
    constructor(public app: unknown) {}
    open(): void { this.onOpen(); }
    close(): void { this.onClose(); }
    onOpen(): void {}
    onClose(): void {}
  }
  return { Modal };
});

jest.mock('@/i18n/i18n', () => {
  const en = jest.requireActual('@/i18n/locales/en.json') as Record<string, unknown>;
  const lookup = (key: string): string => {
    const parts = key.split('.');
    let cur: unknown = en;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return key;
      }
    }
    return typeof cur === 'string' ? cur : key;
  };
  return {
    t: (key: string, vars?: Record<string, string>) => {
      const template = lookup(key);
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, v),
        template,
      );
    },
  };
});

const ACTION: QuickAction = {
  id: 'a',
  name: 'Summarize',
  description: 'd',
  prompt: 'p',
  filePath: 'qa/summarize.md',
};

function makeOptions(over: Partial<QuickActionLaunchModalOptions> = {}): QuickActionLaunchModalOptions {
  return {
    app: {} as never,
    action: ACTION,
    presetProviderId: 'claude',
    presetModel: 'claude-sonnet-4-5',
    enabledProviders: [
      { id: 'claude', displayName: 'Claude', models: [
        { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
        { value: 'claude-opus-4-5', label: 'Opus 4.5' },
      ] },
      { id: 'codex', displayName: 'Codex', models: [
        { value: 'gpt-5-codex', label: 'gpt-5-codex' },
      ] },
    ],
    resolveDefaultModelForProvider: (id) => (id === 'claude' ? 'claude-sonnet-4-5' : 'gpt-5-codex'),
    onConfirm: jest.fn(),
    ...over,
  };
}

describe('QuickActionLaunchModal', () => {
  it('renders provider + model selects pre-filled with preset', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]');
    const modelSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-model"]');
    expect(providerSelect?.value).toBe('claude');
    expect(modelSelect?.value).toBe('claude-sonnet-4-5');
  });

  it('lists only enabled providers', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
    const ids = Array.from(providerSelect.options).map((o) => o.value);
    expect(ids).toEqual(['claude', 'codex']);
  });

  it('switching provider resets model to that provider default', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
    const modelSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-model"]')!;
    providerSelect.value = 'codex';
    providerSelect.dispatchEvent(new Event('change'));
    expect(modelSelect.value).toBe('gpt-5-codex');
  });

  it('shows the fallback notice when present', () => {
    const opts = makeOptions({
      fallbackNotice: { storedProviderLabel: 'Codex', storedModelLabel: 'gpt-5-codex' },
    });
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const notice = modal.contentEl.querySelector('[data-testid="qa-fallback-notice"]');
    expect(notice?.textContent).toContain('Codex');
    expect(notice?.textContent).toContain('gpt-5-codex');
  });

  it('hides the fallback notice when absent', () => {
    const modal = new QuickActionLaunchModal(makeOptions());
    modal.open();
    expect(modal.contentEl.querySelector('[data-testid="qa-fallback-notice"]')).toBeNull();
  });

  it('Run fires onConfirm with selected pair, then closes', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const runBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
    runBtn.click();
    expect(opts.onConfirm).toHaveBeenCalledWith({ providerId: 'claude', model: 'claude-sonnet-4-5' });
  });

  it('Cancel does not fire onConfirm', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const cancelBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-cancel"]')!;
    cancelBtn.click();
    expect(opts.onConfirm).not.toHaveBeenCalled();
  });

  it('disables Run + shows configure notice when no providers enabled', () => {
    const opts = makeOptions({ enabledProviders: [] });
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const runBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
    expect(runBtn.disabled).toBe(true);
    const empty = modal.contentEl.querySelector('[data-testid="qa-empty"]');
    expect(empty?.textContent).toContain('No providers enabled');
  });
});
