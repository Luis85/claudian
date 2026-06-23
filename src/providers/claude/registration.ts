import type { ProviderRegistration } from '../../core/providers/types';
import { serializeAgent } from '../../utils/agent';
import { getClaudeWorkspaceServices } from './app/claudeWorkspaceAccess';
import { InlineEditService as ClaudeInlineEditService } from './auxiliary/ClaudeInlineEditService';
import { InstructionRefineService as ClaudeInstructionRefineService } from './auxiliary/ClaudeInstructionRefineService';
import { TitleGenerationService as ClaudeTitleGenerationService } from './auxiliary/ClaudeTitleGenerationService';
import { CLAUDE_CANONICAL_TOOL_NAMES } from './canonicalTools';
import { CLAUDE_PROVIDER_CAPABILITIES } from './capabilities';
import { claudeSettingsReconciler } from './env/ClaudeSettingsReconciler';
import { ClaudeConversationHistoryService } from './history/ClaudeConversationHistoryService';
import { ClaudianService as ClaudeChatRuntime } from './runtime/ClaudeChatRuntime';
import { ClaudeTaskResultInterpreter } from './runtime/ClaudeTaskResultInterpreter';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS, getClaudeProviderSettings } from './settings';
import { claudeChatUIConfig } from './ui/ClaudeChatUIConfig';

export const claudeProviderRegistration: ProviderRegistration = {
  displayName: 'Claude',
  firstRunBlurb: 'Anthropic Claude Code',
  cliCommand: 'claude',
  blankTabOrder: 20,
  isEnabled: (settings) => getClaudeProviderSettings(settings).enabled,
  defaultConfig: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS },
  capabilities: CLAUDE_PROVIDER_CAPABILITIES,
  canonicalToolNames: CLAUDE_CANONICAL_TOOL_NAMES,
  environmentKeyPatterns: [/^ANTHROPIC_/i, /^CLAUDE_/i],
  chatUIConfig: claudeChatUIConfig,
  settingsReconciler: claudeSettingsReconciler,
  createRuntime: ({ plugin, host }) => {
    const workspace = getClaudeWorkspaceServices();
    const resolvedMcpManager = workspace?.mcpManager;
    if (!resolvedMcpManager) {
      throw new Error('Claude workspace services are not initialized.');
    }

    return new ClaudeChatRuntime(plugin, {
      mcpManager: resolvedMcpManager,
      pluginManager: workspace?.pluginManager,
      agentManager: workspace?.agentManager,
    }, host);
  },
  createTitleGenerationService: (plugin) => new ClaudeTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new ClaudeInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new ClaudeInlineEditService(plugin),
  historyService: new ClaudeConversationHistoryService(),
  taskResultInterpreter: new ClaudeTaskResultInterpreter(),
  projectRosterAgent: (input, slug) => ({
    path: `.claude/agents/${slug}.md`,
    content: serializeAgent({
      id: `roster-${slug}`,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      skills: input.skills && input.skills.length > 0 ? input.skills : undefined,
      source: 'vault',
    }),
  }),
};
