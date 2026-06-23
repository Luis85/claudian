import { Notice } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type { TaskPriority, TaskStatus } from '../model/taskTypes';
import {
  buildTemplateVars,
  type ProviderModelValidators,
  renderWorkOrderBody,
  resolvePriority,
  resolveProviderModel,
} from '../templates/templateResolution';
import type { WorkOrderTemplate } from '../templates/templateTypes';

export interface ResolvedRunTarget {
  provider: string;
  model: string;
  priority: TaskPriority;
}

/** Build the provider/model validators backed by the live registry + settings. */
function registryValidators(settings: Record<string, unknown>): ProviderModelValidators {
  const isRegistered = (id: string): boolean =>
    ProviderRegistry.getRegisteredProviderIds().includes(id as ProviderId);
  return {
    isValidProvider: (id) => isRegistered(id) && ProviderRegistry.isEnabled(id as ProviderId, settings),
    ownsModel: (id, candidate) =>
      isRegistered(id) && ProviderRegistry.getChatUIConfig(id as ProviderId).ownsModel(candidate, settings),
  };
}

/**
 * Resolve the provider, model, and priority for a new work order. When a
 * template is supplied its provider/model preference is reconciled against the
 * live registry (surfacing any fallback warnings as Notices); otherwise the
 * board defaults stand. Returns `null` — after surfacing a Notice — when no
 * provider or model can be resolved, mirroring the original inline guards.
 */
export function resolveRunTarget(
  settings: Record<string, unknown>,
  defaults: { provider: string; model: string },
  template: WorkOrderTemplate | undefined,
): ResolvedRunTarget | null {
  let provider = defaults.provider;
  let model = defaults.model;
  let priority: TaskPriority = '2 - normal';

  if (template) {
    const resolved = resolveProviderModel(template, defaults, registryValidators(settings));
    provider = resolved.provider;
    model = resolved.model;
    priority = resolvePriority(template);
    for (const warning of resolved.warnings) {
      new Notice(warning);
    }
  }

  if (!provider) {
    new Notice(t('tasks.run.needsProvider'));
    return null;
  }
  if (!model) {
    new Notice(t('tasks.run.needsModel'));
    return null;
  }

  return { provider, model, priority };
}

export interface WorkOrderMarkdownContext {
  id: string;
  title: string;
  status: TaskStatus;
  timestamp: string;
  isoDate: string;
  conversationId: string | null;
  sourcePath: string | null;
  sourceFolderPath: string | null;
  objective?: string;
  contextMarkdown?: string;
}

export interface WorkOrderMarkdownBuilders {
  fromTemplate(args: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    timestamp: string;
    provider: string;
    model: string;
    conversationId: string | null;
    body: string;
    loop?: string;
  }): string;
  fromSeed(args: {
    id: string;
    title: string;
    provider: string;
    model: string;
    timestamp: string;
    status: TaskStatus;
    sourcePath: string | null;
    sourceFolderPath: string | null;
    objective?: string;
    contextMarkdown?: string;
    conversationId: string | null;
  }): string;
}

/**
 * Produce the work-order markdown for a new note. With a template the body is
 * rendered through the placeholder engine first; unknown-placeholder errors
 * surface a Notice and yield `null` so the caller aborts creation, matching the
 * original inline behavior. Builders are injected so the markdown templating and
 * the test-only export surface stay owned by `taskCommands.ts`.
 */
export function buildWorkOrderMarkdownForSeed(
  ctx: WorkOrderMarkdownContext,
  target: ResolvedRunTarget,
  template: WorkOrderTemplate | undefined,
  builders: WorkOrderMarkdownBuilders,
): string | null {
  if (!template) {
    return builders.fromSeed({
      id: ctx.id,
      title: ctx.title,
      provider: target.provider,
      model: target.model,
      timestamp: ctx.timestamp,
      status: ctx.status,
      sourcePath: ctx.sourcePath,
      sourceFolderPath: ctx.sourceFolderPath,
      objective: ctx.objective,
      contextMarkdown: ctx.contextMarkdown,
      conversationId: ctx.conversationId,
    });
  }

  const vars = buildTemplateVars({
    title: ctx.title,
    date: ctx.isoDate,
    sourcePath: ctx.sourcePath,
    sourceFolderPath: ctx.sourceFolderPath,
  });
  const rendered = renderWorkOrderBody(template, vars);
  if (rendered.errors.length > 0) {
    new Notice(t('tasks.run.templateProblems', { name: template.name, errors: rendered.errors.join('; ') }));
    return null;
  }
  return builders.fromTemplate({
    id: ctx.id,
    title: ctx.title,
    status: ctx.status,
    priority: target.priority,
    timestamp: ctx.timestamp,
    provider: target.provider,
    model: target.model,
    conversationId: ctx.conversationId,
    body: rendered.body,
    loop: template.loop,
  });
}
