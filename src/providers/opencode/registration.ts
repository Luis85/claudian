import type { ProviderRegistration } from '../../core/providers/types';
import { OpencodeInlineEditService } from './auxiliary/OpencodeInlineEditService';
import { OpencodeInstructionRefineService } from './auxiliary/OpencodeInstructionRefineService';
import { OpencodeTitleGenerationService } from './auxiliary/OpencodeTitleGenerationService';
import { OPENCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';
import { OPENCODE_CANONICAL_TOOL_NAMES } from './normalization/opencodeToolNormalization';
import { OpencodeChatRuntime } from './runtime/OpencodeChatRuntime';
import { DEFAULT_OPENCODE_PROVIDER_SETTINGS, getOpencodeProviderSettings } from './settings';
import { serializeOpencodeAgentMarkdown } from './storage/OpencodeAgentStorage';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

export const opencodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 10,
  canonicalToolNames: OPENCODE_CANONICAL_TOOL_NAMES,
  defaultConfig: { ...DEFAULT_OPENCODE_PROVIDER_SETTINGS },
  capabilities: OPENCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: opencodeChatUIConfig,
  createInlineEditService: (plugin) => new OpencodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new OpencodeInstructionRefineService(plugin),
  createRuntime: ({ plugin, host }) => new OpencodeChatRuntime(plugin, host),
  createTitleGenerationService: (plugin) => new OpencodeTitleGenerationService(plugin),
  displayName: 'OpenCode',
  firstRunBlurb: 'Opencode CLI server',
  cliCommand: 'opencode',
  environmentKeyPatterns: [/^OPENCODE_/i],
  historyService: new OpencodeConversationHistoryService(),
  isEnabled: (settings) => getOpencodeProviderSettings(settings).enabled,
  settingsReconciler: opencodeSettingsReconciler,
  projectRosterAgent: (input, slug) => ({
    path: `.opencode/agent/${slug}.md`,
    // `mode: subagent` is what makes Opencode treat it as @-mentionable.
    content: serializeOpencodeAgentMarkdown({
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      mode: 'subagent',
      color: input.color,
    }),
  }),
};
