import { SecretComponent, Setting } from 'obsidian';

import { isSpecoratorGeneratedSecretId } from '../../core/security/secretIds';
import type { PluginContext } from '../../core/types/PluginContext';
import type { EnvironmentScope, SecretEnvVarRef } from '../../core/types/settings';
import { t } from '../../i18n/i18n';

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
  const host = container.createDiv({ cls: 'specorator-secret-env-vars' });
  render();

  function render(): void {
    host.empty();
    new Setting(host)
      .setName(t('env.secretVarsHeading'))
      .setDesc(t('env.secretVarsDesc'))
      .setHeading();

    for (const ref of secretRefsForScope()) {
      const setting = new Setting(host).setName(ref.name);
      if (!isSecretSet(plugin, ref.secretId)) {
        setting.setDesc(t('env.secretNotSet'));
      }
      setting.addComponent((el) =>
        new SecretComponent(plugin.app, el)
          .setValue(ref.secretId)
          .onChange((secretId) => { void updateRefSecret(ref, secretId); }),
      );
      setting.addExtraButton((btn) =>
        btn.setIcon('trash').setTooltip(t('env.secretRemove')).onClick(() => { void removeRef(ref); }),
      );
    }

    renderAddRow();
  }

  function renderAddRow(): void {
    const draft = { name: '', secretId: '' };
    new Setting(host)
      .setName(t('env.secretAdd'))
      .addText((text) =>
        text.setPlaceholder(t('env.secretNamePlaceholder')).onChange((value) => { draft.name = value.trim(); }),
      )
      .addComponent((el) =>
        new SecretComponent(plugin.app, el).onChange((secretId) => { draft.secretId = secretId; }),
      )
      .addButton((btn) =>
        btn.setButtonText(t('env.secretAddButton')).onClick(() => {
          if (!draft.name || !draft.secretId) return;
          // Enforce one ref per (scope, name): replace an existing same-name row
          // instead of appending a duplicate. Overlay order makes the last ref win at
          // runtime, so a leftover older ref would silently re-activate (a credential
          // the user thought removed) once the newer row is deleted/retargeted.
          const replaced = secretRefsForScope().find((ref) => ref.name === draft.name);
          const next = currentRefs().filter((ref) => !(ref.scope === scope && ref.name === draft.name));
          next.push({ scope, name: draft.name, secretId: draft.secretId });
          void (async () => {
            await persist(next);
            if (replaced) clearIfOrphaned(replaced.secretId, next);
          })();
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
    const previousId = target.secretId;
    const next = currentRefs().map((ref) => (ref === target ? { ...ref, secretId } : ref));
    await persist(next);
    clearIfOrphaned(previousId, next);
  }

  async function removeRef(target: SecretEnvVarRef): Promise<void> {
    const next = currentRefs().filter((ref) => ref !== target);
    await persist(next);
    clearIfOrphaned(target.secretId, next);
  }

  /**
   * SEC-A: clear a secret value once no ref points at it, so a deleted/retargeted
   * key doesn't linger (matches snippet/MCP deletion). Limited to Specorator-owned
   * ids — SecretStorage ids are global, so an external/user-selected id another
   * plugin owns is never auto-erased.
   */
  function clearIfOrphaned(secretId: string, refs: SecretEnvVarRef[]): void {
    if (!isSpecoratorGeneratedSecretId(secretId)) return;
    if (refs.some((ref) => ref.secretId === secretId)) return;
    plugin.secretStore.clear(secretId);
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
