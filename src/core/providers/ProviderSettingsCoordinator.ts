import type { Conversation } from '../types';
import { ProviderRegistry } from './ProviderRegistry';
import type { EnvTextResolver, ProviderChatUIConfig, ProviderId } from './types';

export interface SettingsReconciliationResult {
  changed: boolean;
  invalidatedConversations: Conversation[];
}

const PROJECTION_KEYS = new Set([
  'model',
  'effortLevel',
  'serviceTier',
  'thinkingBudget',
  'permissionMode',
]);

type ProviderProjectionMap = Partial<Record<string, string>>;

function getSettingsProviderId(settings: Record<string, unknown>): ProviderId {
  return ProviderRegistry.resolveSettingsProviderId(settings);
}

function ensureProjectionMap(
  settings: Record<string, unknown>,
  key:
  | 'savedProviderModel'
  | 'savedProviderEffort'
  | 'savedProviderServiceTier'
  | 'savedProviderThinkingBudget'
  | 'savedProviderPermissionMode',
): ProviderProjectionMap {
  const current = settings[key];
  if (current && typeof current === 'object') {
    return current;
  }

  const next: ProviderProjectionMap = {};
  settings[key] = next;
  return next;
}

function cloneProviderSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...settings,
    savedProviderModel: { ...(settings.savedProviderModel as ProviderProjectionMap | undefined) },
    savedProviderEffort: { ...(settings.savedProviderEffort as ProviderProjectionMap | undefined) },
    savedProviderServiceTier: { ...(settings.savedProviderServiceTier as ProviderProjectionMap | undefined) },
    savedProviderThinkingBudget: { ...(settings.savedProviderThinkingBudget as ProviderProjectionMap | undefined) },
    savedProviderPermissionMode: { ...(settings.savedProviderPermissionMode as ProviderProjectionMap | undefined) },
  };
}

function normalizeToggleValue(
  value: unknown,
  allowedValues: Set<string>,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return allowedValues.has(value) ? value : undefined;
}

function mergeProviderSettings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (PROJECTION_KEYS.has(key)) {
      continue;
    }
    target[key] = value;
  }
}

function normalizeReasoningValue(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  model: string,
  value: unknown,
): string {
  const allowedValues = new Set(uiConfig.getReasoningOptions(model, settings).map(option => option.value));
  if (typeof value === 'string' && allowedValues.has(value)) {
    return value;
  }
  return uiConfig.getDefaultReasoningValue(model, settings);
}

function normalizeProviderModel(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  model: string | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  return uiConfig.normalizeModelVariant(model, settings);
}

// Reasoning selections captured before applyModelDefaults overwrites them, so
// the project* helpers can restore the user's choice instead of the model
// default when the projection is reusing the current selection.
interface CurrentReasoningSelections {
  effort: string | undefined;
  serviceTier: string | undefined;
  budget: string | undefined;
}

interface ResolvedProjectionModel {
  model: string;
  isAdaptive: boolean;
  /** True when the projected model equals the (normalized) current top-level model. */
  canReuseCurrentProjection: boolean;
}

function isDefaultModelOfAnotherProvider(model: string, providerId: ProviderId): boolean {
  if (model.length === 0) {
    return false;
  }
  return ProviderRegistry.getRegisteredProviderIds()
    .filter(id => id !== providerId)
    .some(id => ProviderRegistry.getChatUIConfig(id).isDefaultModel(model));
}

function resolveProjectionModel(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  providerId: ProviderId,
  preferCurrent: boolean,
): ResolvedProjectionModel {
  const savedModel = settings.savedProviderModel as ProviderProjectionMap | undefined;
  const currentModelRaw = typeof settings.model === 'string' ? settings.model : '';
  const currentModel = preferCurrent
    ? (normalizeProviderModel(uiConfig, settings, currentModelRaw) ?? '')
    : currentModelRaw;
  const modelOptions = uiConfig.getModelOptions(settings);

  const canReuseCurrentModel = currentModel.length > 0
    && !isDefaultModelOfAnotherProvider(currentModel, providerId)
    && (preferCurrent || modelOptions.some(option => option.value === currentModel));
  const fallbackModel = canReuseCurrentModel
    ? currentModel
    : (modelOptions[0]?.value ?? currentModel);

  const savedModelValue = normalizeProviderModel(uiConfig, settings, savedModel?.[providerId]);
  const isSavedModelValid = savedModelValue !== undefined
    && modelOptions.some(option => option.value === savedModelValue);
  const model = (isSavedModelValid ? savedModelValue : undefined) ?? fallbackModel;

  return {
    model,
    isAdaptive: Boolean(model) && uiConfig.isAdaptiveReasoningModel(model, settings),
    canReuseCurrentProjection: canReuseCurrentModel && model === currentModel,
  };
}

function projectEffortLevel(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  providerId: ProviderId,
  resolved: ResolvedProjectionModel,
  currentEffort: string | undefined,
): void {
  const savedEffort = settings.savedProviderEffort as ProviderProjectionMap | undefined;
  const { model, isAdaptive, canReuseCurrentProjection } = resolved;

  if (savedEffort?.[providerId] !== undefined) {
    settings.effortLevel = savedEffort[providerId];
  } else if (canReuseCurrentProjection && currentEffort !== undefined) {
    settings.effortLevel = currentEffort;
  } else if (isAdaptive) {
    settings.effortLevel = uiConfig.getDefaultReasoningValue(model, settings);
  }

  if (isAdaptive) {
    settings.effortLevel = normalizeReasoningValue(uiConfig, settings, model, settings.effortLevel);
  }
}

function projectServiceTier(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  providerId: ProviderId,
  resolved: ResolvedProjectionModel,
  currentServiceTier: string | undefined,
): void {
  const savedServiceTier = settings.savedProviderServiceTier as ProviderProjectionMap | undefined;
  const serviceTierToggle = uiConfig.getServiceTierToggle?.({
    ...settings,
    ...(resolved.model ? { model: resolved.model } : {}),
  }) ?? null;

  if (savedServiceTier?.[providerId] !== undefined) {
    settings.serviceTier = savedServiceTier[providerId];
  } else if (resolved.canReuseCurrentProjection && currentServiceTier !== undefined) {
    settings.serviceTier = currentServiceTier;
  } else {
    settings.serviceTier = serviceTierToggle?.inactiveValue ?? 'default';
  }
}

function projectThinkingBudget(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  providerId: ProviderId,
  resolved: ResolvedProjectionModel,
  currentBudget: string | undefined,
): void {
  const { model, isAdaptive, canReuseCurrentProjection } = resolved;
  if (!model || isAdaptive) {
    return;
  }

  const savedBudget = settings.savedProviderThinkingBudget as ProviderProjectionMap | undefined;

  if (savedBudget?.[providerId] !== undefined) {
    settings.thinkingBudget = savedBudget[providerId];
  } else if (canReuseCurrentProjection && currentBudget !== undefined) {
    settings.thinkingBudget = currentBudget;
  } else {
    settings.thinkingBudget = uiConfig.getDefaultReasoningValue(model, settings);
  }
  settings.thinkingBudget = normalizeReasoningValue(uiConfig, settings, model, settings.thinkingBudget);
}

function projectPermissionMode(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  providerId: ProviderId,
  preferCurrent: boolean,
): void {
  const permissionToggle = uiConfig.getPermissionModeToggle?.() ?? null;
  if (!permissionToggle) {
    return;
  }

  const allowedPermissionModes = new Set([
    permissionToggle.inactiveValue,
    permissionToggle.activeValue,
    ...(permissionToggle.planValue ? [permissionToggle.planValue] : []),
  ]);
  const savedPermissionMode = settings.savedProviderPermissionMode as ProviderProjectionMap | undefined;
  const currentPermissionMode = normalizeToggleValue(settings.permissionMode, allowedPermissionModes);
  const savedPermissionModeValue = normalizeToggleValue(
    savedPermissionMode?.[providerId],
    allowedPermissionModes,
  );
  const derivedPermissionMode = normalizeToggleValue(
    uiConfig.resolvePermissionMode?.(settings),
    allowedPermissionModes,
  );

  const projectedPermissionMode = savedPermissionModeValue
    ?? derivedPermissionMode
    ?? (preferCurrent ? currentPermissionMode : undefined)
    ?? currentPermissionMode;

  if (projectedPermissionMode !== undefined) {
    settings.permissionMode = projectedPermissionMode;
  }
}

export class ProviderSettingsCoordinator {
  /**
   * Run every registered provider's load-time settings normalization. Keeps
   * the app-shell settings loader provider-neutral: providers repair their
   * own persisted state behind the reconciler contract instead of the loader
   * importing provider-specific helpers.
   */
  static normalizeOnLoad(settings: Record<string, unknown>): boolean {
    let anyChanged = false;
    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
      if (reconciler.normalizeOnLoad?.(settings)) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }

  /** Record the given provider's last-used model via its own reconciler. */
  static persistProviderLastModel(
    settings: Record<string, unknown>,
    providerId: ProviderId,
    model: string,
  ): void {
    ProviderRegistry.getSettingsReconciler(providerId).persistLastModel?.(settings, model);
  }

  /** Record the given provider's environment hash via its own reconciler. */
  static persistProviderEnvironmentHash(
    settings: Record<string, unknown>,
    providerId: ProviderId,
    hash: string,
  ): void {
    ProviderRegistry.getSettingsReconciler(providerId).persistEnvironmentHash?.(settings, hash);
  }

  static handleEnvironmentChange(
    settings: Record<string, unknown>,
    providerIds: ProviderId[],
  ): boolean {
    let anyChanged = false;
    for (const providerId of providerIds) {
      const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
      if (reconciler.handleEnvironmentChange?.(settings)) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }

  static reconcileTitleGenerationModelSelection(settings: Record<string, unknown>): boolean {
    const currentModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    if (!currentModel) {
      return false;
    }

    const isValid = ProviderRegistry.getRegisteredProviderIds().some((providerId) =>
      ProviderRegistry.getChatUIConfig(providerId)
        .getModelOptions(settings)
        .some((option) => option.value === currentModel)
    );
    if (isValid) {
      return false;
    }

    settings.titleGenerationModel = '';
    return true;
  }

  static normalizeProviderSelection(settings: Record<string, unknown>): boolean {
    const next = getSettingsProviderId(settings);

    if (settings.settingsProvider === next) {
      return false;
    }

    settings.settingsProvider = next;
    return true;
  }

  static getProviderSettingsSnapshot<T extends Record<string, unknown>>(
    settings: T,
    providerId: ProviderId,
  ): T {
    const snapshot = cloneProviderSettings(settings) as T;
    this.projectProviderState(snapshot, providerId);
    return snapshot;
  }

  static commitProviderSettingsSnapshot(
    settings: Record<string, unknown>,
    providerId: ProviderId,
    snapshot: Record<string, unknown>,
  ): void {
    this.persistProjectedProviderState(snapshot, providerId);

    if (providerId === getSettingsProviderId(settings)) {
      Object.assign(settings, snapshot);
      return;
    }

    mergeProviderSettings(settings, snapshot);
  }

  static persistProjectedProviderState(
    settings: Record<string, unknown>,
    providerId: ProviderId = getSettingsProviderId(settings),
  ): void {
    const savedModel = ensureProjectionMap(settings, 'savedProviderModel');
    const savedEffort = ensureProjectionMap(settings, 'savedProviderEffort');
    const savedServiceTier = ensureProjectionMap(settings, 'savedProviderServiceTier');
    const savedBudget = ensureProjectionMap(settings, 'savedProviderThinkingBudget');
    const savedPermissionMode = ensureProjectionMap(settings, 'savedProviderPermissionMode');
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const normalizedModel = normalizeProviderModel(
      uiConfig,
      settings,
      typeof settings.model === 'string' ? settings.model : undefined,
    );
    const projectedSettings = normalizedModel && normalizedModel !== settings.model
      ? { ...settings, model: normalizedModel }
      : settings;

    if (normalizedModel) {
      savedModel[providerId] = normalizedModel;
    }
    if (typeof settings.effortLevel === 'string') {
      savedEffort[providerId] = settings.effortLevel;
    }
    const serviceTierToggle = uiConfig.getServiceTierToggle?.(projectedSettings) ?? null;
    if (serviceTierToggle && typeof settings.serviceTier === 'string') {
      savedServiceTier[providerId] = settings.serviceTier;
    }
    const usesBudget = normalizedModel !== undefined
      && !uiConfig.isAdaptiveReasoningModel(normalizedModel, projectedSettings);
    if (usesBudget && typeof settings.thinkingBudget === 'string') {
      savedBudget[providerId] = settings.thinkingBudget;
    } else {
      delete savedBudget[providerId];
    }
    if (typeof settings.permissionMode === 'string' && uiConfig.getPermissionModeToggle?.()) {
      savedPermissionMode[providerId] = settings.permissionMode;
    }
  }

  static projectProviderState(
    settings: Record<string, unknown>,
    providerId: ProviderId,
  ): void {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const preferCurrent = providerId === getSettingsProviderId(settings);
    const resolved = resolveProjectionModel(uiConfig, settings, providerId, preferCurrent);

    // Capture the current reasoning selections BEFORE applyModelDefaults runs:
    // it overwrites settings.effortLevel (and friends) with the model's
    // defaults, so the project* helpers must restore from these snapshots, not
    // re-read the already-clobbered settings.
    const current: CurrentReasoningSelections = {
      effort: typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined,
      serviceTier: typeof settings.serviceTier === 'string' ? settings.serviceTier : undefined,
      budget: typeof settings.thinkingBudget === 'string' ? settings.thinkingBudget : undefined,
    };

    if (resolved.model) {
      settings.model = resolved.model;
      uiConfig.applyModelDefaults(resolved.model, settings);
    }

    projectEffortLevel(uiConfig, settings, providerId, resolved, current.effort);
    projectServiceTier(uiConfig, settings, providerId, resolved, current.serviceTier);
    projectThinkingBudget(uiConfig, settings, providerId, resolved, current.budget);
    projectPermissionMode(uiConfig, settings, providerId, preferCurrent);
  }

  /** Each provider's reconciler only processes its own conversations. */
  static reconcileAllProviders(
    settings: Record<string, unknown>,
    conversations: Conversation[],
    resolveEnvText?: EnvTextResolver,
  ): SettingsReconciliationResult {
    return this.reconcileProviders(
      settings,
      conversations,
      ProviderRegistry.getRegisteredProviderIds(),
      resolveEnvText,
    );
  }

  static reconcileProviders(
    settings: Record<string, unknown>,
    conversations: Conversation[],
    providerIds: ProviderId[],
    resolveEnvText?: EnvTextResolver,
  ): SettingsReconciliationResult {
    let anyChanged = false;
    const allInvalidated: Conversation[] = [];
    const settingsProvider = getSettingsProviderId(settings);

    for (const providerId of providerIds) {
      const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
      const providerConversations = conversations.filter(c => c.providerId === providerId);
      const targetSettings = providerId === settingsProvider
        ? settings
        : cloneProviderSettings(settings);

      if (providerId !== settingsProvider) {
        this.projectProviderState(targetSettings, providerId);
      }

      const { changed, invalidatedConversations } = reconciler.reconcileModelWithEnvironment(
        targetSettings,
        providerConversations,
        resolveEnvText,
      );

      if (changed) {
        anyChanged = true;
        this.persistProjectedProviderState(targetSettings, providerId);
        if (providerId !== settingsProvider) {
          mergeProviderSettings(settings, targetSettings);
        }
      }
      allInvalidated.push(...invalidatedConversations);
    }

    if (this.reconcileTitleGenerationModelSelection(settings)) {
      anyChanged = true;
    }

    return { changed: anyChanged, invalidatedConversations: allInvalidated };
  }

  static normalizeAllModelVariants(settings: Record<string, unknown>): boolean {
    let anyChanged = false;
    const settingsProvider = getSettingsProviderId(settings);

    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
      const targetSettings = providerId === settingsProvider
        ? settings
        : cloneProviderSettings(settings);

      if (providerId !== settingsProvider) {
        this.projectProviderState(targetSettings, providerId);
      }

      const changed = reconciler.normalizeModelVariantSettings(targetSettings);
      if (changed) {
        anyChanged = true;
        this.persistProjectedProviderState(targetSettings, providerId);
        if (providerId !== settingsProvider) {
          mergeProviderSettings(settings, targetSettings);
        }
      }
    }

    if (this.reconcileTitleGenerationModelSelection(settings)) {
      anyChanged = true;
    }
    return anyChanged;
  }

  /**
   * Project the settings provider's saved values into the top-level
   * model/effortLevel/thinkingBudget fields.
   */
  static projectActiveProviderState(settings: Record<string, unknown>): void {
    this.projectProviderState(settings, getSettingsProviderId(settings));
  }
}
