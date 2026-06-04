import { SecretComponent, Setting } from 'obsidian';

import type { PluginContext } from '../../../core/types/PluginContext';
import type { EnvironmentScope, SecretEnvVarRef } from '../../../core/types/settings';

interface SecretEnvVarsSectionOptions {
  container: HTMLElement;
  plugin: PluginContext;
  scope: EnvironmentScope;
}

/**
 * SEC-A: per-scope editor for secret environment variables. Each row binds an env
 * var name to an Obsidian `SecretComponent` — the value lives in the OS keychain
 * (Obsidian SecretStorage), never in plaintext settings; only the secret id/name
 * is persisted in `settings.secretEnvVars`. A "not set on this device" hint shows
 * when a synced ref has no local value yet (re-entry prompt).
 */
export function renderSecretEnvVarsSection(options: SecretEnvVarsSectionOptions): void {
  const { container, plugin, scope } = options;
  const host = container.createDiv({ cls: 'claudian-secret-env-vars' });
  render();

  function render(): void {
    host.empty();
    new Setting(host)
      .setName('Secret variables')
      .setDesc('API keys and tokens kept in your system keychain, not in plaintext settings.')
      .setHeading();

    for (const ref of secretRefsForScope()) {
      const setting = new Setting(host).setName(ref.name);
      if (!isSecretSet(plugin, ref.secretId)) {
        setting.setDesc('Not set on this device — select or create the secret to use it.');
      }
      setting.addComponent((el) =>
        new SecretComponent(plugin.app, el)
          .setValue(ref.secretId)
          .onChange((secretId) => { void updateRefSecret(ref, secretId); }),
      );
      setting.addExtraButton((btn) =>
        btn.setIcon('trash').setTooltip('Remove').onClick(() => { void removeRef(ref); }),
      );
    }

    renderAddRow();
  }

  function renderAddRow(): void {
    const draft = { name: '', secretId: '' };
    new Setting(host)
      .setName('Add secret variable')
      .addText((text) =>
        text.setPlaceholder('VARIABLE_NAME').onChange((value) => { draft.name = value.trim(); }),
      )
      .addComponent((el) =>
        new SecretComponent(plugin.app, el).onChange((secretId) => { draft.secretId = secretId; }),
      )
      .addButton((btn) =>
        btn.setButtonText('Add').onClick(() => {
          if (!draft.name || !draft.secretId) return;
          void persist([
            ...currentRefs(),
            { scope, name: draft.name, secretId: draft.secretId },
          ]);
        }),
      );
  }

  function currentRefs(): SecretEnvVarRef[] {
    return plugin.settings.secretEnvVars ?? [];
  }

  function secretRefsForScope(): SecretEnvVarRef[] {
    return currentRefs().filter((ref) => ref.scope === scope);
  }

  async function updateRefSecret(target: SecretEnvVarRef, secretId: string): Promise<void> {
    await persist(currentRefs().map((ref) => (ref === target ? { ...ref, secretId } : ref)));
  }

  async function removeRef(target: SecretEnvVarRef): Promise<void> {
    await persist(currentRefs().filter((ref) => ref !== target));
  }

  async function persist(next: SecretEnvVarRef[]): Promise<void> {
    // Route through the env apply flow so an open provider tab reconciles its
    // runtime (rather than just saving + re-rendering).
    await plugin.applySecretEnvVars(next, scope);
    render();
  }
}

/** A ref is "set" only when SecretStorage holds a non-empty value on this device. */
function isSecretSet(plugin: PluginContext, secretId: string): boolean {
  const value = plugin.app.secretStorage?.getSecret(secretId);
  return value !== null && value !== undefined && value !== '';
}
