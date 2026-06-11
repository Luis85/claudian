import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../../utils/env';

/**
 * Custom-model override editor (context-window limit + selector alias per
 * model id discovered from the active environment). Extracted from
 * `ClaudianSettings` so the legacy renderer, provider settings tabs, and the
 * settings-registry environment fields all mount the same implementation.
 */
export function renderCustomContextLimits(
  plugin: ClaudianPlugin,
  container: HTMLElement,
  providerId?: ProviderId,
): void {
  container.empty();

  const uniqueModelIds = collectCustomModelIds(plugin, providerId);
  if (uniqueModelIds.size === 0) {
    return;
  }

  const headerEl = container.createDiv({ cls: 'claudian-context-limits-header' });
  headerEl.createSpan({
    text: t('settings.customModelOverrides.name'),
    cls: 'claudian-context-limits-label',
  });

  const descEl = container.createDiv({ cls: 'claudian-context-limits-desc' });
  descEl.setText(t('settings.customModelOverrides.desc'));

  const listEl = container.createDiv({ cls: 'claudian-context-limits-list' });

  for (const modelId of uniqueModelIds) {
    renderModelOverrideRow(plugin, listEl, modelId);
  }
}

function collectCustomModelIds(
  plugin: ClaudianPlugin,
  providerId?: ProviderId,
): Set<string> {
  const uniqueModelIds = new Set<string>();
  const providerIds = providerId
    ? [providerId]
    : ProviderRegistry.getRegisteredProviderIds();

  for (const targetProviderId of providerIds) {
    const envVars = parseEnvironmentVariables(
      plugin.getActiveEnvironmentVariables(targetProviderId),
    );
    for (const modelId of ProviderRegistry.getChatUIConfig(targetProviderId).getCustomModelIds(envVars)) {
      uniqueModelIds.add(modelId);
    }
  }

  return uniqueModelIds;
}

function renderModelOverrideRow(
  plugin: ClaudianPlugin,
  listEl: HTMLElement,
  modelId: string,
): void {
  const currentValue = plugin.settings.customContextLimits?.[modelId];
  const currentAlias = plugin.settings.customModelAliases?.[modelId] ?? '';

  const itemEl = listEl.createDiv({ cls: 'claudian-context-limits-item' });
  const nameEl = itemEl.createDiv({ cls: 'claudian-context-limits-model' });
  nameEl.setText(modelId);

  const inputWrapper = itemEl.createDiv({ cls: 'claudian-context-limits-input-wrapper' });
  const aliasInputEl = inputWrapper.createEl('input', {
    type: 'text',
    placeholder: t('settings.customModelAliases.placeholder'),
    cls: 'claudian-context-alias-input',
    value: currentAlias,
  });
  aliasInputEl.setAttribute('aria-label', `Alias for ${modelId}`);
  aliasInputEl.title = 'Custom label shown in the model selector. Leave empty to use the default.';

  const inputEl = inputWrapper.createEl('input', {
    type: 'text',
    placeholder: '200k',
    cls: 'claudian-context-limits-input',
    value: currentValue ? formatContextLimit(currentValue) : '',
  });
  inputEl.setAttribute('aria-label', `Context window for ${modelId}`);

  const validationEl = inputWrapper.createDiv({ cls: 'claudian-context-limit-validation claudian-hidden' });

  inputEl.addEventListener('input', () => {
    void saveModelContextLimit(plugin, modelId, inputEl, validationEl);
  });
  aliasInputEl.addEventListener('blur', () => {
    void saveModelAlias(plugin, modelId, aliasInputEl);
  });
  aliasInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      aliasInputEl.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      aliasInputEl.value = plugin.settings.customModelAliases?.[modelId] ?? '';
      aliasInputEl.blur();
    }
  });
}

async function saveModelAlias(
  plugin: ClaudianPlugin,
  modelId: string,
  aliasInputEl: HTMLInputElement,
): Promise<void> {
  if (!plugin.settings.customModelAliases) {
    plugin.settings.customModelAliases = {};
  }

  const existing = plugin.settings.customModelAliases[modelId] ?? '';
  const trimmed = aliasInputEl.value.trim();
  if (trimmed === existing) {
    aliasInputEl.value = existing;
    return;
  }

  if (trimmed) {
    plugin.settings.customModelAliases[modelId] = trimmed;
  } else {
    delete plugin.settings.customModelAliases[modelId];
  }

  await plugin.saveSettings();
  for (const view of plugin.getAllViews()) {
    view.refreshModelSelector();
  }
}

async function saveModelContextLimit(
  plugin: ClaudianPlugin,
  modelId: string,
  inputEl: HTMLInputElement,
  validationEl: HTMLElement,
): Promise<void> {
  const trimmed = inputEl.value.trim();

  if (!plugin.settings.customContextLimits) {
    plugin.settings.customContextLimits = {};
  }

  if (!trimmed) {
    delete plugin.settings.customContextLimits[modelId];
    validationEl.toggleClass('claudian-hidden', true);
    inputEl.classList.remove('claudian-input-error');
  } else {
    const parsed = parseContextLimit(trimmed);
    if (parsed === null) {
      validationEl.setText(t('settings.customContextLimits.invalid'));
      validationEl.toggleClass('claudian-hidden', false);
      inputEl.classList.add('claudian-input-error');
      return;
    }

    plugin.settings.customContextLimits[modelId] = parsed;
    validationEl.toggleClass('claudian-hidden', true);
    inputEl.classList.remove('claudian-input-error');
  }

  await plugin.saveSettings();
}
