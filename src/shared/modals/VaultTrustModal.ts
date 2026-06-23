import { type App, Modal, Setting } from 'obsidian';

import { t } from '../../i18n/i18n';

/**
 * SECURITY (SEC-2): one-time prompt shown when an untrusted vault ships risky
 * project `.claude/settings.json` (hooks / permissions.allow). Until the user
 * trusts the vault those settings are withheld; this modal lets them opt in. The
 * default action is the safe one (keep blocked) — closing without choosing leaves
 * the vault untrusted.
 */
export function promptVaultTrust(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    new VaultTrustModal(app, resolve).open();
  });
}

class VaultTrustModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly resolve: (trusted: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('security.vaultTrust.title'));
    this.modalEl.addClass('specorator-confirm-modal');

    this.contentEl.createEl('p', { text: t('security.vaultTrust.body') });
    this.contentEl.createEl('p', { text: t('security.vaultTrust.detail') });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(t('security.vaultTrust.keepBlocked'))
          .setCta()
          .onClick(() => this.finish(false)),
      )
      .addButton((btn) =>
        btn
          .setButtonText(t('security.vaultTrust.trust'))
          .setWarning()
          .onClick(() => this.finish(true)),
      );
  }

  private finish(trusted: boolean): void {
    this.resolved = true;
    this.resolve(trusted);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      // Closing without an explicit choice keeps the vault untrusted (secure default).
      this.resolve(false);
    }
    this.contentEl.empty();
  }
}
