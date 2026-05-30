import type { ProviderId } from '../../../core/providers/types';
import type { SettingsCtx } from '../registry/SettingsField';

const PROVIDERS: Array<{ id: ProviderId; name: string; blurb: string; cli: string }> = [
  { id: 'claude', name: 'Claude', blurb: 'Anthropic Claude Code', cli: 'claude' },
  { id: 'codex', name: 'Codex', blurb: 'OpenAI Codex CLI', cli: 'codex' },
  { id: 'opencode', name: 'Opencode', blurb: 'Opencode CLI server', cli: 'opencode' },
  { id: 'cursor', name: 'Cursor', blurb: 'Cursor Agent CLI', cli: 'cursor-agent' },
];

export class FirstRunBanner {
  private rows: Array<{ id: ProviderId; cb: HTMLInputElement }> = [];

  constructor(private readonly host: HTMLElement, private readonly ctx: SettingsCtx) {}

  render(): void {
    this.host.empty();
    this.rows = [];
    const card = this.host.createDiv({ cls: 'claudian-first-run-banner' });
    card.createEl('h3', { text: 'Welcome to Claudian — pick your providers' });
    card.createEl('p', {
      text: 'Claudian wraps coding agents inside Obsidian. Enable one or more to start.',
    });
    for (const p of PROVIDERS) {
      const row = card.createDiv({ cls: 'claudian-first-run-row' });
      row.dataset.provider = p.id;
      const cb = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
      this.rows.push({ id: p.id, cb });
      const text = row.createDiv();
      text.createEl('strong', { text: p.name });
      text.createEl('span', { text: ` — ${p.blurb} (requires \`${p.cli}\` on PATH)` });
    }
    const actions = card.createDiv({ cls: 'claudian-first-run-actions' });
    const enableBtn = actions.createEl('button', { text: 'Enable selected' });
    enableBtn.dataset.action = 'enable';
    enableBtn.onclick = () => { void this.handleEnable(); };
    const dismissBtn = actions.createEl('button', { text: 'Dismiss' });
    dismissBtn.dataset.action = 'dismiss';
    dismissBtn.onclick = () => { void this.handleDismiss(); };
  }

  private async handleEnable(): Promise<void> {
    const checked = this.rows.filter((r) => r.cb.checked).map((r) => r.id);
    const next = JSON.parse(JSON.stringify(this.ctx.settings));
    next.providerConfigs = next.providerConfigs ?? {};
    for (const id of checked) {
      next.providerConfigs[id] = { ...(next.providerConfigs[id] ?? {}), enabled: true };
    }
    next.firstRunDismissed = true;
    this.ctx.settings = next;
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }

  private async handleDismiss(): Promise<void> {
    this.ctx.settings = { ...this.ctx.settings, firstRunDismissed: true };
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }
}
