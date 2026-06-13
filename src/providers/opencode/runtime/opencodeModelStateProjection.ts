import {
  sameDiscoveredModels,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '../internal/compareCollections';
import type { OpencodeDiscoveredModel, OpencodeModelVariant } from '../models';
import type { OpencodeProviderSettings } from '../settings';

export interface OpencodeModelStateInputs {
  currentSettings: OpencodeProviderSettings;
  currentBaseRawModelId: string | null;
  currentThinkingLevel: string | null;
  currentThinkingOptions: OpencodeModelVariant[];
  currentThinkingOptionValues: Set<string>;
  discoveredModels: OpencodeDiscoveredModel[];
}

export interface OpencodeModelStateProjection {
  nextPreferredThinkingByModel: Record<string, string>;
  nextThinkingOptionsByModel: OpencodeProviderSettings['thinkingOptionsByModel'];
  nextVisibleModels: string[];
  shouldSeedPreferredThinking: boolean;
  shouldSeedVisibleModels: boolean;
  shouldUpdateDiscoveredModels: boolean;
  shouldUpdateThinkingOptions: boolean;
}

function projectThinkingOptionsByModel(inputs: OpencodeModelStateInputs): OpencodeProviderSettings['thinkingOptionsByModel'] {
  const { currentSettings, currentBaseRawModelId, currentThinkingOptions } = inputs;
  const next = { ...currentSettings.thinkingOptionsByModel };
  if (!currentBaseRawModelId) {
    return next;
  }

  if (currentThinkingOptions.length > 0) {
    next[currentBaseRawModelId] = currentThinkingOptions;
  } else {
    delete next[currentBaseRawModelId];
  }
  return next;
}

function shouldSeedThinkingLevel(inputs: OpencodeModelStateInputs): boolean {
  const {
    currentSettings,
    currentBaseRawModelId,
    currentThinkingLevel,
    currentThinkingOptions,
    currentThinkingOptionValues,
  } = inputs;
  if (!currentBaseRawModelId || !currentThinkingLevel) {
    return false;
  }

  const currentPreferred = currentSettings.preferredThinkingByModel[currentBaseRawModelId];
  if (!currentPreferred) {
    return true;
  }

  return currentThinkingOptions.length > 0 && !currentThinkingOptionValues.has(currentPreferred);
}

function projectPreferredThinkingByModel(inputs: OpencodeModelStateInputs): Record<string, string> {
  const { currentSettings, currentBaseRawModelId, currentThinkingLevel } = inputs;
  if (!shouldSeedThinkingLevel(inputs) || !currentBaseRawModelId || !currentThinkingLevel) {
    return currentSettings.preferredThinkingByModel;
  }

  return {
    ...currentSettings.preferredThinkingByModel,
    [currentBaseRawModelId]: currentThinkingLevel,
  };
}

export function projectOpencodeModelState(
  inputs: OpencodeModelStateInputs,
): OpencodeModelStateProjection {
  const { currentSettings, currentBaseRawModelId, discoveredModels } = inputs;

  const nextThinkingOptionsByModel = projectThinkingOptionsByModel(inputs);
  const nextVisibleModels = currentSettings.visibleModels.length === 0 && currentBaseRawModelId
    ? [currentBaseRawModelId]
    : currentSettings.visibleModels;
  const nextPreferredThinkingByModel = projectPreferredThinkingByModel(inputs);

  return {
    nextPreferredThinkingByModel,
    nextThinkingOptionsByModel,
    nextVisibleModels,
    shouldSeedPreferredThinking: !sameStringMap(
      currentSettings.preferredThinkingByModel,
      nextPreferredThinkingByModel,
    ),
    shouldSeedVisibleModels: !sameStringList(currentSettings.visibleModels, nextVisibleModels),
    shouldUpdateDiscoveredModels: discoveredModels.length > 0
      && !sameDiscoveredModels(currentSettings.discoveredModels, discoveredModels),
    shouldUpdateThinkingOptions: !sameThinkingOptionsByModel(
      currentSettings.thinkingOptionsByModel,
      nextThinkingOptionsByModel,
    ),
  };
}
