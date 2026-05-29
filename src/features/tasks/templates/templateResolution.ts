import type { TaskPriority } from '../model/taskTypes';
import { ALLOWED_TEMPLATE_PLACEHOLDERS, type TemplateChoice, type TemplateVars, type WorkOrderTemplate } from './templateTypes';

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;
const VALID_PRIORITIES: ReadonlySet<TaskPriority> = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

export function findUnknownPlaceholders(body: string): string[] {
  const allowed = new Set<string>(ALLOWED_TEMPLATE_PLACEHOLDERS);
  const unknown: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (!allowed.has(name) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return unknown;
}

export function renderWorkOrderBody(
  template: WorkOrderTemplate,
  vars: TemplateVars,
): { body: string; errors: string[] } {
  const unknown = findUnknownPlaceholders(template.body);
  if (unknown.length > 0) {
    return { body: template.body, errors: unknown.map((name) => `Unknown placeholder {{${name}}}`) };
  }
  const body = template.body.replace(PLACEHOLDER_PATTERN, (_full, name: string) => {
    if (name === 'title') return vars.title;
    if (name === 'date') return vars.date;
    if (name === 'source') return vars.source;
    return '';
  });
  return { body, errors: [] };
}

export interface ProviderModelValidators {
  isValidProvider(providerId: string): boolean;
  ownsModel(providerId: string, model: string): boolean;
}

export function resolveProviderModel(
  template: Pick<WorkOrderTemplate, 'provider' | 'model'> | undefined,
  defaults: { provider: string; model: string },
  validators: ProviderModelValidators,
): { provider: string; model: string; warnings: string[] } {
  const warnings: string[] = [];

  let provider = defaults.provider;
  if (template?.provider) {
    if (validators.isValidProvider(template.provider)) {
      provider = template.provider;
    } else {
      warnings.push(`Template provider "${template.provider}" is not enabled; using the default provider.`);
    }
  }

  let model = provider === defaults.provider ? defaults.model : '';
  if (template?.model) {
    if (validators.ownsModel(provider, template.model)) {
      model = template.model;
    } else {
      warnings.push(`Template model "${template.model}" is not valid for ${provider}; using the default model.`);
    }
  }

  return { provider, model, warnings };
}

export function resolvePriority(template: Pick<WorkOrderTemplate, 'priority'> | undefined): TaskPriority {
  const priority = template?.priority;
  return priority && VALID_PRIORITIES.has(priority) ? priority : 'normal';
}

export function buildTemplateVars(args: {
  title: string;
  date: string;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
}): TemplateVars {
  let source = '';
  if (args.sourcePath) {
    source = `[[${args.sourcePath.replace(/\.md$/i, '')}]]`;
  } else if (args.sourceFolderPath) {
    source = `\`${args.sourceFolderPath}\``;
  }
  return { title: args.title, date: args.date, source };
}

export function buildTemplateChoices(templates: WorkOrderTemplate[]): TemplateChoice[] {
  return [{ kind: 'blank' }, ...templates.map((template): TemplateChoice => ({ kind: 'template', template }))];
}
