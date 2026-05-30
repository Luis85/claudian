jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    normalizePath: (p: string): string => p.replace(/\\/g, '/').replace(/\/+/g, '/'),
  };
});

import { TFile } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderChatUIConfig, ProviderRegistration } from '@/core/providers/types';
import { createWorkOrderFromSeed } from '@/features/tasks/commands/taskCommands';
import type ClaudianPlugin from '@/main';

/**
 * F5b contract: createWorkOrderFromSeed must read the Agent Board default
 * model through `resolveAgentBoardDefaultModel`, which validates the stored
 * model against the resolved provider's owned model set and falls back to
 * the provider's first model option when the stored value is invalid.
 */
describe('createWorkOrderFromSeed default-model resolution (integration)', () => {
  let priorClaude: ProviderRegistration | undefined;

  beforeAll(() => {
    // Stub a Claude registration the resolver can consult during the test.
    const stub: Partial<ProviderRegistration> = {
      displayName: 'Claude',
      blankTabOrder: 0,
      capabilities: { providerId: 'claude' } as ProviderRegistration['capabilities'],
      isEnabled: (settings) =>
        Boolean(((settings as Record<string, unknown>).providerConfigs as Record<string, { enabled?: boolean }>)?.claude?.enabled),
      chatUIConfig: {
        getModelOptions: () => [
          { value: 'haiku', label: 'Haiku' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
        ownsModel: (model: string) => model === 'haiku' || model === 'sonnet',
      } as unknown as ProviderChatUIConfig,
    };
    const registrations = (ProviderRegistry as unknown as { registrations: Record<string, ProviderRegistration> }).registrations;
    priorClaude = registrations.claude;
    registrations.claude = stub as ProviderRegistration;
  });

  afterAll(() => {
    const registrations = (ProviderRegistry as unknown as { registrations: Record<string, ProviderRegistration> }).registrations;
    if (priorClaude) {
      registrations.claude = priorClaude;
    } else {
      delete registrations.claude;
    }
  });

  it('falls back to the provider default model when the stored model is invalid', async () => {
    const captured: { path: string; markdown: string }[] = [];

    const plugin = {
      settings: {
        agentBoardDefaultProvider: 'claude',
        agentBoardDefaultModel: 'gpt-4-not-a-claude-model',
        agentBoardWorkOrderFolder: 'Agent Board/tasks',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: false },
          opencode: { enabled: false },
          cursor: { enabled: false },
        },
      },
      app: {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(null),
          createFolder: jest.fn().mockResolvedValue(undefined),
          create: jest.fn().mockImplementation(async (path: string, markdown: string) => {
            captured.push({ path, markdown });
            return Object.assign(new TFile(), { path });
          }),
        },
        workspace: {
          getLeaf: jest.fn().mockReturnValue({
            openFile: jest.fn().mockResolvedValue(undefined),
          }),
        },
      },
    } as unknown as ClaudianPlugin;

    const file = await createWorkOrderFromSeed(plugin, { title: 'Invalid model falls back' });
    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);

    const { markdown } = captured[0];
    expect(markdown).toContain('provider: claude');
    expect(markdown).toContain('model: haiku');
    expect(markdown).not.toContain('model: gpt-4-not-a-claude-model');
  });

  it('keeps the stored model when it is valid for the resolved provider', async () => {
    const captured: { path: string; markdown: string }[] = [];

    const plugin = {
      settings: {
        agentBoardDefaultProvider: 'claude',
        agentBoardDefaultModel: 'sonnet',
        agentBoardWorkOrderFolder: 'Agent Board/tasks',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: false },
          opencode: { enabled: false },
          cursor: { enabled: false },
        },
      },
      app: {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(null),
          createFolder: jest.fn().mockResolvedValue(undefined),
          create: jest.fn().mockImplementation(async (path: string, markdown: string) => {
            captured.push({ path, markdown });
            return Object.assign(new TFile(), { path });
          }),
        },
        workspace: {
          getLeaf: jest.fn().mockReturnValue({
            openFile: jest.fn().mockResolvedValue(undefined),
          }),
        },
      },
    } as unknown as ClaudianPlugin;

    const file = await createWorkOrderFromSeed(plugin, { title: 'Stored model kept' });
    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0].markdown).toContain('model: sonnet');
  });
});
