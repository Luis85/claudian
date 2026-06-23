import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../../utils/env';

/**
 * Custom-model override editor (context-window limit + selector alias per
 * model id discovered from the active environment). Extracted from
 * `SpecoratorSettings` so the legacy renderer, provider settings tabs, and the
 * settings-registry environment fields all mount the same implementation.
 */
export function renderCustomContextLimits(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
  providerId?: ProviderId,
): void {
  container.empty();

  const uniqueModelIds = collectCustomModelIds(plugin, providerId);
  if (uniqueModelIds.size === 0) {
    return;
  }

  const headerEl = container.createDiv({ cls: 'specorator-context-limits-header' });
  headerEl.createSpan({
    text: t('settings.customModelOverrides.name'),
    cls: 'specorator-context-limits-label',
  });

  const descEl = container.createDiv({ cls: 'specorator-context-limits-desc' });
  descEl.setText(t('settings.customModelOverrides.desc'));

  const listEl = container.createDiv({ cls: 'specorator-context-limits-list' });

  for (const modelId of uniqueModelIds) {
    renderModelOverrideRow(plugin, listEl, modelId);
  }
}

function collectCustomModelIds(
  plugin: SpecoratorPlugin,
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
  plugin: SpecoratorPlugin,
  listEl: HTMLElement,
  modelId: string,
): void {
  const currentValue = plugin.settings.customContextLimits?.[modelId];
  const currentAlias = plugin.settings.customModelAliases?.[modelId] ?? '';

  const itemEl = listEl.createDiv({ cls: 'specorator-context-limits-item' });
  const nameEl = itemEl.createDiv({ cls: 'specorator-context-limits-model' });
  nameEl.setText(modelId);

  const inputWrapper = itemEl.createDiv({ cls: 'specorator-context-limits-input-wrapper' });
  const aliasInputEl = inputWrapper.createEl('input', {
    type: 'text',
    placeholder: t('settings.customModelAliases.placeholder'),
    cls: 'specorator-context-alias-input',
    value: currentAlias,
  });
  aliasInputEl.setAttribute('aria-label', `Alias for ${modelId}`);
  aliasInputEl.title = 'Custom label shown in the model selector. Leave empty to use the default.';

  const inputEl = inputWrapper.createEl('input', {
    type: 'text',
    placeholder: '200k',
    cls: 'specorator-context-limits-input',
    value: currentValue ? formatContextLimit(currentValue) : '',
  });
  inputEl.setAttribute('aria-label', `Context window for ${modelId}`);

  const validationEl = inputWrapper.createDiv({ cls: 'specorator-context-limit-validation specorator-hidden' });

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
  plugin: SpecoratorPlugin,
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
  plugin: SpecoratorPlugin,
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
    validationEl.toggleClass('specorator-hidden', true);
    inputEl.classList.remove('specorator-input-error');
  } else {
    const parsed = parseContextLimit(trimmed);
    if (parsed === null) {
      validationEl.setText(t('settings.customContextLimits.invalid'));
      validationEl.toggleClass('specorator-hidden', false);
      inputEl.classList.add('specorator-input-error');
      return;
    }

    plugin.settings.customContextLimits[modelId] = parsed;
    validationEl.toggleClass('specorator-hidden', true);
    inputEl.classList.remove('specorator-input-error');
  }

  await plugin.saveSettings();
}
