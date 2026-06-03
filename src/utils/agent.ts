import type { AgentDefinition } from '../core/types';
import type { TranslationKey, ValidationError } from '../i18n/types';
import { type SlugValidationRule, validateSlugName } from './frontmatter';
import { yamlString } from './slashCommand';

const AGENT_NAME_VALIDATION_KEYS: Record<SlugValidationRule, TranslationKey> = {
  required: 'settings.subagents.validation.required',
  tooLong: 'settings.subagents.validation.tooLong',
  invalidChars: 'settings.subagents.validation.invalidChars',
  yamlReserved: 'settings.subagents.validation.yamlReserved',
};

export function validateAgentName(name: string): ValidationError | null {
  const result = validateSlugName(name);
  if (!result) return null;
  return {
    key: AGENT_NAME_VALIDATION_KEYS[result.rule],
    params: result.params,
  };
}

function pushYamlList(lines: string[], key: string, items?: string[]): void {
  if (!items || items.length === 0) return;
  lines.push(`${key}:`);
  for (const item of items) {
    lines.push(`  - ${yamlString(item)}`);
  }
}

export function serializeAgent(agent: AgentDefinition): string {
  const lines: string[] = ['---'];

  lines.push(`name: ${agent.name}`);
  lines.push(`description: ${yamlString(agent.description)}`);

  pushYamlList(lines, 'tools', agent.tools);
  pushYamlList(lines, 'disallowedTools', agent.disallowedTools);

  if (agent.model && agent.model !== 'inherit') {
    lines.push(`model: ${agent.model}`);
  }

  if (agent.permissionMode) {
    lines.push(`permissionMode: ${agent.permissionMode}`);
  }

  pushYamlList(lines, 'skills', agent.skills);

  if (agent.hooks !== undefined) {
    lines.push(`hooks: ${JSON.stringify(agent.hooks)}`);
  }

  if (agent.extraFrontmatter) {
    for (const [key, value] of Object.entries(agent.extraFrontmatter)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push('---');
  lines.push(agent.prompt);

  return lines.join('\n');
}
