import type {
  ProviderConversationHistoryService,
  ProviderRegistration,
} from '../../core/providers/types';
import { CodexInlineEditService } from './auxiliary/CodexInlineEditService';
import { CodexInstructionRefineService } from './auxiliary/CodexInstructionRefineService';
import { CodexTitleGenerationService } from './auxiliary/CodexTitleGenerationService';
import { CODEX_PROVIDER_CAPABILITIES } from './capabilities';
import { codexSettingsReconciler } from './env/CodexSettingsReconciler';
import { CodexConversationHistoryService } from './history/CodexConversationHistoryService';
import { codexSubagentLifecycleAdapter } from './normalization/codexSubagentNormalization';
import { CODEX_CANONICAL_TOOL_NAMES } from './normalization/codexToolNormalization';
import { CodexChatRuntime } from './runtime/CodexChatRuntime';
import { DEFAULT_CODEX_PROVIDER_SETTINGS, getCodexProviderSettings } from './settings';
import { codexChatUIConfig } from './ui/CodexChatUIConfig';

export const codexProviderRegistration: ProviderRegistration = {
  displayName: 'Codex',
  blankTabOrder: 15,
  isEnabled: (settings) => getCodexProviderSettings(settings).enabled,
  defaultConfig: { ...DEFAULT_CODEX_PROVIDER_SETTINGS },
  capabilities: CODEX_PROVIDER_CAPABILITIES,
  canonicalToolNames: CODEX_CANONICAL_TOOL_NAMES,
  environmentKeyPatterns: [/^OPENAI_/i, /^CODEX_/i],
  chatUIConfig: codexChatUIConfig,
  settingsReconciler: codexSettingsReconciler,
  createRuntime: ({ plugin }) => new CodexChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new CodexTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new CodexInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new CodexInlineEditService(plugin),
  // The typed subclass narrows TPersistedState to CodexProviderState; the
  // registration field uses the default-instantiated interface. The shape is
  // structurally compatible but lacks the index signature that
  // Record<string, unknown> demands.
  historyService: new CodexConversationHistoryService() as unknown as ProviderConversationHistoryService,
  subagentLifecycleAdapter: codexSubagentLifecycleAdapter,
};
