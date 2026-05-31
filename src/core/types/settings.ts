import type { LogLevel } from '../logging/types';
import type { ProviderId } from './provider';

export type HiddenProviderCommands = Record<string, string[]>;

export interface ApprovalSelectionDecision {
  type: 'select-option';
  value: string;
}

/** User decision from the approval modal. */
export type ApprovalDecision =
  | 'allow'
  | 'allow-always'
  | 'deny'
  | 'cancel'
  | ApprovalSelectionDecision;

/** Saved environment variable configuration. */
export interface EnvSnippet {
  id: string;
  name: string;
  description: string;
  envVars: string;
  scope?: EnvironmentScope;
  contextLimits?: Record<string, number>;  // Optional: context limits for custom models
  modelAliases?: Record<string, string>;   // Optional: display aliases for custom models
}

/** Source of a slash command. */
export type SlashCommandSource = 'builtin' | 'user' | 'plugin' | 'sdk';

/** Slash command configuration shared by the UI, storage, and runtime boundary. */
export interface SlashCommand {
  id: string;
  name: string;                // Command name used after / (e.g., "review-code")
  description?: string;        // Optional description shown in dropdown
  argumentHint?: string;       // Placeholder text for arguments (e.g., "[file] [focus]")
  allowedTools?: string[];     // Restrict tools when command is used
  model?: string;              // Optional provider-specific model override
  content: string;             // Prompt template with placeholders
  source?: SlashCommandSource; // Origin of the command (builtin, user, plugin, sdk)
  kind?: 'command' | 'skill';  // Explicit type — replaces id-prefix heuristic
  // Provider-owned command metadata that the UI preserves and round-trips.
  disableModelInvocation?: boolean;  // Disable model invocation for this skill
  userInvocable?: boolean;           // Whether user can invoke this skill directly
  context?: 'fork';                  // Subagent execution mode
  agent?: string;                    // Subagent type when context='fork'
  hooks?: Record<string, unknown>;   // Pass-through to SDK
}

/** Keyboard navigation settings for vim-style scrolling. */
export interface KeyboardNavigationSettings {
  scrollUpKey: string;         // Key to scroll up when focused on messages (default: 'w')
  scrollDownKey: string;       // Key to scroll down when focused on messages (default: 's')
  focusInputKey: string;       // Key to focus input (default: 'i', like vim insert mode)
}

/** Tab bar position setting. */
export type TabBarPosition = 'input' | 'header';

export const CHAT_VIEW_PLACEMENTS = [
  'right-sidebar',
  'left-sidebar',
  'main-tab',
] as const;

/** Workspace location used when opening the Claudian chat view. */
export type ChatViewPlacement = typeof CHAT_VIEW_PLACEMENTS[number];

/** Result from instruction refinement agent query. */
export interface InstructionRefineResult {
  success: boolean;
  refinedInstruction?: string;  // The refined instruction text
  clarification?: string;       // Agent's clarifying question (if any)
  error?: string;               // Error message (if failed)
}

/** Permission mode for tool execution. */
export type PermissionMode = 'yolo' | 'plan' | 'normal';

/** Scope for environment variable storage and snippets. */
export type EnvironmentScope = 'shared' | `provider:${string}`;

/** Opaque device-keyed CLI paths for per-device configuration. */
export type HostnameCliPaths = Record<string, string>;

/** Opaque provider-owned settings bags keyed by provider id. */
export type ProviderConfigMap = Partial<Record<string, Record<string, unknown>>>;

/**
 * Application settings stored in .claudian/claudian-settings.json.
 *
 * Provider-specific fields (model, thinkingBudget, effortLevel, serviceTier, etc.) use
 * `string` here.  The active provider casts internally when it needs
 * narrower types.
 */
export interface ClaudianSettings {
  // User preferences
  userName: string;

  // Security
  permissionMode: PermissionMode;
  /** SEC-1: set once the YOLO (bypass-permissions) warning Notice has been shown. */
  yoloModeWarningShown?: boolean;
  /**
   * SEC-2: Per-vault trust flags keyed by an opaque vault key. A vault is honored
   * for risky project settings (hooks / permissions.allow) only after the user
   * explicitly trusts it.
   */
  trustedVaults?: Record<string, boolean>;
  /**
   * SEC-3: set once the one-time grandfather migration has run for this vault
   * (this settings object persists per-vault), so vault MCP servers already
   * present at upgrade are trusted while servers synced in afterwards default to
   * disabled — the migration does not silently re-trust newly-synced servers.
   */
  mcpVaultServersGrandfathered?: boolean;

  // Model & thinking (provider interprets values)
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];
  mediaFolder: string;
  systemPrompt: string;
  persistentExternalContextPaths: string[];

  // Environment
  sharedEnvironmentVariables: string;
  envSnippets: EnvSnippet[];
  customContextLimits: Record<string, number>;
  customModelAliases: Record<string, string>;

  // UI settings
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;

  // Internationalization
  locale: string;

  // Provider-owned settings
  providerConfigs: ProviderConfigMap;

  // Provider selection
  settingsProvider: string;  // ProviderId — which provider's model/effort/budget is projected to top-level fields
  savedProviderModel: Partial<Record<string, string>>;
  savedProviderEffort: Partial<Record<string, string>>;
  savedProviderServiceTier: Partial<Record<string, string>>;
  savedProviderThinkingBudget: Partial<Record<string, string>>;
  savedProviderPermissionMode: Partial<Record<string, string>>;

  // State (provider-specific, round-tripped opaquely)
  lastCustomModel?: string;

  // UI preferences
  maxTabs: number;
  tabBarPosition: TabBarPosition;
  enableAutoScroll: boolean;
  deferMathRenderingDuringStreaming: boolean;
  chatViewPlacement: ChatViewPlacement;
  firstRunDismissed: boolean;

  // Agent Board
  agentBoardWorkOrderFolder: string;
  agentBoardTemplateFolder: string;
  agentBoardArchiveFolder: string;
  agentBoardDefaultProvider: ProviderId | null;
  agentBoardDefaultModel: string | null;
  // Validated and normalized by BoardConfigStore; stored as raw to keep core free of feature types.
  agentBoardConfig?: unknown;

  // Provider command visibility
  hiddenProviderCommands: HiddenProviderCommands;

  /** When false, orchestrator toolbar toggle and mode are hidden. */
  orchestratorEnabled?: boolean;
  /** Custom orchestrator system prompt appendix; empty uses built-in default. */
  orchestratorSystemPrompt?: string;

  /** Vault folder for quick-action markdown files (relative to vault root). */
  quickActionsFolder?: string;

  /** Enable the diagnostic logger (console + ring buffer). */
  loggingEnabled?: boolean;
  /** Global log threshold. */
  logLevel?: LogLevel;

  // Allow provider-specific extension fields
  [key: string]: unknown;
}

/**
 * Views `ClaudianSettings` as an opaque string-keyed bag.
 *
 * This is the provider-UI-config seam: provider-owned code (chat UI configs,
 * settings reconcilers, auxiliary services, settings tabs) reads/writes its own
 * namespaced fields out of `providerConfigs` and top-level provider fields
 * without the provider-neutral contracts having to know each provider's concrete
 * settings shape. Centralizing the single `as unknown as Record<string, unknown>`
 * cast here keeps that one structural escape hatch named, searchable, and the
 * lone sanctioned `as unknown as` cast (no `any`).
 */
export function asSettingsBag(settings: ClaudianSettings): Record<string, unknown> {
  return settings as unknown as Record<string, unknown>;
}
