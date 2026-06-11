import { Notice, Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { getVaultPath } from '../../../utils/path';
import { buildCursorAgentEnvironment } from '../runtime/cursorAgentEnv';
import { getCachedCursorModelIds, refreshCursorModelCatalog } from '../runtime/cursorModelCatalog';
import {
  buildCursorFamilies,
  CURSOR_STANDARD_MODE,
  type CursorModelFamily,
  getCursorModelVariants,
} from '../runtime/cursorModelFamily';
import { getCursorEnabledModels, setCursorEnabledModels } from '../settings';
import { matchesCursorModelQuery } from './cursorModelFilter';

/**
 * Family-grouped visible-models picker (search, count badge, select all/none,
 * refresh button), extracted from `CursorSettingsTab` so the legacy provider
 * tab renderer and the settings-registry custom field mount the SAME
 * implementation (settings-registry port, Decision 2).
 */

interface CursorPickerView {
  context: ProviderSettingsWidgetContext;
  settingsBag: Record<string, unknown>;
  searchQuery: string;
  countEl: HTMLElement;
  listEl: HTMLElement;
}

// All discovered + currently-enabled raw ids (auto excluded). Source for the
// family grouping shown in the list.
function getAllCursorRawIds(settingsBag: Record<string, unknown>): string[] {
  const discovered = getCachedCursorModelIds().filter((id) => id !== 'auto');
  const enabled = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...discovered, ...enabled]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// The raw ids that make up a family (bare id + its variant ids), restricted
// to what is actually discovered/enabled.
function familyMemberRawIds(settingsBag: Record<string, unknown>, familyId: string): string[] {
  const all = getAllCursorRawIds(settingsBag);
  const variantValues = getCursorModelVariants(familyId, all).map((v) => v.value);
  return all.filter((id) =>
    id === familyId
    || variantValues.some((mode) => mode !== CURSOR_STANDARD_MODE && id === `${familyId}-${mode}`));
}

// A family is enabled when any of its member raw ids is enabled.
function isFamilyEnabled(settingsBag: Record<string, unknown>, familyId: string): boolean {
  const enabled = new Set(getCursorEnabledModels(settingsBag));
  return familyMemberRawIds(settingsBag, familyId).some((id) => enabled.has(id));
}

function visibleFamilies(view: CursorPickerView): CursorModelFamily[] {
  return buildCursorFamilies(getAllCursorRawIds(view.settingsBag)).filter((family) =>
    matchesCursorModelQuery(family.familyId, view.searchQuery)
    || matchesCursorModelQuery(family.label, view.searchQuery));
}

async function persistEnabledModels(view: CursorPickerView, ids: string[]): Promise<void> {
  setCursorEnabledModels(view.settingsBag, ids);
  await view.context.plugin.saveSettings();
  view.context.refreshModelSelectors();
}

function renderCount(view: CursorPickerView): void {
  const families = buildCursorFamilies(getAllCursorRawIds(view.settingsBag));
  const selected = families.filter((family) => isFamilyEnabled(view.settingsBag, family.familyId)).length;
  view.countEl.setText(`${selected} of ${families.length} families selected`);
}

function renderFamilyRow(view: CursorPickerView, family: CursorModelFamily): void {
  const rowEl = view.listEl.createEl('label', { cls: 'claudian-cursor-model-picker-row' });
  rowEl.title = family.familyId;

  const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
  checkboxEl.checked = isFamilyEnabled(view.settingsBag, family.familyId);
  checkboxEl.addEventListener('change', () => {
    const current = getCursorEnabledModels(view.settingsBag).filter((entry) => entry !== 'auto');
    const members = new Set(familyMemberRawIds(view.settingsBag, family.familyId));
    const next = checkboxEl.checked
      ? [...new Set([...current, ...members])]
      : current.filter((entry) => !members.has(entry));
    void (async () => {
      await persistEnabledModels(view, next);
      renderCount(view);
    })();
  });

  const textEl = rowEl.createDiv({ cls: 'claudian-cursor-model-picker-row-text' });
  textEl.createDiv({
    cls: 'claudian-cursor-model-picker-row-name',
    text: family.label,
  });
  const modeHint = family.variants.length > 1
    ? `${family.vendor} · ${family.variants.length} modes`
    : family.vendor;
  textEl.createDiv({
    cls: 'claudian-cursor-model-picker-row-id',
    text: modeHint,
  });
}

function renderFamilyList(view: CursorPickerView): void {
  view.listEl.empty();
  const families = visibleFamilies(view);

  if (families.length === 0) {
    const emptyEl = view.listEl.createDiv({ cls: 'claudian-cursor-model-picker-empty' });
    if (buildCursorFamilies(getAllCursorRawIds(view.settingsBag)).length === 0) {
      emptyEl.setText('No models discovered yet. Set the Cursor CLI path below, then refresh the model list.');
    } else {
      emptyEl.setText('No models match your filter.');
    }
    return;
  }

  for (const family of families) {
    renderFamilyRow(view, family);
  }
}

function renderAll(view: CursorPickerView): void {
  renderCount(view);
  renderFamilyList(view);
}

async function selectAllVisibleFamilies(view: CursorPickerView): Promise<void> {
  const current = getCursorEnabledModels(view.settingsBag).filter((id) => id !== 'auto');
  const next = new Set(current);
  for (const family of visibleFamilies(view)) {
    for (const id of familyMemberRawIds(view.settingsBag, family.familyId)) {
      next.add(id);
    }
  }
  await persistEnabledModels(view, [...next]);
  renderAll(view);
}

function announceDiscoveredModels(count: number): void {
  if (count === 0) {
    new Notice(t('provider.cursor.models.noModels'), 6000);
    return;
  }
  new Notice(t(
    count === 1
      ? 'provider.cursor.models.discoveredOne'
      : 'provider.cursor.models.discoveredMany',
    { count },
  ));
}

/** Returns true when the catalog refresh ran (so the caller should re-render). */
async function discoverCursorModels(
  context: ProviderSettingsWidgetContext,
  announce: boolean,
): Promise<boolean> {
  const cliPath = context.plugin.getResolvedProviderCliPath('cursor');
  if (!cliPath) {
    if (announce) {
      new Notice(t('provider.cursor.cli.notFound'));
    }
    return false;
  }
  const env = buildCursorAgentEnvironment(context.plugin);
  const cwd = getVaultPath(context.plugin.app) ?? process.cwd();
  try {
    const ids = await refreshCursorModelCatalog(cliPath, env, cwd);
    if (announce) {
      announceDiscoveredModels(ids.length);
    }
    return true;
  } catch {
    if (announce) {
      new Notice(t('provider.cursor.models.refreshFailed'));
    }
    return false;
  }
}

async function discoverAndRender(view: CursorPickerView, announce: boolean): Promise<void> {
  if (await discoverCursorModels(view.context, announce)) {
    renderAll(view);
  }
}

function renderRefreshModelsSetting(host: HTMLElement, view: CursorPickerView): void {
  new Setting(host)
    .setName('Refresh models')
    .setDesc('Discover the models exposed by the Cursor CLI (`agent --list-models`).')
    .addButton((button) =>
      button
        .setButtonText('Refresh models')
        .onClick(async () => {
          button.setDisabled(true);
          await discoverAndRender(view, true);
          button.setDisabled(false);
        })
    );
}

export const mountCursorVisibleModelsPicker: ProviderSettingsWidgetMount = (host, context) => {
  new Setting(host)
    .setName('Visible models')
    .setDesc('Choose which Cursor models appear in the picker. `auto` is always available.');

  const pickerEl = host.createDiv({ cls: 'claudian-cursor-model-picker' });
  const controlsEl = pickerEl.createDiv({ cls: 'claudian-cursor-model-picker-controls' });

  const searchInput = controlsEl.createEl('input', {
    cls: 'claudian-cursor-model-picker-search',
    type: 'search',
  });
  searchInput.placeholder = 'Filter models…';

  const selectAllBtn = controlsEl.createEl('button', {
    cls: 'claudian-cursor-model-picker-action',
    text: 'Select all',
  });
  const selectNoneBtn = controlsEl.createEl('button', {
    cls: 'claudian-cursor-model-picker-action',
    text: 'Select none',
  });
  const countEl = controlsEl.createSpan({ cls: 'claudian-cursor-model-picker-count' });
  const listEl = pickerEl.createDiv({ cls: 'claudian-cursor-model-picker-list' });

  const view: CursorPickerView = {
    context,
    settingsBag: asSettingsBag(context.plugin.settings),
    searchQuery: '',
    countEl,
    listEl,
  };

  searchInput.addEventListener('input', () => {
    view.searchQuery = searchInput.value;
    renderFamilyList(view);
  });
  selectAllBtn.addEventListener('click', () => {
    void selectAllVisibleFamilies(view);
  });
  selectNoneBtn.addEventListener('click', () => {
    void (async () => {
      await persistEnabledModels(view, []);
      renderAll(view);
    })();
  });

  renderRefreshModelsSetting(host, view);

  renderAll(view);

  // Best-effort warm discovery so the list is populated by the time it opens.
  void discoverAndRender(view, false);
};
