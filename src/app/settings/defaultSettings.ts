import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { type ClaudianSettings } from '../../core/types/settings';

export const DEFAULT_CLAUDIAN_SETTINGS: ClaudianSettings = {
  userName: '',

  // SECURITY (SEC-1): Default to a prompting mode so tools require approval out of
  // the box. 'yolo' (SDK bypassPermissions) stays an explicit opt-in surfaced
  // through the toolbar toggle, guarded by a one-time warning.
  permissionMode: 'normal',
  yoloModeWarningShown: false,
  trustedVaults: {},

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  secretEnvVars: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  // ARCH-2: providers contribute their default config at registration time;
  // the registry assembles them here. Resolved lazily (via a getter) so this
  // module no longer statically imports each provider's settings module — that
  // static barrel was the root of the `core -> app -> all-providers -> core`
  // cycle class. Spread/access of DEFAULT_CLAUDIAN_SETTINGS happens at runtime,
  // after the built-in providers have registered.
  get providerConfigs() {
    return ProviderRegistry.getDefaultProviderConfigs();
  },

  settingsProvider: 'claude',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',

  maxChatTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  showAgentEditedFiles: true,
  chatViewPlacement: 'right-sidebar',
  firstRunDismissed: false,
  promptCommitOnAccept: true,

  agentBoardWorkOrderFolder: 'Agent Board/tasks',
  agentBoardTemplateFolder: 'Agent Board/templates',
  agentBoardArchiveFolder: 'Agent Board/archive',
  agentBoardDefaultProvider: null,
  agentBoardDefaultModel: null,
  agentBoardQueueCap: 1,
  agentBoardQueueHaltAfter: 3,

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),

  quickActionsFolder: 'Quick Actions',
  loggingEnabled: false,
  logLevel: 'warn',
};
