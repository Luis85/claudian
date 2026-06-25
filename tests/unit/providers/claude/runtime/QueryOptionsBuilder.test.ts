import * as path from 'path';

import type { PluginContext } from '@/core/types/PluginContext';
import type { SpecoratorSettings } from '@/core/types/settings';
import {
  setClaudeVaultTrusted,
} from '@/providers/claude/runtime/claudeProjectTrust';
import type { QueryOptionsContext } from '@/providers/claude/runtime/ClaudeQueryOptionsBuilder';
import { QueryOptionsBuilder } from '@/providers/claude/runtime/ClaudeQueryOptionsBuilder';
import type { PersistentQueryConfig } from '@/providers/claude/runtime/types';

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn(() => '/test/vault'),
  expandHomePath: jest.fn((p: string) => p),
}));

// The SEC-2 gate reads project-settings risk fresh from disk; drive it via a
// synchronous fs mock keyed on absolute path (override only the readers).
let mockFiles: Record<string, string> = {};
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: (p: string) =>
      Object.prototype.hasOwnProperty.call(mockFiles, p) || actual.existsSync(p),
    readFileSync: (p: string, ...rest: unknown[]) =>
      Object.prototype.hasOwnProperty.call(mockFiles, p)
        ? mockFiles[p]
        : actual.readFileSync(p, ...rest),
  };
});

// Production resolves this via path.join(vaultKey, '.claude/settings.json'),
// so the fs mock key must use the platform separator to match on Windows.
const PROJECT_SETTINGS_PATH = path.join('/test/vault', '.claude', 'settings.json');

/** Mark the vault's project settings as risky for the fresh-read gate. */
function setVaultRisky(): void {
  mockFiles[PROJECT_SETTINGS_PATH] = JSON.stringify({ hooks: { SessionStart: [{ command: 'x' }] } });
}

function trustPlugin(settings: Record<string, unknown> = {}): PluginContext {
  return { app: {}, settings, saveSettings: jest.fn(async () => undefined) } as unknown as PluginContext;
}

// Create a mock MCP server manager
function createMockMcpManager() {
  return {
    loadServers: jest.fn().mockResolvedValue(undefined),
    getServers: jest.fn().mockReturnValue([]),
    getEnabledCount: jest.fn().mockReturnValue(0),
    getActiveServers: jest.fn().mockReturnValue({}),
    getDisallowedMcpTools: jest.fn().mockReturnValue([]),
    getAllDisallowedMcpTools: jest.fn().mockReturnValue([]),
    hasServers: jest.fn().mockReturnValue(false),
  } as any;
}

// Create a mock plugin manager
function createMockPluginManager() {
  return {
    setEnabledPluginIds: jest.fn(),
    loadPlugins: jest.fn().mockResolvedValue(undefined),
    getPlugins: jest.fn().mockReturnValue([]),
    getUnavailableEnabledPlugins: jest.fn().mockReturnValue([]),
    hasEnabledPlugins: jest.fn().mockReturnValue(false),
    getEnabledCount: jest.fn().mockReturnValue(0),
    getPluginsKey: jest.fn().mockReturnValue(''),
    togglePlugin: jest.fn().mockReturnValue([]),
    enablePlugin: jest.fn().mockReturnValue([]),
    disablePlugin: jest.fn().mockReturnValue([]),
    hasPlugins: jest.fn().mockReturnValue(false),
  } as any;
}

// Create a mock settings object
function createMockSettings(overrides: Partial<SpecoratorSettings> = {}): SpecoratorSettings {
  return {
    permissions: [],
    permissionMode: 'yolo',
    claudeSafeMode: 'acceptEdits',
    codexSafeMode: 'workspace-write',
    loadUserClaudeSettings: false,
    mediaFolder: '',
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    thinkingBudget: 'off',
    titleGenerationModel: '',
    excludedTags: [],
    environmentVariables: '',
    envSnippets: [],
    keyboardNavigation: {
      scrollUpKey: 'k',
      scrollDownKey: 'j',
      focusInputKey: 'i',
    },
    claudeCliPath: '',
    enableChrome: false,
    ...overrides,
  } as SpecoratorSettings;
}

function createMockPersistentQueryConfig(
  overrides: Partial<PersistentQueryConfig> = {}
): PersistentQueryConfig {
  return {
    model: 'sonnet',
    effortLevel: 'high',
    permissionMode: 'yolo',
    sdkPermissionMode: 'bypassPermissions',
    systemPromptKey: 'key1',
    disallowedToolsKey: '',
    mcpServersKey: '',
    pluginsKey: '',
    externalContextPaths: [],
    settingSources: 'project,local',
    claudeCliPath: '/mock/claude',
    enableChrome: false,
    enableAutoMode: false,
    ...overrides,
  };
}

// Create a base context for tests
function createMockContext(overrides: Partial<QueryOptionsContext> = {}): QueryOptionsContext {
  return {
    vaultPath: '/test/vault',
    cliPath: '/mock/claude',
    settings: createMockSettings(),
    customEnv: {},
    enhancedPath: '/usr/bin:/mock/bin',
    mcpManager: createMockMcpManager(),
    pluginManager: createMockPluginManager(),
    ...overrides,
  };
}

describe('QueryOptionsBuilder', () => {
  describe('needsRestart', () => {
    it('returns true when currentConfig is null', () => {
      const newConfig = createMockPersistentQueryConfig();
      expect(QueryOptionsBuilder.needsRestart(null, newConfig)).toBe(true);
    });

    it('returns false when configs are identical', () => {
      const config = createMockPersistentQueryConfig();
      expect(QueryOptionsBuilder.needsRestart(config, { ...config })).toBe(false);
    });

    it('returns true when systemPromptKey changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, systemPromptKey: 'key2' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when disallowedToolsKey changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, disallowedToolsKey: 'tool1|tool2' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when claudeCliPath changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, claudeCliPath: '/new/claude' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when settingSources changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, settingSources: 'user,project,local' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when pluginsKey changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, pluginsKey: 'plugin-a:/path/a|plugin-b:/path/b' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns false when only effortLevel changes', () => {
      const currentConfig = createMockPersistentQueryConfig({ effortLevel: 'high' });
      const newConfig = { ...currentConfig, effortLevel: 'low' as const };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(false);
    });

    it('returns false when only model changes (dynamic update)', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, model: 'claude-opus-4-5' };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(false);
    });

    it('returns true when enableChrome changes from false to true', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, enableChrome: true };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when enableChrome changes from true to false', () => {
      const currentConfig = createMockPersistentQueryConfig({ enableChrome: true });
      const newConfig = { ...currentConfig, enableChrome: false };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when enableAutoMode changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, enableAutoMode: true };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when externalContextPaths changes', () => {
      const currentConfig = createMockPersistentQueryConfig();
      const newConfig = { ...currentConfig, externalContextPaths: ['/external/path'] };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when externalContextPaths is added', () => {
      const currentConfig = createMockPersistentQueryConfig({ externalContextPaths: ['/path/a'] });
      const newConfig = { ...currentConfig, externalContextPaths: ['/path/a', '/path/b'] };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns true when externalContextPaths is removed', () => {
      const currentConfig = createMockPersistentQueryConfig({ externalContextPaths: ['/path/a', '/path/b'] });
      const newConfig = { ...currentConfig, externalContextPaths: ['/path/a'] };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(true);
    });

    it('returns false when externalContextPaths order changes (same content)', () => {
      const currentConfig = createMockPersistentQueryConfig({ externalContextPaths: ['/path/a', '/path/b'] });
      // Same paths, different order - should NOT require restart since sorted comparison
      const newConfig = { ...currentConfig, externalContextPaths: ['/path/b', '/path/a'] };
      expect(QueryOptionsBuilder.needsRestart(currentConfig, newConfig)).toBe(false);
    });
  });

  describe('buildPersistentQueryConfig', () => {
    it('builds config with default settings', () => {
      const ctx = createMockContext();
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.model).toBe('claude-sonnet-4-5');
      expect(config.effortLevel).toBe('high');
      expect(config.permissionMode).toBe('yolo');
      expect(config.sdkPermissionMode).toBe('bypassPermissions');
      expect(config.settingSources).toBe('project,local');
      expect(config.claudeCliPath).toBe('/mock/claude');
    });

    it('tracks resolved sdkPermissionMode for normal mode', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ permissionMode: 'normal', claudeSafeMode: 'default' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.permissionMode).toBe('normal');
      expect(config.sdkPermissionMode).toBe('default');
    });

    it('tracks auto sdkPermissionMode for Claude safe mode', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ permissionMode: 'normal', claudeSafeMode: 'auto' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.permissionMode).toBe('normal');
      expect(config.sdkPermissionMode).toBe('auto');
      expect(config.enableAutoMode).toBe(true);
    });

    it('enables auto mode startup capability whenever Claude safe mode is auto', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ permissionMode: 'yolo', claudeSafeMode: 'auto' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.permissionMode).toBe('yolo');
      expect(config.sdkPermissionMode).toBe('bypassPermissions');
      expect(config.enableAutoMode).toBe(true);
    });

    it('ignores legacy thinking budget when building config', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'custom-model', thinkingBudget: 'high', effortLevel: 'medium' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.effortLevel).toBe('medium');
    });

    it('includes effortLevel for adaptive model', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'sonnet', effortLevel: 'max' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.effortLevel).toBe('max');
    });

    it('uses effort for Claude models even when a legacy budget is configured', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'sonnet', thinkingBudget: 'high', effortLevel: 'max' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.effortLevel).toBe('max');
    });

    it('normalizes unsupported xhigh effort for adaptive models', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'sonnet', effortLevel: 'xhigh' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.effortLevel).toBe('high');
    });

    it('sets effortLevel for custom model ids', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'custom-model', effortLevel: 'high' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.effortLevel).toBe('high');
    });

    it('includes enableChrome from settings', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ enableChrome: true }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.enableChrome).toBe(true);
    });

    it('sets settingSources to user,project,local when loadUserClaudeSettings is true', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ loadUserClaudeSettings: true }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.settingSources).toBe('user,project,local');
    });

    // Regression — work-order model override must be stored in config.model so
    // applyDynamicUpdates correctly detects model changes on subsequent turns.
    it('stores modelOverride in config.model when provided', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'opus' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], 'sonnet');

      expect(config.model).toBe('sonnet');
    });

    it('falls back to settings.model when no modelOverride provided', () => {
      const ctx = createMockContext({
        settings: createMockSettings({ model: 'opus' }),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);

      expect(config.model).toBe('opus');
    });
  });

  describe('buildPersistentQueryOptions', () => {
    it('sets yolo mode options correctly', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('includes canUseTool in yolo mode when provided', () => {
      const canUseTool = jest.fn();
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        canUseTool,
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.canUseTool).toBe(canUseTool);
    });

    it('sets normal mode options correctly (default claudeSafeMode)', () => {
      const canUseTool = jest.fn();
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'normal' }),
        }),
        abortController: new AbortController(),
        hooks: {},
        canUseTool,
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('acceptEdits');
      // Always true to enable dynamic switching to bypassPermissions without restart
      expect(options.allowDangerouslySkipPermissions).toBe(true);
      expect(options.canUseTool).toBe(canUseTool);
    });

    it('resolves claudeSafeMode "default" when permissionMode is normal', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'normal', claudeSafeMode: 'default' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('default');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('resolves claudeSafeMode "auto" when permissionMode is normal', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'normal', claudeSafeMode: 'auto' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('auto');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
      expect(options.extraArgs).toEqual({ 'enable-auto-mode': null });
    });

    it('passes auto mode opt-in whenever Claude safe mode is auto', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'yolo', claudeSafeMode: 'auto' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.extraArgs).toEqual({ 'enable-auto-mode': null });
    });

    it('ignores claudeSafeMode when permissionMode is yolo', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'yolo', claudeSafeMode: 'default' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('bypassPermissions');
    });

    it('sets plan mode options correctly', () => {
      const canUseTool = jest.fn();
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ permissionMode: 'plan' as any }),
        }),
        abortController: new AbortController(),
        hooks: {},
        canUseTool,
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.permissionMode).toBe('plan');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
      expect(options.canUseTool).toBe(canUseTool);
    });

    it('sets adaptive thinking with effort for Claude models', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'sonnet', effortLevel: 'max' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.thinking).toEqual({ type: 'adaptive' });
      expect(options.effort).toBe('max');
      expect(options.maxThinkingTokens).toBeUndefined();
    });

    it('clamps unsupported xhigh effort before building adaptive options', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'sonnet', effortLevel: 'xhigh' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.thinking).toEqual({ type: 'adaptive' });
      expect(options.effort).toBe('high');
    });

    it('sets adaptive thinking with effort for custom models', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'custom-model', thinkingBudget: 'high', effortLevel: 'medium' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.thinking).toEqual({ type: 'adaptive' });
      expect(options.effort).toBe('medium');
      expect(options.maxThinkingTokens).toBeUndefined();
    });

    it('sets resume session ID when provided', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123' },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.resume).toBe('session-123');
    });

    it('sets extraArgs with chrome flag when enableChrome is enabled', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ enableChrome: true }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.extraArgs).toBeDefined();
      expect(options.extraArgs).toEqual({ chrome: null });
    });

    it('sets extraArgs with chrome and auto mode flags when both are enabled', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ enableChrome: true, claudeSafeMode: 'auto' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.extraArgs).toEqual({ 'enable-auto-mode': null, chrome: null });
    });

    it('does not set extraArgs when enableChrome is disabled', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ enableChrome: false }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.extraArgs).toBeUndefined();
    });

    it('sets additionalDirectories when externalContextPaths provided', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        externalContextPaths: ['/external/path1', '/external/path2'],
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.additionalDirectories).toEqual(['/external/path1', '/external/path2']);
    });

    it('does not set additionalDirectories when externalContextPaths is empty', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        externalContextPaths: [],
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.additionalDirectories).toBeUndefined();
    });

    it('always enables file checkpointing', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.enableFileCheckpointing).toBe(true);
    });

    it('sets resumeSessionAt when provided in resume', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123', sessionAt: 'asst-uuid-456' },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.resumeSessionAt).toBe('asst-uuid-456');
    });

    it('does not set resumeSessionAt when resume has no sessionAt', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123' },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.resumeSessionAt).toBeUndefined();
    });

    it('sets forkSession when resume.fork is true', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123', fork: true },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.forkSession).toBe(true);
    });

    it('does not set forkSession when resume has no fork', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123' },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.forkSession).toBeUndefined();
    });

    it('sets both forkSession and resumeSessionAt when fork resumes at specific point', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        resume: { sessionId: 'session-123', sessionAt: 'asst-uuid-456', fork: true },
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.resume).toBe('session-123');
      expect(options.resumeSessionAt).toBe('asst-uuid-456');
      expect(options.forkSession).toBe(true);
    });

    it('does not set resume options when no resume provided', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.resume).toBeUndefined();
      expect(options.resumeSessionAt).toBeUndefined();
      expect(options.forkSession).toBeUndefined();
    });

    it('does not pass plugins or agents via SDK options (SDK auto-discovers from settings)', () => {
      const ctx = createMockContext();
      const options = QueryOptionsBuilder.buildPersistentQueryOptions({
        ...ctx, abortController: new AbortController(), hooks: {},
      });

      expect(options.plugins).toBeUndefined();
      expect(options.agents).toBeUndefined();
    });

    // Regression — work-order model must reach the CLI process at startup, not via
    // a post-init setModel() call that only takes effect at turn boundaries.
    it('uses modelOverride instead of settings.model when provided', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'opus', effortLevel: 'low' }),
        }),
        abortController: new AbortController(),
        hooks: {},
        modelOverride: 'sonnet',
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.model).toBe('sonnet');
    });

    it('uses settings.model when no modelOverride is set', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'opus' }),
        }),
        abortController: new AbortController(),
        hooks: {},
      };
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

      expect(options.model).toBe('opus');
    });
  });

  describe('buildColdStartQueryOptions', () => {
    it('includes MCP servers when available', () => {
      const mcpManager = createMockMcpManager();
      mcpManager.getActiveServers.mockReturnValue({
        'test-server': { command: 'test', args: [] },
      });

      const ctx = {
        ...createMockContext({ mcpManager }),
        abortController: new AbortController(),
        hooks: {},
        mcpMentions: new Set(['test-server']),
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.mcpServers).toBeDefined();
      expect(options.mcpServers?.['test-server']).toBeDefined();
    });

    it('merges the in-process specorator tool server when getSpecoratorToolServer returns one', () => {
      const specoratorServer = { type: 'sdk', name: 'specorator' };
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        getSpecoratorToolServer: () => specoratorServer,
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.mcpServers?.['specorator']).toBe(specoratorServer);
    });

    it('omits the specorator server when getSpecoratorToolServer returns nothing', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        getSpecoratorToolServer: () => undefined,
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.mcpServers?.['specorator']).toBeUndefined();
    });

    it('uses model override when provided', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ model: 'claude-sonnet-4-5' }),
        }),
        abortController: new AbortController(),
        hooks: {},
        modelOverride: 'claude-opus-4-5',
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.model).toBe('claude-opus-4-5');
    });

    it('applies tool restriction when allowedTools is provided', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        allowedTools: ['Read', 'Grep'],
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.tools).toEqual(['Read', 'Grep']);
    });

    it('sets extraArgs with chrome flag when enableChrome is enabled', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ enableChrome: true }),
        }),
        abortController: new AbortController(),
        hooks: {},
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.extraArgs).toBeDefined();
      expect(options.extraArgs).toEqual({ chrome: null });
    });

    it('sets extraArgs with auto mode flag when Claude safe mode is auto', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ claudeSafeMode: 'auto' }),
        }),
        abortController: new AbortController(),
        hooks: {},
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.extraArgs).toEqual({ 'enable-auto-mode': null });
    });

    it('does not set extraArgs when enableChrome is disabled', () => {
      const ctx = {
        ...createMockContext({
          settings: createMockSettings({ enableChrome: false }),
        }),
        abortController: new AbortController(),
        hooks: {},
        hasEditorContext: false,
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.extraArgs).toBeUndefined();
    });

    it('sets additionalDirectories when externalContextPaths provided', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        hasEditorContext: false,
        externalContextPaths: ['/external/path'],
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.additionalDirectories).toEqual(['/external/path']);
    });

    it('does not set additionalDirectories when externalContextPaths is empty', () => {
      const ctx = {
        ...createMockContext(),
        abortController: new AbortController(),
        hooks: {},
        hasEditorContext: false,
        externalContextPaths: [],
      };
      const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

      expect(options.additionalDirectories).toBeUndefined();
    });

    it('does not pass plugins via SDK options (CLI auto-discovers)', () => {
      const ctx = createMockContext();
      const options = QueryOptionsBuilder.buildColdStartQueryOptions({
        ...ctx, abortController: new AbortController(), hooks: {}, hasEditorContext: false,
      });

      expect(options.plugins).toBeUndefined();
    });

    it('does not pass agents via SDK options (SDK auto-discovers from settings)', () => {
      const ctx = createMockContext();
      const options = QueryOptionsBuilder.buildColdStartQueryOptions({
        ...ctx, abortController: new AbortController(), hooks: {}, hasEditorContext: false,
      });

      expect(options.agents).toBeUndefined();
    });
  });

  describe('boundAgentPrompt in systemPromptKey', () => {
    it('same prompt produces same key', () => {
      const ctx = createMockContext();
      const a = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, undefined);
      const b = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, undefined);
      expect(a.systemPromptKey).toBe(b.systemPromptKey);
    });

    it('different boundAgentPrompt produces different key', () => {
      const ctx = createMockContext();
      const a = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, undefined);
      const b = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, 'You are a researcher.');
      expect(a.systemPromptKey).not.toBe(b.systemPromptKey);
    });

    it('needsRestart when boundAgentPrompt changes', () => {
      const ctx = createMockContext();
      const a = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, undefined);
      const b = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, 'New agent prompt.');
      expect(QueryOptionsBuilder.needsRestart(a, b)).toBe(true);
    });

    it('no restart when boundAgentPrompt unchanged', () => {
      const ctx = createMockContext();
      const prompt = 'You are a researcher.';
      const a = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, prompt);
      const b = QueryOptionsBuilder.buildPersistentQueryConfig(ctx, [], undefined, prompt);
      expect(QueryOptionsBuilder.needsRestart(a, b)).toBe(false);
    });
  });

  describe('resolveEffectiveModel precedence', () => {
    it('explicit model overrides boundAgentModel', () => {
      expect(QueryOptionsBuilder.resolveEffectiveModel('explicit', 'agent-model', 'settings-model'))
        .toBe('explicit');
    });

    it('boundAgentModel beats settings when no explicit override', () => {
      expect(QueryOptionsBuilder.resolveEffectiveModel(undefined, 'agent-model', 'settings-model'))
        .toBe('agent-model');
    });

    it('falls back to settings when no override or boundAgentModel', () => {
      expect(QueryOptionsBuilder.resolveEffectiveModel(undefined, undefined, 'settings-model'))
        .toBe('settings-model');
    });
  });

  describe('SEC-2 project-settings trust gate', () => {
    beforeEach(() => {
      mockFiles = {};
    });

    it('keeps project/local sources when no risk is detected (safe vault unchanged)', () => {
      const ctx = createMockContext();
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);
      expect(config.settingSources).toBe('project,local');
    });

    it('withholds project/local sources for a risky, untrusted vault', () => {
      setVaultRisky();

      const ctx = createMockContext();
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);
      expect(config.settingSources).toBe('');

      const options = QueryOptionsBuilder.buildColdStartQueryOptions({
        ...ctx, abortController: new AbortController(), hooks: {}, hasEditorContext: false,
      });
      expect(options.settingSources).toEqual([]);
    });

    it('honors project/local sources once the risky vault is trusted', () => {
      setVaultRisky();

      const ctx = createMockContext({
        settings: createMockSettings({
          trustedVaults: { '/test/vault': true },
        } as Partial<SpecoratorSettings>),
      });
      const config = QueryOptionsBuilder.buildPersistentQueryConfig(ctx);
      expect(config.settingSources).toBe('project,local');
    });

    it('persists trust through setClaudeVaultTrusted keyed on the vault path', async () => {
      const settings: Record<string, unknown> = {};
      await setClaudeVaultTrusted(trustPlugin(settings), true);
      expect((settings.trustedVaults as Record<string, boolean>)['/test/vault']).toBe(true);
    });
  });
});
