import type { ProviderRegistration } from '../../core/providers/types';
import { CursorInlineEditService } from './auxiliary/CursorInlineEditService';
import { CursorInstructionRefineService } from './auxiliary/CursorInstructionRefineService';
import { CursorTitleGenerationService } from './auxiliary/CursorTitleGenerationService';
import { CURSOR_PROVIDER_CAPABILITIES } from './capabilities';
import { cursorSettingsReconciler } from './env/CursorSettingsReconciler';
import { CursorConversationHistoryService } from './history/CursorConversationHistoryService';
import { CursorChatRuntime } from './runtime/CursorChatRuntime';
import { CursorTaskResultInterpreter } from './runtime/CursorTaskResultInterpreter';
import { CURSOR_CANONICAL_TOOL_NAMES } from './runtime/cursorToolNormalization';
import { DEFAULT_CURSOR_PROVIDER_SETTINGS, getCursorProviderSettings } from './settings';
import { serializeCursorAgentMarkdown } from './storage/CursorAgentStorage';
import { cursorChatUIConfig } from './ui/CursorChatUIConfig';

export const cursorProviderRegistration: ProviderRegistration = {
  displayName: 'Cursor Agent',
  firstRunBlurb: 'Cursor Agent CLI',
  cliCommand: 'cursor-agent',
  blankTabOrder: 8,
  isEnabled: (settings) => getCursorProviderSettings(settings).enabled,
  defaultConfig: { ...DEFAULT_CURSOR_PROVIDER_SETTINGS },
  capabilities: CURSOR_PROVIDER_CAPABILITIES,
  canonicalToolNames: CURSOR_CANONICAL_TOOL_NAMES,
  environmentKeyPatterns: [/^CURSOR_/i],
  chatUIConfig: cursorChatUIConfig,
  settingsReconciler: cursorSettingsReconciler,
  createRuntime: ({ plugin, host }) => new CursorChatRuntime(plugin, host),
  createTitleGenerationService: (plugin) => new CursorTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new CursorInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new CursorInlineEditService(plugin),
  historyService: new CursorConversationHistoryService(),
  taskResultInterpreter: new CursorTaskResultInterpreter(),
  projectRosterAgent: (input, slug) => ({
    path: `.cursor/agents/${slug}.md`,
    content: serializeCursorAgentMarkdown({
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      source: 'vault',
    }),
  }),
};
