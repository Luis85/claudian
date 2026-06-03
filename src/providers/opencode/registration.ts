import type {
  ProviderConversationHistoryService,
  ProviderRegistration,
} from '../../core/providers/types';
import { OpencodeInlineEditService } from './auxiliary/OpencodeInlineEditService';
import { OpencodeInstructionRefineService } from './auxiliary/OpencodeInstructionRefineService';
import { OpencodeTitleGenerationService } from './auxiliary/OpencodeTitleGenerationService';
import { OPENCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';
import { OPENCODE_CANONICAL_TOOL_NAMES } from './normalization/opencodeToolNormalization';
import { OpencodeChatRuntime } from './runtime/OpencodeChatRuntime';
import { DEFAULT_OPENCODE_PROVIDER_SETTINGS, getOpencodeProviderSettings } from './settings';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

export const opencodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 10,
  canonicalToolNames: OPENCODE_CANONICAL_TOOL_NAMES,
  defaultConfig: { ...DEFAULT_OPENCODE_PROVIDER_SETTINGS },
  capabilities: OPENCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: opencodeChatUIConfig,
  createInlineEditService: (plugin) => new OpencodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new OpencodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new OpencodeChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new OpencodeTitleGenerationService(plugin),
  displayName: 'OpenCode',
  environmentKeyPatterns: [/^OPENCODE_/i],
  // The typed subclass narrows TPersistedState to OpencodeProviderState; the
  // registration field uses the default-instantiated interface. The shape is
  // structurally compatible (databasePath: string | undefined) but lacks the
  // index signature that Record<string, unknown> demands.
  historyService: new OpencodeConversationHistoryService() as unknown as ProviderConversationHistoryService,
  isEnabled: (settings) => getOpencodeProviderSettings(settings).enabled,
  settingsReconciler: opencodeSettingsReconciler,
};
