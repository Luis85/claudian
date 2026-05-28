import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CURSOR_PROVIDER_ICON } from '../../../shared/icons';
import { formatCursorModeLabel, formatCursorModelLabel } from '../modelLabels';
import { getCachedCursorModelIds, STATIC_FALLBACK_MODEL_IDS } from '../runtime/cursorModelCatalog';
import {
  buildCursorFamilies,
  CURSOR_STANDARD_MODE,
  getCursorModelVariants,
  resolveCursorFamilyId,
} from '../runtime/cursorModelFamily';
import {
  fromCursorModelValue,
  isCursorModelValue,
  toCursorModelValue,
} from '../runtime/cursorModelId';
import {
  getCursorEnabledModels,
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '../settings';

const CURSOR_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

const NAMESPACED_FALLBACK_MODEL_VALUES = new Set(
  STATIC_FALLBACK_MODEL_IDS.map(toCursorModelValue),
);

// Curated raw ids the user enabled, plus an env CURSOR_MODEL override. This is
// the source of truth for both the family picker and the per-family mode list.
function enabledRawIds(settings: Record<string, unknown>): string[] {
  const envVars = getRuntimeEnvironmentVariables(settings, 'cursor');
  const ids = [...getCursorEnabledModels(settings)];
  if (envVars.CURSOR_MODEL?.trim()) {
    ids.push(envVars.CURSOR_MODEL.trim());
  }
  return ids;
}

function familyIdFromModelValue(model: string, settings: Record<string, unknown>): string {
  return resolveCursorFamilyId(fromCursorModelValue(model), enabledRawIds(settings));
}

function variantsForModelValue(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const familyId = familyIdFromModelValue(model, settings);
  if (!familyId || familyId === 'auto') {
    return [];
  }
  return getCursorModelVariants(familyId, enabledRawIds(settings)).map((variant) => ({
    value: variant.value,
    label: variant.value === CURSOR_STANDARD_MODE ? 'Standard' : formatCursorModeLabel(variant.value),
  }));
}

export const cursorChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const curated = getCursorEnabledModels(settings);
    const curatedFamilyIds = new Set(buildCursorFamilies(curated).map((family) => family.familyId));

    const autoValue = toCursorModelValue('auto');
    const options: ProviderUIOption[] = [{ value: autoValue, label: formatCursorModelLabel('auto') }];
    const seen = new Set<string>([autoValue]);

    for (const family of buildCursorFamilies(enabledRawIds(settings))) {
      const value = toCursorModelValue(family.familyId);
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      const isEnvOnly = !curatedFamilyIds.has(family.familyId);
      const modeCount = family.variants.length;
      const description = isEnvOnly
        ? 'Custom (env)'
        : modeCount > 1
          ? `${family.vendor} · ${modeCount} modes`
          : family.vendor;
      options.push({ value, label: family.label, description, group: family.vendor });
    }

    return options;
  },

  ownsModel(model: string, _settings: Record<string, unknown>): boolean {
    if (isCursorModelValue(model)) {
      return true;
    }
    return /^composer-/i.test(model) || model === 'auto';
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return variantsForModelValue(model, settings).length > 1;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return variantsForModelValue(model, settings);
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const familyId = familyIdFromModelValue(model, settings);
    const preferred = getCursorProviderSettings(settings).preferredModeByFamily[familyId];
    const variants = variantsForModelValue(model, settings);
    const valid = new Set(variants.map((option) => option.value));
    if (preferred && valid.has(preferred)) {
      return preferred;
    }
    if (valid.has(CURSOR_STANDARD_MODE)) {
      return CURSOR_STANDARD_MODE;
    }
    // Family has no bare id in the discovered set — pick the first runnable
    // variant so the picker never advertises an unselectable default.
    return variants[0]?.value ?? CURSOR_STANDARD_MODE;
  },

  getContextWindowSize(): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return NAMESPACED_FALLBACK_MODEL_VALUES.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;
    const familyValue = this.normalizeModelVariant(model, target);
    const familyId = fromCursorModelValue(familyValue);
    if (!familyId) {
      return;
    }
    updateCursorProviderSettings(target, { lastModel: familyId });
    target.effortLevel = this.getDefaultReasoningValue(familyValue, target);
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;
    const familyId = familyIdFromModelValue(model, target);
    if (!familyId || familyId === 'auto') {
      return;
    }
    const valid = new Set(variantsForModelValue(model, target).map((option) => option.value));
    const current = getCursorProviderSettings(target).preferredModeByFamily;
    const next = { ...current };
    if (!value || value === CURSOR_STANDARD_MODE || !valid.has(value)) {
      delete next[familyId];
    } else {
      next[familyId] = value;
    }
    updateCursorProviderSettings(target, { preferredModeByFamily: next });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (!isCursorModelValue(model) && !/^composer-/i.test(model) && model !== 'auto') {
      return model;
    }
    return toCursorModelValue(familyIdFromModelValue(model, settings));
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.CURSOR_MODEL && !getCachedCursorModelIds().includes(envVars.CURSOR_MODEL)) {
      ids.add(resolveCursorFamilyId(envVars.CURSOR_MODEL, getCachedCursorModelIds()));
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CURSOR_PERMISSION_MODE_TOGGLE;
  },

  isBangBashEnabled(): boolean {
    return false;
  },

  getProviderIcon() {
    return CURSOR_PROVIDER_ICON;
  },
};
