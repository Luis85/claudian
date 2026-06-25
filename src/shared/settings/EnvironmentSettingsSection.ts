import { Setting } from 'obsidian';

import { getEnvironmentReviewKeysForScope } from '../../core/providers/providerEnvironment';
import type { PluginContext } from '../../core/types/PluginContext';
import type { EnvironmentScope } from '../../core/types/settings';
import { EnvSnippetManager } from './EnvSnippetManager';
import { renderSecretEnvVarsSection } from './SecretEnvVarsSection';

interface EnvironmentSettingsSectionOptions {
  container: HTMLElement;
  plugin: PluginContext;
  scope: EnvironmentScope;
  heading?: string;
  name: string;
  desc: string;
  placeholder: string;
  renderCustomContextLimits?: (container: HTMLElement) => void;
}

export function renderEnvironmentSettingsSection(
  options: EnvironmentSettingsSectionOptions,
): void {
  const {
    container,
    plugin,
    scope,
    heading,
    name,
    desc,
    placeholder,
    renderCustomContextLimits,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  let envTextarea: HTMLTextAreaElement | null = null;
  const reviewEl = container.createDiv({
    cls: 'specorator-env-review-warning specorator-setting-validation specorator-setting-validation-warning specorator-hidden',
  });

  const updateReviewWarning = () => {
    const reviewKeys = getEnvironmentReviewKeysForScope(envTextarea?.value ?? '', scope);
    if (reviewKeys.length === 0) {
      reviewEl.toggleClass('specorator-hidden', true);
      reviewEl.empty();
      return;
    }

    reviewEl.setText(`Review environment ownership for: ${reviewKeys.join(', ')}`);
    reviewEl.toggleClass('specorator-hidden', false);
  };

  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addTextArea((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.getEnvironmentVariablesForScope(scope));
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass('specorator-settings-env-textarea');
      text.inputEl.dataset.envScope = scope;
      text.inputEl.addEventListener('input', () => updateReviewWarning());
      text.inputEl.addEventListener('blur', () => {
        void (async (): Promise<void> => {
          await plugin.applyEnvironmentVariables(scope, text.inputEl.value);
          renderCustomContextLimits?.(contextLimitsContainer);
          updateReviewWarning();
        })();
      });
      envTextarea = text.inputEl;
    });

  updateReviewWarning();

  // SEC-A: secret env vars (keychain-backed) live in their own structured editor
  // so keys never have to be typed into the plaintext textarea above.
  renderSecretEnvVarsSection({ container, plugin, scope });

  const contextLimitsContainer = container.createDiv({ cls: 'specorator-context-limits-container' });
  renderCustomContextLimits?.(contextLimitsContainer);

  const envSnippetsContainer = container.createDiv({ cls: 'specorator-env-snippets-container' });
  new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    renderCustomContextLimits?.(contextLimitsContainer);
  });
}
