import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type ClaudianSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

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
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',
  firstRunDismissed: false,

  agentBoardWorkOrderFolder: 'Agent Board/tasks',
  agentBoardTemplateFolder: 'Agent Board/templates',
  agentBoardArchiveFolder: 'Agent Board/archive',
  agentBoardDefaultProvider: null,
  agentBoardDefaultModel: null,

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),

  orchestratorEnabled: true,
  orchestratorSystemPrompt: '',
  quickActionsFolder: 'Quick Actions',
  loggingEnabled: false,
  logLevel: 'warn',
};
