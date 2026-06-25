import { TFile } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderChatUIConfig, ProviderRegistration } from '@/core/providers/types';
import { createWorkOrderFromSeed } from '@/features/tasks/commands/taskCommands';
import type SpecoratorPlugin from '@/main';

/**
 * F2 contract: createWorkOrderFromSeed must read the Agent Board default
 * provider through `resolveAgentBoardDefaultProvider`, not directly off
 * `settings.agentBoardDefaultProvider`. When the stored provider is disabled,
 * the resolver falls back to the first enabled provider; the work-order note
 * must therefore stamp the fallback, not the stored (disabled) value.
 */
describe('createWorkOrderFromSeed default-provider resolution (integration)', () => {
  // Resolver pulls chat UI config via ProviderRegistry; stub Claude and Codex
  // registrations so the resolver can call `ownsModel` / `getModelOptions`.
  let priorRegistrations: Record<string, ProviderRegistration> = {};

  beforeAll(() => {
    const registrations = (ProviderRegistry as unknown as { registrations: Record<string, ProviderRegistration> }).registrations;
    priorRegistrations = { ...registrations };
    const makeStub = (id: string, models: { value: string; label: string }[]): ProviderRegistration => ({
      displayName: id,
      blankTabOrder: 0,
      capabilities: { providerId: id } as ProviderRegistration['capabilities'],
      isEnabled: (settings: Record<string, unknown>) =>
        Boolean((settings.providerConfigs as Record<string, { enabled?: boolean }>)?.[id]?.enabled),
      chatUIConfig: {
        getModelOptions: () => models,
        ownsModel: (model: string) => models.some((m) => m.value === model),
      } as unknown as ProviderChatUIConfig,
    } as unknown as ProviderRegistration);
    registrations.claude = makeStub('claude', [
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ]);
    registrations.codex = makeStub('codex', [
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ]);
  });

  afterAll(() => {
    const registrations = (ProviderRegistry as unknown as { registrations: Record<string, ProviderRegistration> }).registrations;
    for (const key of Object.keys(registrations)) {
      delete registrations[key];
    }
    Object.assign(registrations, priorRegistrations);
  });

  it('stamps the resolver-chosen provider when the stored default is disabled', async () => {
    // Stored default is codex (disabled); claude is the only enabled provider.
    // Resolver must fall through tab-strip order and pick claude.
    const captured: { path: string; markdown: string }[] = [];

    const plugin = {
      settings: {
        agentBoardDefaultProvider: 'codex',
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
    } as unknown as SpecoratorPlugin;

    const file = await createWorkOrderFromSeed(plugin, { title: 'Pick the right provider' });
    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);

    const { markdown } = captured[0];
    expect(markdown).toContain('provider: claude');
    expect(markdown).not.toContain('provider: codex');
  });

  it('keeps the stored provider when it is enabled', async () => {
    const captured: { path: string; markdown: string }[] = [];

    const plugin = {
      settings: {
        agentBoardDefaultProvider: 'codex',
        agentBoardDefaultModel: 'gpt-5-codex',
        agentBoardWorkOrderFolder: 'Agent Board/tasks',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: true },
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
    } as unknown as SpecoratorPlugin;

    const file = await createWorkOrderFromSeed(plugin, { title: 'Keep stored when enabled' });
    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0].markdown).toContain('provider: codex');
  });
});
