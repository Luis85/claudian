import { Notice } from 'obsidian';

import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  setEnvironmentVariablesForScope,
} from '@/core/providers/providerEnvironment';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { migrateEnvSecrets } from '@/core/providers/secretEnvVars';
import type { ProviderId } from '@/core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { asSettingsBag } from '@/core/types';
import type { EnvironmentScope, SecretEnvVarRef } from '@/core/types/settings';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

export class EnvironmentApplyService {
  constructor(private readonly plugin: ClaudianPlugin) {}

  apply(scope: EnvironmentScope, envText: string): Promise<void> {
    return this.applyBatch([{ scope, envText }]);
  }

  async applyBatch(updates: Array<{ scope: EnvironmentScope; envText: string }>): Promise<void> {
    const settingsBag = asSettingsBag(this.plugin.settings);
    const nextEnvByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) nextEnvByScope.set(update.scope, update.envText);

    const changedScopes: EnvironmentScope[] = [];
    for (const [scope, envText] of nextEnvByScope) {
      const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
      if (currentValue !== envText) changedScopes.push(scope);
      setEnvironmentVariablesForScope(settingsBag, scope, envText);
    }

    if (changedScopes.length === 0) {
      await this.plugin.saveSettings();
      return;
    }

    // SEC-A: migrate any newly-typed secret keys out of the edited plaintext
    // blob into SecretStorage (reusing an existing ref's id when a migrated key
    // is re-entered), so an edited secret never lingers in plaintext or resolves
    // to a stale value, and reconciliation below sees the resolved env.
    migrateEnvSecrets(
      settingsBag,
      ProviderRegistry.getRegisteredProviderIds(),
      this.plugin.secretStore,
    );

    await this.finalizeEnvironmentChange(this.affectedProviders(changedScopes));
  }

  /**
   * SEC-A: persist updated secret-var refs and run the SAME reconcile + tab/runtime
   * sync as a plaintext env edit, so changing a key here immediately reaches an
   * already-open provider tab (no stale subprocess env until an unrelated edit).
   */
  async applySecretEnvVars(refs: SecretEnvVarRef[], scope: EnvironmentScope): Promise<void> {
    this.plugin.settings.secretEnvVars = refs;
    await this.finalizeEnvironmentChange(this.affectedProviders([scope]));
  }

  /** Reconcile + sync open tabs/runtimes for the affected providers after an env change. */
  private async finalizeEnvironmentChange(affected: ProviderId[]): Promise<void> {
    const settingsBag = asSettingsBag(this.plugin.settings);
    ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affected);
    const { changed, invalidatedConversations } = this.reconcileWithEnvironment(affected);
    await this.plugin.saveSettings();

    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.plugin.storage.sessions.saveMetadata(
          this.plugin.storage.sessions.toSessionMetadata(conv),
        );
      }
    }

    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      const affectedTabs = tabManager.getAllTabs().filter((tab) =>
        affected.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID),
      );
      const syncRuntime = (tab: (typeof affectedTabs)[number]): void => {
        if (!tab.service || !tab.serviceInitialized) return;
        const conversation = tab.conversationId
          ? this.plugin.getConversationSync(tab.conversationId)
          : null;
        const hasContext = (conversation?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasContext
            ? conversation?.externalContextPaths ?? []
            : this.plugin.settings.persistentExternalContextPaths ?? []);
        tab.service.syncConversationState(conversation, externalContextPaths);
      };

      for (const tab of affectedTabs) {
        if (tab.state.isStreaming) tab.controllers.inputController?.cancelStreaming();
      }

      let failedTabs = 0;
      for (const tab of affectedTabs) {
        if (!tab.service || !tab.serviceInitialized) continue;
        try {
          syncRuntime(tab);
          if (changed) {
            tab.service.resetSession();
            await tab.service.ensureReady();
          } else {
            await tab.service.ensureReady({ force: true });
          }
        } catch {
          failedTabs++;
        }
      }
      if (failedTabs > 0) {
        new Notice(t('env.applyPartial', { count: failedTabs }));
      }
    }

    for (const openView of this.plugin.getAllViews()) {
      openView.invalidateProviderCommandCaches(affected);
      openView.refreshModelSelector();
    }

    new Notice(t(changed ? 'env.appliedRebuild' : 'env.applied'));
  }

  reconcileWithEnvironment(
    providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds(),
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.plugin.settings,
      this.plugin.conversationStore.getConversations(),
      providerIds,
      // SEC-A: hash the resolved env (secrets overlaid); defer invalidation when
      // a referenced secret is missing on this device.
      (providerId) => this.plugin.getEnvironmentHashInput(providerId),
    );
  }

  affectedProvidersForTests(scopes: EnvironmentScope[]): ProviderId[] {
    return this.affectedProviders(scopes);
  }

  private affectedProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registered = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affected = new Set<ProviderId>();
    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const id of registered) affected.add(id);
        continue;
      }
      const id = scope.slice('provider:'.length) as ProviderId;
      if (registered.has(id)) affected.add(id);
    }
    return Array.from(affected);
  }
}
