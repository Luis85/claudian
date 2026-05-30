jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    normalizePath: (p: string): string => p.replace(/\\/g, '/').replace(/\/+/g, '/'),
  };
});

import { TFile } from 'obsidian';

import { createWorkOrderFromSeed } from '@/features/tasks/commands/taskCommands';
import type ClaudianPlugin from '@/main';

/**
 * F2 contract: createWorkOrderFromSeed must read the Agent Board default
 * provider through `resolveAgentBoardDefaultProvider`, not directly off
 * `settings.agentBoardDefaultProvider`. When the stored provider is disabled,
 * the resolver falls back to the first enabled provider; the work-order note
 * must therefore stamp the fallback, not the stored (disabled) value.
 */
describe('createWorkOrderFromSeed default-provider resolution (integration)', () => {
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
    } as unknown as ClaudianPlugin;

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
    } as unknown as ClaudianPlugin;

    const file = await createWorkOrderFromSeed(plugin, { title: 'Keep stored when enabled' });
    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0].markdown).toContain('provider: codex');
  });
});
