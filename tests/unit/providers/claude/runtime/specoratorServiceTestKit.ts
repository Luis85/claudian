import '@/providers';

import * as sdkModule from '@anthropic-ai/claude-agent-sdk';
import { createMockRuntimeHost, type MockRuntimeHost } from '@test/helpers/runtimeHost';

import { Logger } from '@/core/logging/Logger';
import type { McpServerManager } from '@/core/mcp/McpServerManager';
import type SpecoratorPlugin from '@/main';
import { SpecoratorService } from '@/providers/claude/runtime/ClaudeChatRuntime';

/**
 * Shared fixtures for the SpecoratorService unit specs. The original monolithic
 * spec was split into per-surface sibling files (`SpecoratorService.*.test.ts`);
 * every sibling drives the same plugin/MCP/host doubles through this kit so the
 * setup stays in one place. No `jest.mock()` calls live here — the SDK and
 * obsidian modules are mapped to manual mocks via `moduleNameMapper`, so this
 * `sdkModule` import is the same singleton each spec observes.
 */

export const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  resetMockMessages: () => void;
  simulateCrash: (afterChunks?: number) => void;
  getLastOptions: () => sdkModule.Options | undefined;
  query: typeof sdkModule.query;
};

export type MockMcpServerManager = jest.Mocked<McpServerManager>;

export async function collectChunks(gen: AsyncGenerator<any>): Promise<any[]> {
  const chunks: any[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

export interface SpecoratorServiceTestContext {
  mockPlugin: Partial<SpecoratorPlugin>;
  mockMcpManager: MockMcpServerManager;
  host: MockRuntimeHost;
  service: SpecoratorService;
}

/**
 * Registers the shared `beforeEach` and returns a mutable context whose fields
 * are repopulated before every test. Call inside a `describe` body; sibling
 * specs then alias the fields they need in a thin local `beforeEach` (the kit's
 * hook is registered first, so the context is fresh by the time the alias
 * runs).
 */
export function setupSpecoratorServiceTest(): SpecoratorServiceTestContext {
  const ctx = {} as SpecoratorServiceTestContext;

  beforeEach(() => {
    jest.clearAllMocks();

    const storageMock = {
      addDenyRule: jest.fn().mockResolvedValue(undefined),
      addAllowRule: jest.fn().mockResolvedValue(undefined),
      getPermissions: jest.fn().mockResolvedValue({ allow: [], deny: [], ask: [] }),
    };

    ctx.mockPlugin = {
      app: {
        vault: { adapter: { basePath: '/mock/vault/path' } },
      },
      storage: storageMock,
      settings: {
        model: 'claude-3-5-sonnet',
        permissionMode: 'ask' as const,
        thinkingBudget: 0,
        mediaFolder: 'specorator-media',
        systemPrompt: '',
        loadUserClaudeSettings: false,
        claudeCliPath: '/usr/local/bin/claude',
        claudeCliPaths: [],
        enableAutoTitleGeneration: true,
        titleGenerationModel: 'claude-3-5-haiku',
      },
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/claude'),
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      getResolvedEnvironmentVariables: jest.fn().mockReturnValue({}),
      pluginManager: {
        getPluginsKey: jest.fn().mockReturnValue(''),
      },
      logger: new Logger({ enabled: false, level: 'off' }),
    } as unknown as SpecoratorPlugin;

    ctx.mockMcpManager = {
      loadServers: jest.fn().mockResolvedValue(undefined),
      getAllDisallowedMcpTools: jest.fn().mockReturnValue([]),
      getActiveServers: jest.fn().mockReturnValue({}),
      getDisallowedMcpTools: jest.fn().mockReturnValue([]),
      extractMentions: jest.fn().mockReturnValue(new Set<string>()),
      transformMentions: jest.fn().mockImplementation((text: string) => text),
    } as unknown as MockMcpServerManager;

    ctx.host = createMockRuntimeHost();
    ctx.service = new SpecoratorService(ctx.mockPlugin as SpecoratorPlugin, ctx.mockMcpManager, ctx.host);
  });

  return ctx;
}
