import { registerPluginCommands } from '@/app/commands/registerPluginCommands';
import {
  getCommandHotkeys,
  resetCommandHotkeysForTests,
} from '@/core/commands/commandHotkeyRegistry';
import type { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { ChatWorkOrderLinker } from '@/features/tasks/execution/ChatWorkOrderLinker';
import type ClaudianPlugin from '@/main';

type AnyCommand = {
  id: string;
  name: string;
  callback?: () => unknown;
  editorCallback?: (...args: unknown[]) => unknown;
  checkCallback?: (checking: boolean) => boolean;
};

function createPlugin(): { plugin: ClaudianPlugin; commands: AnyCommand[] } {
  const commands: AnyCommand[] = [];
  const plugin = {
    addCommand: jest.fn((cmd: AnyCommand) => {
      commands.push(cmd);
    }),
    logger: { clear: jest.fn() },
    app: {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue(null),
        getLeavesOfType: jest.fn().mockReturnValue([]),
      },
    },
    settings: { maxTabs: 3 },
    copyDiagnosticLogs: jest.fn(),
  } as unknown as ClaudianPlugin;
  return { plugin, commands };
}

const EXPECTED_COMMAND_IDS = [
  'open-view',
  'open-agent-board',
  'run-next-ready-work-order',
  'create-work-order',
  'create-work-order-from-current-note',
  'create-work-order-from-selection',
  'create-work-order-template',
  'install-common-work-order-templates',
  'create-work-order-from-browser-selection',
  'create-work-order-from-chat-conversation',
  'copy-diagnostic-logs',
  'clear-diagnostic-logs',
  'inline-edit',
  'new-tab',
  'new-session',
  'close-current-tab',
];

describe('registerPluginCommands', () => {
  beforeEach(() => {
    resetCommandHotkeysForTests();
  });

  it('registers the expected command ids', () => {
    const { plugin, commands } = createPlugin();
    const taskExecutionSurface = {} as ChatTabExecutionSurface;
    const chatWorkOrderLinker = {} as ChatWorkOrderLinker;

    registerPluginCommands({ plugin, taskExecutionSurface, chatWorkOrderLinker });

    expect(commands.map((c) => c.id)).toEqual(EXPECTED_COMMAND_IDS);
  });

  it('registers a hotkey entry for every command', () => {
    const { plugin } = createPlugin();
    registerPluginCommands({
      plugin,
      taskExecutionSurface: {} as ChatTabExecutionSurface,
      chatWorkOrderLinker: {} as ChatWorkOrderLinker,
    });

    expect(getCommandHotkeys().map((h) => h.commandId)).toEqual(EXPECTED_COMMAND_IDS);
  });

  it('clear-diagnostic-logs invokes plugin.logger.clear', () => {
    const { plugin, commands } = createPlugin();
    registerPluginCommands({
      plugin,
      taskExecutionSurface: {} as ChatTabExecutionSurface,
      chatWorkOrderLinker: {} as ChatWorkOrderLinker,
    });
    const cmd = commands.find((c) => c.id === 'clear-diagnostic-logs')!;
    cmd.callback?.();
    expect((plugin.logger.clear as jest.Mock)).toHaveBeenCalled();
  });
});
