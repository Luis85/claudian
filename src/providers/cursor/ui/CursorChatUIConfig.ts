import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CURSOR_PROVIDER_ICON } from '../../../shared/icons';
import { formatCursorModelLabel } from '../modelLabels';
import { getCachedCursorModelIds, STATIC_FALLBACK_MODEL_IDS } from '../runtime/cursorModelCatalog';
import {
  isCursorModelValue,
  toCursorModelValue,
} from '../runtime/cursorModelId';
import { updateCursorProviderSettings } from '../settings';

const CURSOR_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

const REASONING_OFF: ProviderReasoningOption[] = [
  { value: 'off', label: 'Off' },
];

// Namespaced fallback values, e.g. `cursor:auto`, `cursor:composer-2`.
const NAMESPACED_FALLBACK_MODEL_VALUES = new Set(
  STATIC_FALLBACK_MODEL_IDS.map(toCursorModelValue),
);

// `value` is namespaced (`cursor:<rawId>`) for unambiguous routing; the label
// stays the pretty name derived from the raw id.
function buildModelOption(rawId: string, description?: string): ProviderUIOption {
  const value = toCursorModelValue(rawId);
  return description
    ? { value, label: formatCursorModelLabel(rawId), description }
    : { value, label: formatCursorModelLabel(rawId) };
}

export const cursorChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const envVars = getRuntimeEnvironmentVariables(settings, 'cursor');
    const discovered = getCachedCursorModelIds();

    // Dedupe by final namespaced value so a raw id and its `cursor:` form
    // never both appear.
    const seen = new Set<string>();
    const options: ProviderUIOption[] = [];

    const add = (rawId: string, description?: string): void => {
      const trimmed = rawId.trim();
      if (!trimmed) {
        return;
      }
      const value = toCursorModelValue(trimmed);
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      options.push(buildModelOption(trimmed, description));
    };

    // Always make 'auto' (value `cursor:auto`) available and first.
    add('auto');

    for (const id of discovered) {
      add(id);
    }

    // Env override and custom additions are kept even if not discovered.
    if (envVars.CURSOR_MODEL) {
      const envValue = toCursorModelValue(envVars.CURSOR_MODEL);
      add(envVars.CURSOR_MODEL, seen.has(envValue) ? undefined : 'Custom (env)');
    }

    return options;
  },

  ownsModel(model: string, _settings: Record<string, unknown>): boolean {
    if (isCursorModelValue(model)) {
      return true;
    }
    // Backward-compat for any pre-namespace persisted values.
    return /^composer-/i.test(model) || model === 'auto';
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...REASONING_OFF];
  },

  getDefaultReasoningValue(): string {
    return 'off';
  },

  getContextWindowSize(): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return NAMESPACED_FALLBACK_MODEL_VALUES.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const trimmed = model.trim();
    if (!trimmed) {
      return;
    }
    updateCursorProviderSettings(settings as Record<string, unknown>, { lastModel: trimmed });
  },

  normalizeModelVariant(model: string): string {
    return model;
  },

  // Returns RAW env ids (not namespaced). These key the per-model context-limit
  // and alias maps, which are independent of provider routing — those maps are
  // looked up by raw env model id, so namespacing here would break them.
  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.CURSOR_MODEL && !getCachedCursorModelIds().includes(envVars.CURSOR_MODEL)) {
      ids.add(envVars.CURSOR_MODEL);
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
