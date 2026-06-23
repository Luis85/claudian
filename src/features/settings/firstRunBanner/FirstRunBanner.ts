import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { SettingsCtx } from '../registry/SettingsField';

export class FirstRunBanner {
  private rows: Array<{ id: ProviderId; cb: HTMLInputElement }> = [];

  constructor(private readonly host: HTMLElement, private readonly ctx: SettingsCtx) {}

  render(): void {
    this.host.empty();
    this.rows = [];
    const card = this.host.createDiv({ cls: 'specorator-first-run-banner' });
    card.createEl('h3', { text: 'Welcome to Specorator — pick your providers' });
    card.createEl('p', {
      text: 'Specorator wraps coding agents inside Obsidian. Enable one or more to start.',
    });
    for (const id of ProviderRegistry.getRegisteredProviderIds()) {
      const name = ProviderRegistry.getProviderDisplayName(id);
      const row = card.createDiv({ cls: 'specorator-first-run-row' });
      row.dataset.provider = id;
      const cb = row.createEl('input', {
        attr: { type: 'checkbox', 'aria-label': `Enable ${name}` },
      }) as HTMLInputElement;
      this.rows.push({ id, cb });
      const text = row.createDiv();
      text.createEl('strong', { text: name });
      text.createEl('span', { text: ` — ${ProviderRegistry.getFirstRunBlurb(id)}. Requires ` });
      text.createEl('code', { text: ProviderRegistry.getCliCommand(id) });
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- trailing fragment of "requires `cli` on path."
      text.createEl('span', { text: ' on path.' });
    }
    const actions = card.createDiv({ cls: 'specorator-first-run-actions' });
    const enableBtn = actions.createEl('button', { text: 'Enable selected' });
    enableBtn.dataset.action = 'enable';
    enableBtn.onclick = () => { void this.handleEnable(); };
    const dismissBtn = actions.createEl('button', { text: 'Dismiss' });
    dismissBtn.dataset.action = 'dismiss';
    dismissBtn.onclick = () => { void this.handleDismiss(); };
  }

  private async handleEnable(): Promise<void> {
    const checked = this.rows.filter((r) => r.cb.checked).map((r) => r.id);
    const live = this.ctx.settings as unknown as {
      providerConfigs?: Record<string, { enabled?: boolean }>;
      firstRunDismissed?: boolean;
    };
    live.providerConfigs = live.providerConfigs ?? {};
    for (const id of checked) {
      live.providerConfigs[id] = { ...(live.providerConfigs[id] ?? {}), enabled: true };
    }
    live.firstRunDismissed = true;
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }

  private async handleDismiss(): Promise<void> {
    (this.ctx.settings as { firstRunDismissed?: boolean }).firstRunDismissed = true;
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }
}
