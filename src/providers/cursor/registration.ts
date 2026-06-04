import type {
  ProviderConversationHistoryService,
  ProviderRegistration,
} from '../../core/providers/types';
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
import { cursorChatUIConfig } from './ui/CursorChatUIConfig';

export const cursorProviderRegistration: ProviderRegistration = {
  displayName: 'Cursor Agent',
  blankTabOrder: 8,
  isEnabled: (settings) => getCursorProviderSettings(settings).enabled,
  defaultConfig: { ...DEFAULT_CURSOR_PROVIDER_SETTINGS },
  capabilities: CURSOR_PROVIDER_CAPABILITIES,
  canonicalToolNames: CURSOR_CANONICAL_TOOL_NAMES,
  environmentKeyPatterns: [/^CURSOR_/i],
  chatUIConfig: cursorChatUIConfig,
  settingsReconciler: cursorSettingsReconciler,
  createRuntime: ({ plugin }) => new CursorChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new CursorTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new CursorInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new CursorInlineEditService(plugin),
  // The typed subclass narrows TPersistedState to CursorProviderState; the
  // registration field uses the default-instantiated interface. The shape is
  // structurally compatible (chatSessionId: string | undefined) but lacks the
  // index signature that Record<string, unknown> demands.
  historyService: new CursorConversationHistoryService() as unknown as ProviderConversationHistoryService,
  taskResultInterpreter: new CursorTaskResultInterpreter(),
};
