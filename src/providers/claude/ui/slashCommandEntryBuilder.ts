import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { normalizeArgumentHint, parseSlashCommandContent } from '../../../utils/slashCommand';

export type SlashCommandType = 'command' | 'skill';

/** Live references and mutable flag state for the modal form fields. */
export interface SlashCommandFormState {
  selectedType: SlashCommandType;
  nameInput: HTMLInputElement;
  descInput: HTMLInputElement;
  hintInput: HTMLInputElement;
  modelInput: HTMLInputElement;
  toolsInput: HTMLInputElement;
  agentInput: HTMLInputElement;
  contentArea: HTMLTextAreaElement;
  disableModelToggle: boolean;
  disableUserInvocation: boolean;
  contextValue: 'fork' | '';
}

export function isSkillEntry(entry: ProviderCommandEntry): boolean {
  return entry.kind === 'skill';
}

function resolveAllowedTools(inputValue: string, parsedTools?: string[]): string[] | undefined {
  const trimmed = inputValue.trim();
  if (trimmed) {
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (parsedTools && parsedTools.length > 0) {
    return parsedTools;
  }
  return undefined;
}

export function shouldOpenAdvanced(entry: ProviderCommandEntry | null): boolean {
  if (!entry) return false;
  const signals: unknown[] = [
    entry.argumentHint,
    entry.model,
    entry.allowedTools?.length,
    entry.disableModelInvocation,
    entry.userInvocable === false ? true : undefined,
    entry.context,
    entry.agent,
  ];
  return signals.some(Boolean);
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value) return value;
  }
  return undefined;
}

function resolveEntryId(
  existingEntry: ProviderCommandEntry | null,
  isSkillType: boolean,
  name: string,
): string {
  if (existingEntry?.id) return existingEntry.id;
  if (isSkillType) return `skill-${name}`;
  return `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function resolveAgent(state: SlashCommandFormState): string | undefined {
  if (state.contextValue !== 'fork') return undefined;
  return state.agentInput.value.trim() || undefined;
}

interface CommandEntryFlags {
  disableModelInvocation?: true;
  userInvocable?: false;
  context?: 'fork';
}

/** Optional flag fields whose presence depends on toggle/context state. */
function resolveCommandFlags(state: SlashCommandFormState): CommandEntryFlags {
  const flags: CommandEntryFlags = {};
  if (state.disableModelToggle) flags.disableModelInvocation = true;
  if (state.disableUserInvocation) flags.userInvocable = false;
  if (state.contextValue) flags.context = state.contextValue;
  return flags;
}

export function buildCommandEntry(
  state: SlashCommandFormState,
  existingEntry: ProviderCommandEntry | null,
): ProviderCommandEntry {
  const name = state.nameInput.value.trim();
  const parsed = parseSlashCommandContent(state.contentArea.value);
  const isSkillType = state.selectedType === 'skill';

  return {
    id: resolveEntryId(existingEntry, isSkillType, name),
    providerId: 'claude',
    kind: isSkillType ? 'skill' : 'command',
    name,
    description: firstNonEmpty(state.descInput.value.trim(), parsed.description),
    argumentHint: firstNonEmpty(normalizeArgumentHint(state.hintInput.value.trim()), parsed.argumentHint),
    allowedTools: resolveAllowedTools(state.toolsInput.value, parsed.allowedTools),
    model: firstNonEmpty(state.modelInput.value.trim(), parsed.model),
    content: parsed.promptContent,
    ...resolveCommandFlags(state),
    agent: resolveAgent(state),
    hooks: parsed.hooks ?? existingEntry?.hooks,
    scope: 'vault',
    source: existingEntry?.source ?? 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    persistenceKey: existingEntry?.persistenceKey,
  };
}
