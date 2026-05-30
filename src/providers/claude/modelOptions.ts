import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import { getModelsFromEnvironment } from './env/claudeModelEnv';
import { formatCustomModelLabel } from './modelLabels';
import { getClaudeProviderSettings } from './settings';
import { DEFAULT_CLAUDE_MODELS, filterVisibleModelOptions } from './types/models';

function normalizeCustomModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const aliases: Record<string, string> = {};
  for (const [rawModelId, rawAlias] of Object.entries(value)) {
    if (typeof rawAlias !== 'string') {
      continue;
    }

    const modelId = rawModelId.trim();
    const alias = rawAlias.trim();
    if (modelId && alias) {
      aliases[modelId] = alias;
    }
  }

  return aliases;
}

export function getClaudeModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const customModelAliases = normalizeCustomModelAliases(settings.customModelAliases);
  const customModels = getModelsFromEnvironment(
    getRuntimeEnvironmentVariables(settings, 'claude'),
    customModelAliases,
  );
  if (customModels.length > 0) {
    return customModels;
  }

  const claudeSettings = getClaudeProviderSettings(settings);
  const models = filterVisibleModelOptions(
    [...DEFAULT_CLAUDE_MODELS],
    claudeSettings.enableOpus1M,
    claudeSettings.enableSonnet1M,
  );

  const seenValues = new Set(models.map(model => model.value));
  for (const row of claudeSettings.customModels) {
    if (seenValues.has(row.id)) {
      continue;
    }

    seenValues.add(row.id);
    models.push({
      value: row.id,
      label: row.label ?? customModelAliases[row.id] ?? formatCustomModelLabel(row.id),
      description: 'Custom model',
    });
  }

  return models;
}

export function resolveClaudeModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const modelOptions = getClaudeModelOptions(settings);
  if (currentModel && modelOptions.some(option => option.value === currentModel)) {
    return currentModel;
  }

  const lastModel = getClaudeProviderSettings(settings).lastModel;
  if (lastModel && modelOptions.some(option => option.value === lastModel)) {
    return lastModel;
  }

  return modelOptions[0]?.value ?? null;
}
