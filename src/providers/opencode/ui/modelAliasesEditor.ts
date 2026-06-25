import type { ProviderSettingsWidgetMount } from '../../../core/providers/types';
import {
  createOpencodePickerStore,
  type EnrichedOpencodeModel,
  type OpencodePickerStore,
  registerOpencodeSelectedEditorRefresh,
} from './visibleModelsPicker';

/**
 * Selected-models editor (per-model alias inputs, remove buttons, clear all),
 * extracted from the legacy `OpencodeSettingsTab` picker so the legacy tab and
 * the settings-registry `modelAliases` custom field mount the SAME
 * implementation. Visible-model changes made here propagate back to the
 * catalog picker through the shared picker store's refresh hooks.
 */

function commitAlias(
  store: OpencodePickerStore,
  rawId: string,
  aliasInput: HTMLInputElement,
): void {
  const latest = store.getSettings();
  const existing = latest.modelAliases[rawId] ?? '';
  const next = aliasInput.value.trim();
  if (next === existing) {
    aliasInput.value = existing;
    return;
  }

  const nextAliases = { ...latest.modelAliases };
  if (next) {
    nextAliases[rawId] = next;
  } else {
    delete nextAliases[rawId];
  }
  void store.persistModelAliases(nextAliases);
}

function renderAliasInput(
  controlsEl: HTMLElement,
  store: OpencodePickerStore,
  rawId: string,
  defaultLabel: string,
): void {
  const aliasInput = controlsEl.createEl('input', {
    cls: 'specorator-opencode-model-picker-selected-alias',
    type: 'text',
  });
  aliasInput.placeholder = defaultLabel;
  aliasInput.value = store.getSettings().modelAliases[rawId] ?? '';
  aliasInput.setAttribute('aria-label', `Alias for ${defaultLabel}`);
  aliasInput.title = 'Custom label shown in the model selector. Leave empty to use the default.';

  aliasInput.addEventListener('blur', () => commitAlias(store, rawId, aliasInput));
  aliasInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      aliasInput.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      aliasInput.value = store.getSettings().modelAliases[rawId] ?? '';
      aliasInput.blur();
    }
  });
}

function renderSelectedRow(
  rowsEl: HTMLElement,
  store: OpencodePickerStore,
  rawId: string,
  enriched: EnrichedOpencodeModel | undefined,
): void {
  const defaultLabel = enriched
    ? `${enriched.providerLabel}/${enriched.modelLabel}`
    : rawId;

  const rowEl = rowsEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-row' });
  if (enriched && !enriched.isAvailable) {
    rowEl.classList.add('specorator-opencode-model-picker-selected-row--unavailable');
  }

  const infoEl = rowEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-info' });
  const titleEl = infoEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-title' });
  if (enriched) {
    titleEl.createEl('span', {
      cls: 'specorator-opencode-model-picker-selected-badge',
      text: enriched.providerLabel,
    });
    titleEl.createEl('span', {
      cls: 'specorator-opencode-model-picker-selected-name',
      text: enriched.modelLabel,
    });
  } else {
    titleEl.createEl('span', {
      cls: 'specorator-opencode-model-picker-selected-name',
      text: rawId,
    });
  }

  if (enriched && !enriched.isAvailable) {
    infoEl.createEl('div', {
      cls: 'specorator-opencode-model-picker-selected-unavailable',
      text: 'Not currently reported by OpenCode',
    });
  }

  infoEl.createEl('div', {
    cls: 'specorator-opencode-model-picker-selected-id',
    text: rawId,
  });

  const controlsEl = rowEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-controls' });
  renderAliasInput(controlsEl, store, rawId, defaultLabel);

  const removeBtn = controlsEl.createEl('button', {
    cls: 'specorator-opencode-model-picker-selected-remove',
    text: '×',
  });
  removeBtn.setAttribute('aria-label', `Remove ${defaultLabel}`);
  removeBtn.addEventListener('click', () => {
    const visibleModels = store.getSettings().visibleModels;
    void store.persistVisibleModels(visibleModels.filter((entry) => entry !== rawId));
  });
}

export function renderOpencodeSelectedModels(
  selectedEl: HTMLElement,
  store: OpencodePickerStore,
): void {
  selectedEl.empty();
  const current = store.getSettings();
  if (current.visibleModels.length === 0) {
    selectedEl.toggleClass('specorator-hidden', true);
    return;
  }

  selectedEl.toggleClass('specorator-hidden', false);
  const enrichedByRawId = new Map(
    store.getEnrichedModels().map((model) => [model.rawId, model] as const),
  );

  const headerEl = selectedEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-header' });
  headerEl.createEl('span', {
    cls: 'specorator-opencode-model-picker-selected-label',
    text: `Selected (${current.visibleModels.length})`,
  });
  const clearAllBtn = headerEl.createEl('button', {
    cls: 'specorator-opencode-model-picker-selected-clear',
    text: 'Clear all',
  });
  clearAllBtn.setAttribute('aria-label', 'Clear all selected models');
  clearAllBtn.addEventListener('click', () => {
    void store.persistVisibleModels([]);
  });

  const rowsEl = selectedEl.createDiv({ cls: 'specorator-opencode-model-picker-selected-rows' });

  for (const rawId of current.visibleModels) {
    renderSelectedRow(rowsEl, store, rawId, enrichedByRawId.get(rawId));
  }
}

export const mountOpencodeModelAliasesEditor: ProviderSettingsWidgetMount = (host, context) => {
  const store = createOpencodePickerStore(context);
  const pickerEl = host.createDiv({ cls: 'specorator-opencode-model-picker' });
  const selectedEl = pickerEl.createDiv({ cls: 'specorator-opencode-model-picker-selected' });

  const render = (): void => renderOpencodeSelectedModels(selectedEl, store);
  registerOpencodeSelectedEditorRefresh(render);
  render();
};
