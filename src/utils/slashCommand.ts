import type { SlashCommand } from '../core/types';
import type { TranslationKey, ValidationError } from '../i18n/types';
import {
  extractBoolean,
  extractString,
  extractStringArray,
  isRecord,
  parseFrontmatter,
  type SlugValidationRule,
  validateSlugName,
} from './frontmatter';

export interface ParsedSlashCommandContent {
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  promptContent: string;
  // Skill fields
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
}

export function extractFirstParagraph(content: string): string | undefined {
  const paragraph = content.split(/\n\s*\n/).find(p => p.trim());
  if (!paragraph) return undefined;
  return paragraph.trim().replace(/\n/g, ' ');
}

const COMMAND_NAME_VALIDATION_KEYS: Record<SlugValidationRule, TranslationKey> = {
  required: 'settings.slashCommands.validation.required',
  tooLong: 'settings.slashCommands.validation.tooLong',
  invalidChars: 'settings.slashCommands.validation.invalidChars',
  yamlReserved: 'settings.slashCommands.validation.yamlReserved',
};

export function validateCommandName(name: string): ValidationError | null {
  const result = validateSlugName(name);
  if (!result) return null;
  return {
    key: COMMAND_NAME_VALIDATION_KEYS[result.rule],
    params: result.params,
  };
}

export function isSkill(cmd: SlashCommand): boolean {
  if (cmd.kind) return cmd.kind === 'skill';
  return cmd.id.startsWith('skill-');
}

export function parsedToSlashCommand(
  parsed: ParsedSlashCommandContent,
  identity: Pick<SlashCommand, 'id' | 'name'> & { source?: SlashCommand['source'] },
): SlashCommand {
  return {
    ...identity,
    description: parsed.description,
    argumentHint: parsed.argumentHint,
    allowedTools: parsed.allowedTools,
    model: parsed.model,
    content: parsed.promptContent,
    disableModelInvocation: parsed.disableModelInvocation,
    userInvocable: parsed.userInvocable,
    context: parsed.context,
    agent: parsed.agent,
    hooks: parsed.hooks,
  };
}

export function parseSlashCommandContent(content: string): ParsedSlashCommandContent {
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    return { promptContent: content };
  }

  const fm = parsed.frontmatter;

  return {
    // Existing fields — support both kebab-case (file format) and camelCase
    description: extractString(fm, 'description'),
    argumentHint: extractString(fm, 'argument-hint') ?? extractString(fm, 'argumentHint'),
    allowedTools: extractStringArray(fm, 'allowed-tools') ?? extractStringArray(fm, 'allowedTools'),
    model: extractString(fm, 'model'),
    promptContent: parsed.body,
    // Skill fields — kebab-case preferred (CC file format), camelCase for backwards compat
    disableModelInvocation:
      extractBoolean(fm, 'disable-model-invocation') ?? extractBoolean(fm, 'disableModelInvocation'),
    userInvocable:
      extractBoolean(fm, 'user-invocable') ?? extractBoolean(fm, 'userInvocable'),
    context: extractString(fm, 'context') === 'fork' ? 'fork' : undefined,
    agent: extractString(fm, 'agent'),
    hooks: isRecord(fm.hooks) ? fm.hooks : undefined,
  };
}

export function normalizeArgumentHint(hint: string): string {
  if (!hint) return hint;
  if (hint.includes('[') || hint.includes('<')) return hint;
  return `[${hint}]`;
}

// YAML scalar tokens a reader decodes as boolean/null rather than text, so a
// string equal to one of these must be quoted to round-trip unchanged.
const YAML_RESERVED_SCALAR = /^(?:true|false|null|yes|no|on|off|~)$/i;
// Integer/float literals (optionally signed, with exponent) are likewise decoded
// as numbers unless quoted.
const YAML_NUMERIC_SCALAR = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
// A leading YAML indicator character makes a plain scalar invalid or changes its
// meaning (e.g. `@reviewer`, `!tag`, `&anchor`, `*alias`, `[`, `{`), so a value
// starting with one must be quoted. `:`/`#` anywhere are handled below; `-`/`?`
// only act as indicators when followed by a space.
const YAML_LEADING_INDICATOR = /^[!&*{}[\],|>@`"'%]/;

export function yamlString(value: string): string {
  if (value.includes(':') || value.includes('#') || value.includes('\n') ||
      value.startsWith(' ') || value.endsWith(' ') ||
      value.startsWith('- ') || value.startsWith('? ') ||
      YAML_LEADING_INDICATOR.test(value) ||
      YAML_RESERVED_SCALAR.test(value) || YAML_NUMERIC_SCALAR.test(value)) {
    // Double-quoted YAML scalars decode backslash escapes (\t, \n, ...), so
    // escape backslashes first (before quotes, whose escape adds its own
    // backslash) or a value like `C:\temp` would round-trip corrupted.
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Serialize an arbitrary frontmatter value to a single-line YAML literal. */
export function serializeFrontmatterValue(value: unknown): string {
  if (typeof value === 'string') return yamlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value);
}

/** Append extra (unknown) frontmatter key/value pairs as YAML lines. */
export function serializeExtraFrontmatter(
  lines: string[],
  extra: Record<string, unknown> | undefined,
): void {
  if (!extra) return;
  for (const [key, value] of Object.entries(extra)) {
    lines.push(`${key}: ${serializeFrontmatterValue(value)}`);
  }
}

export function serializeCommand(cmd: SlashCommand): string {
  const parsed = parseSlashCommandContent(cmd.content);
  return serializeSlashCommandMarkdown(cmd, parsed.promptContent);
}

export function serializeSlashCommandMarkdown(cmd: Partial<SlashCommand>, body: string): string {
  const lines: string[] = ['---'];

  if (cmd.name) {
    lines.push(`name: ${cmd.name}`);
  }
  if (cmd.description) {
    lines.push(`description: ${yamlString(cmd.description)}`);
  }
  if (cmd.argumentHint) {
    lines.push(`argument-hint: ${yamlString(cmd.argumentHint)}`);
  }
  if (cmd.allowedTools && cmd.allowedTools.length > 0) {
    lines.push('allowed-tools:');
    for (const tool of cmd.allowedTools) {
      lines.push(`  - ${yamlString(tool)}`);
    }
  }
  if (cmd.model) {
    lines.push(`model: ${cmd.model}`);
  }
  if (cmd.disableModelInvocation !== undefined) {
    lines.push(`disable-model-invocation: ${cmd.disableModelInvocation}`);
  }
  if (cmd.userInvocable !== undefined) {
    lines.push(`user-invocable: ${cmd.userInvocable}`);
  }
  if (cmd.context) {
    lines.push(`context: ${cmd.context}`);
  }
  if (cmd.agent) {
    lines.push(`agent: ${cmd.agent}`);
  }
  if (cmd.hooks !== undefined) {
    lines.push(`hooks: ${JSON.stringify(cmd.hooks)}`);
  }
  // Ensure at least one blank line between --- markers when no metadata exists
  // (the frontmatter regex requires \n before the closing ---)
  if (lines.length === 1) {
    lines.push('');
  }

  lines.push('---');
  lines.push(body);

  return lines.join('\n');
}
