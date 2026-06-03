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
import type { WorkOrderTemplate } from '@/features/tasks/templates/templateTypes';
import type ClaudianPlugin from '@/main';

/**
 * When the user picks a template at work-order creation time, the resulting
 * work order's title (frontmatter + H1 + filename slug) must be the template's
 * `name`, not whatever seed title was inferred from the source note/folder.
 * This makes the template the dominant signal for "what kind of work this is",
 * which matches how the picker is used in practice.
 */
describe('createWorkOrderFromSeed template-title override (integration)', () => {
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
    registrations.claude = makeStub('claude', [{ value: 'sonnet', label: 'Sonnet' }]);
  });

  afterAll(() => {
    const registrations = (ProviderRegistry as unknown as { registrations: Record<string, ProviderRegistration> }).registrations;
    for (const key of Object.keys(registrations)) {
      delete registrations[key];
    }
    Object.assign(registrations, priorRegistrations);
  });

  function buildPlugin(captured: { path: string; markdown: string }[]): ClaudianPlugin {
    return {
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
  }

  it('uses the template name as the work-order title when a template is picked', async () => {
    const captured: { path: string; markdown: string }[] = [];
    const plugin = buildPlugin(captured);

    const template: WorkOrderTemplate = {
      path: 'Agent Board/templates/bug-fix.md',
      name: 'Bug fix',
      body: '# {{title}}\n\nFix the bug.\n',
    };

    const file = await createWorkOrderFromSeed(
      plugin,
      { title: 'Source note basename', sourcePath: 'notes/example.md' },
      { template, reveal: 'none' },
    );

    expect(file).not.toBeNull();
    expect(captured).toHaveLength(1);
    const { path, markdown } = captured[0];

    expect(markdown).toContain('title: "Bug fix"');
    expect(markdown).not.toContain('title: "Source note basename"');
    expect(markdown).toContain('# Bug fix');
    expect(path).toMatch(/-bug-fix\.md$/);
  });

  it('falls back to the seed title when no template is picked', async () => {
    const captured: { path: string; markdown: string }[] = [];
    const plugin = buildPlugin(captured);

    const file = await createWorkOrderFromSeed(
      plugin,
      { title: 'Plain seed title' },
      { reveal: 'none' },
    );

    expect(file).not.toBeNull();
    expect(captured[0].markdown).toContain('title: "Plain seed title"');
  });
});
