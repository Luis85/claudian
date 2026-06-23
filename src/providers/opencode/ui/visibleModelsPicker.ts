import { Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/types';
import { createHeadlessRuntimeHost } from '../../../core/runtime/RuntimeHost';
import { asSettingsBag } from '../../../core/types';
import { sameStringList } from '../internal/compareCollections';
import {
  buildOpencodeBaseModels,
  encodeOpencodeModelId,
  type OpencodeDiscoveredModel,
  splitOpencodeModelLabel,
} from '../models';
import { OpencodeChatRuntime } from '../runtime/OpencodeChatRuntime';
import {
  getOpencodeProviderSettings,
  normalizeOpencodeVisibleModels,
  type OpencodeProviderSettings,
  updateOpencodeProviderSettings,
} from '../settings';

/**
 * Visible-models picker, extracted from `OpencodeSettingsTab` so the legacy
 * provider tab renderer and the settings-registry custom field mount the SAME
 * implementation (settings-registry port, Decision 2). The selected-models /
 * alias editor lives in `modelAliasesEditor.ts`; the two widgets share the
 * picker store below and refresh each other through the single-slot handlers.
 */

const ALL_PROVIDERS_KEY = 'all';
const OPENCODE_METADATA_WARMUP_DB = ':memory:';

export interface EnrichedOpencodeModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

// Cross-widget refresh hooks. The registry mounts the catalog picker and the
// selected-models editor as separate fields, so a visible-models change made
// in one must re-render the other. Single slots (overwritten on every mount)
// keep stale closures bounded — the widget seam has no disposer, and Obsidian
// only ever shows one settings surface at a time.
let refreshCatalog: (() => void) | null = null;
let refreshSelected: (() => void) | null = null;

/** Registers the selected-models editor's re-render hook. */
export function registerOpencodeSelectedEditorRefresh(handler: () => void): void {
  refreshSelected = handler;
}

function notifyVisibleModelsChanged(): void {
  refreshCatalog?.();
  refreshSelected?.();
}

export interface OpencodePickerStore {
  context: ProviderSettingsWidgetContext;
  getSettings(): OpencodeProviderSettings;
  getEnrichedModels(): EnrichedOpencodeModel[];
  persistVisibleModels(next: string[]): Promise<void>;
  persistModelAliases(next: Record<string, string>): Promise<void>;
  warmModelMetadata(rawId: string): Promise<void>;
}

export function createOpencodePickerStore(
  context: ProviderSettingsWidgetContext,
): OpencodePickerStore {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const getSettings = (): OpencodeProviderSettings => getOpencodeProviderSettings(settingsBag);

  return {
    context,
    getSettings,
    getEnrichedModels: () => {
      const current = getSettings();
      return buildEnrichedOpencodeModels(current.discoveredModels, current.visibleModels);
    },
    persistVisibleModels: async (next) => {
      const current = getSettings();
      const normalized = normalizeOpencodeVisibleModels(next, current.discoveredModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      updateOpencodeProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      notifyVisibleModelsChanged();
      context.refreshModelSelectors();
    },
    persistModelAliases: async (next) => {
      updateOpencodeProviderSettings(settingsBag, { modelAliases: next });
      await context.plugin.saveSettings();
      refreshSelected?.();
      context.refreshModelSelectors();
    },
    warmModelMetadata: async (rawId) => {
      const runtime = new OpencodeChatRuntime(context.plugin, createHeadlessRuntimeHost());
      try {
        runtime.syncConversationState({
          providerState: { databasePath: OPENCODE_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.warmModelMetadata(encodeOpencodeModelId(rawId));
        if (loaded) {
          context.refreshModelSelectors();
        }
      } catch {
        // Metadata warmup is opportunistic; the first chat turn can still discover it.
      } finally {
        runtime.cleanup();
      }
    },
  };
}

export function buildEnrichedOpencodeModels(
  discoveredModels: OpencodeDiscoveredModel[],
  visibleModels: string[],
): EnrichedOpencodeModel[] {
  const enriched: EnrichedOpencodeModel[] = [];
  const discoveredIds = new Set<string>();
  const baseModels = buildOpencodeBaseModels(discoveredModels);

  for (const model of baseModels) {
    const { modelLabel, providerLabel } = splitOpencodeModelLabel(model.label || model.rawId);
    discoveredIds.add(model.rawId);
    enriched.push({
      description: model.description ?? '',
      isAvailable: true,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId: model.rawId,
    });
  }

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitOpencodeModelLabel(rawId);
    enriched.push({
      description: '',
      isAvailable: false,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId,
    });
  }

  return enriched.sort((left, right) => {
    const providerCmp = left.providerLabel.localeCompare(right.providerLabel);
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.modelLabel.localeCompare(right.modelLabel);
  });
}

interface PickerCatalogState {
  searchQuery: string;
  providerFilter: string;
  loading: boolean;
  loadFailed: boolean;
}

function filterEnrichedModels(
  models: EnrichedOpencodeModel[],
  state: PickerCatalogState,
): EnrichedOpencodeModel[] {
  return models.filter((model) => {
    if (state.providerFilter !== ALL_PROVIDERS_KEY && model.providerKey !== state.providerFilter) {
      return false;
    }

    if (!state.searchQuery) {
      return true;
    }

    return (
      model.rawId.toLowerCase().includes(state.searchQuery)
      || model.modelLabel.toLowerCase().includes(state.searchQuery)
      || model.providerLabel.toLowerCase().includes(state.searchQuery)
      || model.description.toLowerCase().includes(state.searchQuery)
    );
  });
}

function emptyCatalogText(
  state: PickerCatalogState,
  enrichedCount: number,
): string {
  if (state.loading) {
    return 'Loading OpenCode model catalog...';
  }
  if (state.loadFailed) {
    return 'Could not load the OpenCode model catalog. Check the CLI path and login state, then expand this section again.';
  }
  if (enrichedCount === 0) {
    return 'Start OpenCode once to load its model catalog. Specorator will then let you pick visible models.';
  }
  return 'No models match your filter.';
}

function renderCatalogRow(
  listEl: HTMLElement,
  store: OpencodePickerStore,
  model: EnrichedOpencodeModel,
  isSelected: boolean,
): void {
  const rowEl = listEl.createEl('label', { cls: 'specorator-opencode-model-picker-row' });
  if (isSelected) {
    rowEl.classList.add('specorator-opencode-model-picker-row--selected');
  }
  rowEl.title = model.rawId;

  const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
  checkboxEl.checked = isSelected;
  checkboxEl.addEventListener('change', () => {
    const currentVisibleModels = store.getSettings().visibleModels;
    const next = checkboxEl.checked
      ? [...currentVisibleModels, model.rawId]
      : currentVisibleModels.filter((id) => id !== model.rawId);
    void (async () => {
      await store.persistVisibleModels(next);
      if (checkboxEl.checked) {
        await store.warmModelMetadata(model.rawId);
      }
    })();
  });

  const textEl = rowEl.createDiv({ cls: 'specorator-opencode-model-picker-row-text' });

  const headerEl = textEl.createDiv({ cls: 'specorator-opencode-model-picker-row-header' });
  headerEl.createEl('span', {
    cls: 'specorator-opencode-model-picker-row-name',
    text: model.modelLabel,
  });
  const badgeEl = headerEl.createEl('span', {
    cls: 'specorator-opencode-model-picker-row-badge',
    text: model.providerLabel,
  });
  if (!model.isAvailable) {
    badgeEl.classList.add('specorator-opencode-model-picker-row-badge--unavailable');
    badgeEl.setText('Unavailable');
    badgeEl.title = 'Configured model not currently reported by OpenCode';
  }

  textEl.createDiv({
    cls: 'specorator-opencode-model-picker-row-meta',
    text: model.rawId,
  });

  if (model.description) {
    textEl.createDiv({
      cls: 'specorator-opencode-model-picker-row-desc',
      text: model.description,
    });
  }
}

interface OpencodeCatalogView {
  store: OpencodePickerStore;
  state: PickerCatalogState;
  summaryEl: HTMLElement;
  catalogSummaryCountEl: HTMLElement;
  providerSelectEl: HTMLSelectElement;
  listEl: HTMLElement;
}

function renderSummary(view: OpencodeCatalogView): void {
  view.summaryEl.empty();
  const current = view.store.getSettings();
  const enriched = view.store.getEnrichedModels();
  const providerCount = new Set(enriched.map((model) => model.providerKey)).size;
  const providerWord = providerCount === 1 ? 'provider' : 'providers';

  view.summaryEl.createSpan({ text: 'Visible: ' });
  view.summaryEl.createSpan({
    cls: 'specorator-opencode-model-picker-summary-value',
    text: String(current.visibleModels.length),
  });
  view.summaryEl.createSpan({
    text: ` of ${current.discoveredModels.length} discovered • ${providerCount} ${providerWord}`,
  });

  let catalogSummary = 'No models discovered yet';
  if (view.state.loading) {
    catalogSummary = 'Loading models...';
  } else if (current.discoveredModels.length > 0) {
    catalogSummary = `${current.discoveredModels.length} available`;
  }
  view.catalogSummaryCountEl.setText(catalogSummary);
}

function renderProviderSelect(view: OpencodeCatalogView): void {
  const enriched = view.store.getEnrichedModels();
  const providers = new Map<string, { count: number; label: string }>();
  for (const model of enriched) {
    const existing = providers.get(model.providerKey);
    if (existing) {
      existing.count += 1;
    } else {
      providers.set(model.providerKey, { count: 1, label: model.providerLabel });
    }
  }

  view.providerSelectEl.empty();
  view.providerSelectEl.createEl('option', {
    text: `All providers (${enriched.length})`,
    value: ALL_PROVIDERS_KEY,
  });

  const sortedProviders = Array.from(providers.entries())
    .sort(([, left], [, right]) => left.label.localeCompare(right.label));
  for (const [key, { count, label }] of sortedProviders) {
    view.providerSelectEl.createEl('option', {
      text: `${label} (${count})`,
      value: key,
    });
  }

  if (view.state.providerFilter !== ALL_PROVIDERS_KEY && !providers.has(view.state.providerFilter)) {
    view.state.providerFilter = ALL_PROVIDERS_KEY;
  }
  view.providerSelectEl.value = view.state.providerFilter;
}

function renderCatalogList(view: OpencodeCatalogView): void {
  view.listEl.empty();
  const selectedIds = new Set(view.store.getSettings().visibleModels);
  const enriched = view.store.getEnrichedModels();
  const filtered = filterEnrichedModels(enriched, view.state);

  if (filtered.length === 0) {
    const emptyEl = view.listEl.createDiv({ cls: 'specorator-opencode-model-picker-empty' });
    emptyEl.setText(emptyCatalogText(view.state, enriched.length));
    return;
  }

  for (const model of filtered) {
    renderCatalogRow(view.listEl, view.store, model, selectedIds.has(model.rawId));
  }
}

function renderCatalog(view: OpencodeCatalogView): void {
  renderSummary(view);
  renderProviderSelect(view);
  renderCatalogList(view);
}

async function loadModelCatalog(view: OpencodeCatalogView): Promise<void> {
  const { state, store } = view;
  if (state.loading || store.getSettings().discoveredModels.length > 0) {
    return;
  }

  state.loading = true;
  state.loadFailed = false;
  renderCatalog(view);

  const runtime = new OpencodeChatRuntime(store.context.plugin, createHeadlessRuntimeHost());
  try {
    runtime.syncConversationState({
      providerState: { databasePath: OPENCODE_METADATA_WARMUP_DB },
      sessionId: null,
    });
    const loaded = await runtime.ensureReady({ allowSessionCreation: true });
    state.loadFailed = !loaded || store.getSettings().discoveredModels.length === 0;
    if (!state.loadFailed) {
      store.context.refreshModelSelectors();
    }
  } catch {
    state.loadFailed = true;
  } finally {
    state.loading = false;
    runtime.cleanup();
    renderCatalog(view);
  }
}

function buildCatalogDetails(pickerEl: HTMLElement, initiallyOpen: boolean): {
  catalogEl: HTMLDetailsElement;
  catalogSummaryCountEl: HTMLElement;
} {
  const catalogEl = pickerEl.createEl('details', { cls: 'specorator-opencode-model-picker-catalog' });
  catalogEl.open = initiallyOpen;
  const catalogSummaryEl = catalogEl.createEl('summary', {
    cls: 'specorator-opencode-model-picker-catalog-summary',
  });
  catalogSummaryEl.createSpan({
    cls: 'specorator-opencode-model-picker-catalog-caret',
    text: '▸',
  });
  catalogSummaryEl.createSpan({
    cls: 'specorator-opencode-model-picker-catalog-title',
    text: 'Browse models',
  });
  const catalogSummaryCountEl = catalogSummaryEl.createSpan({
    cls: 'specorator-opencode-model-picker-catalog-count',
  });
  return { catalogEl, catalogSummaryCountEl };
}

export const mountOpencodeVisibleModelsPicker: ProviderSettingsWidgetMount = (host, context) => {
  const store = createOpencodePickerStore(context);

  new Setting(host)
    .setName('Visible models')
    .setDesc('Choose which OpenCode models appear in the chat selector. Filter by provider or type to search. The current session model stays pinned even if it is not selected here.');

  const pickerEl = host.createDiv({ cls: 'specorator-opencode-model-picker' });
  const summaryEl = pickerEl.createDiv({ cls: 'specorator-opencode-model-picker-summary' });
  const { catalogEl, catalogSummaryCountEl } = buildCatalogDetails(
    pickerEl,
    store.getSettings().visibleModels.length === 0,
  );

  const controlsEl = catalogEl.createDiv({ cls: 'specorator-opencode-model-picker-controls' });
  const searchInput = controlsEl.createEl('input', {
    cls: 'specorator-opencode-model-picker-search',
    type: 'search',
  });
  searchInput.placeholder = 'Filter by model, provider, or ID…';
  const providerSelectEl = controlsEl.createEl('select', {
    cls: 'specorator-opencode-model-picker-provider',
  });
  const listEl = catalogEl.createDiv({ cls: 'specorator-opencode-model-picker-list' });

  const view: OpencodeCatalogView = {
    store,
    state: {
      searchQuery: '',
      providerFilter: ALL_PROVIDERS_KEY,
      loading: false,
      loadFailed: false,
    },
    summaryEl,
    catalogSummaryCountEl,
    providerSelectEl,
    listEl,
  };

  searchInput.addEventListener('input', () => {
    view.state.searchQuery = searchInput.value.trim().toLowerCase();
    renderCatalogList(view);
  });
  providerSelectEl.addEventListener('change', () => {
    view.state.providerFilter = providerSelectEl.value;
    renderCatalogList(view);
  });
  catalogEl.addEventListener('toggle', () => {
    if (catalogEl.open) {
      void loadModelCatalog(view);
    }
  });

  refreshCatalog = (): void => renderCatalog(view);
  renderCatalog(view);

  if (catalogEl.open) {
    void loadModelCatalog(view);
  }
};
