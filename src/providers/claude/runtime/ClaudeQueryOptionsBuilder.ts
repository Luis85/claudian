import type {
  CanUseTool,
  Options,
  PermissionMode as SDKPermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import type { AppPluginManager } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import type { SpecoratorSettings, PermissionMode } from '../../../core/types/settings';
import {
  type ClaudeSafeMode,
  getClaudeProviderSettings,
  resolveClaudeSettingSources,
} from '../settings';
import {
  resolveEffortLevel,
} from '../types/models';
import { shouldHonorClaudeProjectSettingsFor } from './claudeProjectTrust';
import { createCustomSpawnFunction } from './customSpawn';
import {
  DISABLED_BUILTIN_SUBAGENTS,
  type PersistentQueryConfig,
  UNSUPPORTED_SDK_TOOLS,
} from './types';

export interface QueryOptionsContext {
  vaultPath: string;
  cliPath: string;
  settings: SpecoratorSettings;
  customEnv: Record<string, string>;
  enhancedPath: string;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  boundAgentPrompt?: string;
  boundAgentModel?: string;
}

export interface PersistentQueryContext extends QueryOptionsContext {
  abortController?: AbortController;
  resume?: {
    sessionId: string;
    sessionAt?: string;
    fork?: boolean;
  };
  canUseTool?: CanUseTool;
  hooks: Options['hooks'];
  externalContextPaths?: string[];
  /**
   * Per-turn model override (e.g. from a work-order's selected model).
   * Beats `settings.model` so the very first persistent-query message uses
   * the correct model without relying on a post-start `setModel()` call.
   */
  modelOverride?: string;
}

export interface ColdStartQueryContext extends QueryOptionsContext {
  abortController?: AbortController;
  sessionId?: string;
  modelOverride?: string;
  canUseTool?: CanUseTool;
  hooks: Options['hooks'];
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  allowedTools?: string[];
  hasEditorContext: boolean;
  externalContextPaths?: string[];
  /** Optional in-process Specorator user-tool MCP server (Claude only). */
  getSpecoratorToolServer?: () => unknown;
}

export class QueryOptionsBuilder {
  static needsRestart(
    currentConfig: PersistentQueryConfig | null,
    newConfig: PersistentQueryConfig
  ): boolean {
    if (!currentConfig) return true;

    // These require restart (cannot be updated dynamically)
    if (currentConfig.systemPromptKey !== newConfig.systemPromptKey) return true;
    if (currentConfig.disallowedToolsKey !== newConfig.disallowedToolsKey) return true;
    if (currentConfig.pluginsKey !== newConfig.pluginsKey) return true;
    if (currentConfig.settingSources !== newConfig.settingSources) return true;
    if (currentConfig.claudeCliPath !== newConfig.claudeCliPath) return true;

    // Note: Permission mode is handled dynamically via setPermissionMode() in SpecoratorService.
    // Since allowDangerouslySkipPermissions is always true, both directions work without restart.

    if (currentConfig.enableChrome !== newConfig.enableChrome) return true;
    if (currentConfig.enableAutoMode !== newConfig.enableAutoMode) return true;

    // External context paths require restart (additionalDirectories can't be updated dynamically)
    if (QueryOptionsBuilder.pathsChanged(currentConfig.externalContextPaths, newConfig.externalContextPaths)) {
      return true;
    }

    return false;
  }

  static resolveEffectiveModel(
    modelOverride: string | undefined,
    boundAgentModel: string | undefined,
    settingsModel: string,
  ): string {
    return modelOverride ?? boundAgentModel ?? settingsModel;
  }

  static buildPersistentQueryConfig(
    ctx: QueryOptionsContext,
    externalContextPaths?: string[],
    modelOverride?: string,
    boundAgentPrompt?: string,
  ): PersistentQueryConfig {
    const claudeSettings = getClaudeProviderSettings(ctx.settings);
    const systemPromptSettings: SystemPromptSettings = {
      mediaFolder: ctx.settings.mediaFolder,
      customPrompt: ctx.settings.systemPrompt,
      vaultPath: ctx.vaultPath,
      userName: ctx.settings.userName,
    };

    const sdkPermissionMode = QueryOptionsBuilder.resolveClaudeSdkPermissionMode(
      ctx.settings.permissionMode,
      claudeSettings.safeMode,
    );

    const disallowedToolsKey = ctx.mcpManager.getAllDisallowedMcpTools().join('|');
    const pluginsKey = ctx.pluginManager.getPluginsKey();

    // SEC-2: withhold project/local sources when the vault's risky
    // `.claude/settings.json` (hooks / permissions.allow) is untrusted. A change
    // here flips `settingSources`, which `needsRestart` watches, so trusting a
    // vault mid-session restarts the persistent query and re-honors them.
    const settingSources = resolveClaudeSettingSources(
      claudeSettings.loadUserSettings,
      shouldHonorClaudeProjectSettingsFor(asSettingsBag(ctx.settings), ctx.vaultPath),
    );

    // Use the per-turn model override when present (e.g. work-order model).
    // Storing it here keeps currentConfig.model accurate so applyDynamicUpdates
    // correctly detects changes on subsequent turns.
    const effectiveModel = QueryOptionsBuilder.resolveEffectiveModel(
      modelOverride,
      ctx.boundAgentModel,
      ctx.settings.model,
    );
    return {
      model: effectiveModel,
      effortLevel: resolveEffortLevel(effectiveModel, ctx.settings.effortLevel),
      permissionMode: ctx.settings.permissionMode,
      sdkPermissionMode,
      systemPromptKey: computeSystemPromptKey(systemPromptSettings, {
        appendices: boundAgentPrompt ? [boundAgentPrompt] : undefined,
      }),
      disallowedToolsKey,
      mcpServersKey: '', // Dynamic via setMcpServers, not tracked for restart
      pluginsKey,
      externalContextPaths: externalContextPaths || [],
      settingSources: settingSources.join(','),
      claudeCliPath: ctx.cliPath,
      enableChrome: claudeSettings.enableChrome,
      enableAutoMode: claudeSettings.safeMode === 'auto',
    };
  }

  static buildPersistentQueryOptions(ctx: PersistentQueryContext): Options {
    const { options, claudeSettings } = QueryOptionsBuilder.buildBaseOptions(
      ctx,
      QueryOptionsBuilder.resolveEffectiveModel(ctx.modelOverride, ctx.boundAgentModel, ctx.settings.model),
      ctx.abortController,
    );

    options.disallowedTools = [
      ...ctx.mcpManager.getAllDisallowedMcpTools(),
      ...UNSUPPORTED_SDK_TOOLS,
      ...DISABLED_BUILTIN_SUBAGENTS,
    ];

    QueryOptionsBuilder.applyPermissionMode(
      options,
      ctx.settings.permissionMode,
      claudeSettings.safeMode,
      ctx.canUseTool,
    );
    QueryOptionsBuilder.applyThinking(options, ctx.settings, QueryOptionsBuilder.resolveEffectiveModel(ctx.modelOverride, ctx.boundAgentModel, ctx.settings.model));
    options.hooks = ctx.hooks;

    options.enableFileCheckpointing = true;

    if (ctx.resume) {
      options.resume = ctx.resume.sessionId;
      if (ctx.resume.sessionAt) {
        options.resumeSessionAt = ctx.resume.sessionAt;
      }
      if (ctx.resume.fork) {
        options.forkSession = true;
      }
    }

    if (ctx.externalContextPaths && ctx.externalContextPaths.length > 0) {
      options.additionalDirectories = ctx.externalContextPaths;
    }

    return options;
  }

  static buildColdStartQueryOptions(ctx: ColdStartQueryContext): Options {
    const selectedModel = QueryOptionsBuilder.resolveEffectiveModel(
      ctx.modelOverride,
      ctx.boundAgentModel,
      ctx.settings.model,
    );
    const { options, claudeSettings } = QueryOptionsBuilder.buildBaseOptions(
      ctx,
      selectedModel,
      ctx.abortController,
    );

    const mcpMentions = ctx.mcpMentions || new Set<string>();
    const uiEnabledServers = ctx.enabledMcpServers || new Set<string>();
    const combinedMentions = new Set([...mcpMentions, ...uiEnabledServers]);
    const mcpServers: Record<string, unknown> = {
      ...ctx.mcpManager.getActiveServers(combinedMentions),
    };
    const specoratorToolServer = ctx.getSpecoratorToolServer?.();
    if (specoratorToolServer) {
      // Key must match SPECORATOR_TOOL_SERVER_NAME in features/tools; kept as a
      // literal because providers must not import from the features layer.
      mcpServers['specorator'] = specoratorToolServer;
    }

    if (Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers as typeof options.mcpServers;
    }

    const disallowedMcpTools = ctx.mcpManager.getDisallowedMcpTools(combinedMentions);
    options.disallowedTools = [
      ...disallowedMcpTools,
      ...UNSUPPORTED_SDK_TOOLS,
      ...DISABLED_BUILTIN_SUBAGENTS,
    ];

    QueryOptionsBuilder.applyPermissionMode(
      options,
      ctx.settings.permissionMode,
      claudeSettings.safeMode,
      ctx.canUseTool,
    );
    options.hooks = ctx.hooks;
    QueryOptionsBuilder.applyThinking(options, ctx.settings, selectedModel);

    if (ctx.allowedTools !== undefined && ctx.allowedTools.length > 0) {
      options.tools = ctx.allowedTools;
    }

    if (ctx.sessionId) {
      options.resume = ctx.sessionId;
    }

    if (ctx.externalContextPaths && ctx.externalContextPaths.length > 0) {
      options.additionalDirectories = ctx.externalContextPaths;
    }

    return options;
  }

  static resolveClaudeSdkPermissionMode(
    permissionMode: PermissionMode,
    claudeSafeMode: ClaudeSafeMode = 'acceptEdits',
  ): SDKPermissionMode {
    if (permissionMode === 'yolo') return 'bypassPermissions';
    if (permissionMode === 'plan') return 'plan';
    return claudeSafeMode;
  }

  private static applyPermissionMode(
    options: Options,
    permissionMode: PermissionMode,
    claudeSafeMode: ClaudeSafeMode,
    canUseTool?: CanUseTool
  ): void {
    options.allowDangerouslySkipPermissions = true;

    if (canUseTool) {
      options.canUseTool = canUseTool;
    }

    options.permissionMode = QueryOptionsBuilder.resolveClaudeSdkPermissionMode(
      permissionMode,
      claudeSafeMode,
    );
  }

  private static applyExtraArgs(
    options: Options,
    settings: { enableChrome: boolean; safeMode: ClaudeSafeMode },
  ): void {
    if (settings.safeMode === 'auto') {
      options.extraArgs = { ...options.extraArgs, 'enable-auto-mode': null };
    }

    if (settings.enableChrome) {
      options.extraArgs = { ...options.extraArgs, chrome: null };
    }
  }

  private static buildBaseOptions(
    ctx: QueryOptionsContext,
    model: string,
    abortController?: AbortController,
  ): { options: Options; claudeSettings: ReturnType<typeof getClaudeProviderSettings> } {
    const claudeSettings = getClaudeProviderSettings(ctx.settings);
    const systemPromptSettings: SystemPromptSettings = {
      mediaFolder: ctx.settings.mediaFolder,
      customPrompt: ctx.settings.systemPrompt,
      vaultPath: ctx.vaultPath,
      userName: ctx.settings.userName,
    };
    const options: Options = {
      cwd: ctx.vaultPath,
      systemPrompt: buildSystemPrompt(systemPromptSettings, {
        appendices: ctx.boundAgentPrompt ? [ctx.boundAgentPrompt] : undefined,
      }),
      model,
      abortController,
      pathToClaudeCodeExecutable: ctx.cliPath,
      // SEC-2: same gate as buildPersistentQueryConfig — untrusted risky project
      // settings (hooks / permissions.allow) never reach the SDK.
      settingSources: resolveClaudeSettingSources(
        claudeSettings.loadUserSettings,
        shouldHonorClaudeProjectSettingsFor(asSettingsBag(ctx.settings), ctx.vaultPath),
      ),
      env: {
        ...process.env,
        ...ctx.customEnv,
        PATH: ctx.enhancedPath,
      },
      includePartialMessages: true,
    };

    QueryOptionsBuilder.applyExtraArgs(options, claudeSettings);
    options.spawnClaudeCodeProcess = createCustomSpawnFunction(ctx.enhancedPath);

    return { options, claudeSettings };
  }

  private static applyThinking(
    options: Options,
    settings: SpecoratorSettings,
    model: string
  ): void {
    const effortLevel = resolveEffortLevel(model, settings.effortLevel);
    options.thinking = { type: 'adaptive' };
    // SDK runtime accepts `xhigh` on Opus 4.7+ and silently falls back to
    // `high` elsewhere, but its type definition lags our local EffortLevel.
    options.effort = effortLevel;
  }

  private static pathsChanged(a?: string[], b?: string[]): boolean {
    const aKey = [...(a || [])].sort().join('|');
    const bKey = [...(b || [])].sort().join('|');
    return aKey !== bKey;
  }

}
