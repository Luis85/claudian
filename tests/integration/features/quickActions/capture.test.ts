/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import { Notice } from 'obsidian';

import type { ChatMessage, ChatMessageAction } from '@/core/types';
import { eligibleMessageActions } from '@/features/chat/rendering/messageActions';
import { isCaptureEligible, openCaptureFromMessage } from '@/features/quickActions/captureFromMessage';
import { parseQuickActionContent } from '@/features/quickActions/quickActionParse';
import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickActionEditorModal } from '@/features/quickActions/ui/QuickActionEditorModal';

// jsdom modal/setting stand-ins so the real QuickActionEditorModal can run end-to-end.
jest.mock('obsidian', () => {
  class Modal {
    app: any;
    contentEl: any;
    modalEl: any;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement('div');
      this.modalEl = document.createElement('div');
    }
    setTitle() {}
    open() { this.onOpen?.(); }
    close() {}
    onOpen?(): void;
  }
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      this.controlEl = document.createElement('div');
      container.appendChild(this.settingEl);
    }
    setName() { return this; }
    setDesc() { return this; }
    addText(cb: (i: any) => void) {
      const input: any = { setValue() { return input; }, setDisabled() { return input; }, onChange() { return input; } };
      cb(input);
      return this;
    }
    addTextArea(cb: (a: any) => void) {
      const area: any = { setValue() { return area; }, onChange() { return area; }, inputEl: { rows: 0, addClass() {} } };
      cb(area);
      return this;
    }
    addButton(cb: (b: any) => void) {
      const btn: any = { setButtonText() { return btn; }, setCta() { return btn; }, onClick() { return btn; } };
      cb(btn);
      return this;
    }
  }
  return { Modal, Notice: jest.fn(), Setting, normalizePath: (p: string) => p };
});

jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));

jest.mock('@/shared/components/LucideIconPicker', () => ({
  LucideIconPicker: class {
    constructor(_p: HTMLElement, _o: { value: string; onChange: (v: string) => void }) {}
    destroy() {}
  },
}));

function makeAdapter(fs = new Map<string, string>()) {
  return {
    exists: jest.fn(async (p: string) => fs.has(p)),
    read: jest.fn(async (p: string) => fs.get(p) ?? ''),
    write: jest.fn(async (p: string, c: string) => { fs.set(p, c); }),
    delete: jest.fn(async (p: string) => { fs.delete(p); }),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => Array.from(fs.keys())),
    append: jest.fn(),
  } as any;
}

interface PluginMock {
  app: any;
  settings: { quickActionsFolder: string };
  quickActionStorage: QuickActionStorage;
  quickActionFavoritesCache: { refresh: jest.Mock };
  logger: { scope: jest.Mock };
  chatMessageActions: ChatMessageAction[];
}

function makePlugin(fs = new Map<string, string>()): PluginMock {
  const storage = new QuickActionStorage(makeAdapter(fs), () => 'Quick Actions');
  const plugin: PluginMock = {
    app: { workspace: { openLinkText: jest.fn(async () => undefined) } },
    settings: { quickActionsFolder: 'Quick Actions' },
    quickActionStorage: storage,
    quickActionFavoritesCache: { refresh: jest.fn() },
    logger: { scope: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })) },
    chatMessageActions: [],
  };
  // Mirror the registration block in src/main.ts so the integration test drives
  // the same action shape the runtime registers.
  plugin.chatMessageActions.push({
    id: 'capture-prompt-as-quick-action',
    label: 'quickActions.capture.label',
    icon: 'bookmark-plus',
    isEligible: isCaptureEligible,
    run: (msg) => openCaptureFromMessage(plugin as any, msg),
  });
  return plugin;
}

/**
 * Captures the most recently constructed QuickActionEditorModal so the test
 * can drive its handleSave directly (no clickable button in jsdom). We do not
 * mock the modal — we only sniff the instance. Re-resolves the real class via
 * jest.requireActual to avoid the spied-class infinite recursion.
 */
interface EditorModule {
  QuickActionEditorModal: new (...args: unknown[]) => QuickActionEditorModal;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const editorModule = require('@/features/quickActions/ui/QuickActionEditorModal') as EditorModule;
const RealQuickActionEditorModal = jest.requireActual<EditorModule>(
  '@/features/quickActions/ui/QuickActionEditorModal',
).QuickActionEditorModal;
const ModalCtorSpy = jest.spyOn(editorModule, 'QuickActionEditorModal');
let lastModal: QuickActionEditorModal | null = null;
ModalCtorSpy.mockImplementation((...args: any[]) => {
  const instance = new (RealQuickActionEditorModal as any)(...args);
  lastModal = instance;
  return instance;
});

beforeEach(() => {
  jest.clearAllMocks();
  lastModal = null;
});

describe('capture flow integration', () => {
  it('registers the action with the eligibility predicate so the toolbar only shows it for user prose', () => {
    const plugin = makePlugin();

    const user: ChatMessage = { id: 'u', role: 'user', content: 'Summarize this PR', timestamp: 0 } as ChatMessage;
    const command: ChatMessage = { id: 'c', role: 'user', content: '/compact', timestamp: 0 } as ChatMessage;
    const assistant: ChatMessage = { id: 'a', role: 'assistant', content: 'sure', timestamp: 0 } as ChatMessage;

    const visibleIds = eligibleMessageActions(plugin.chatMessageActions, user).map((a) => a.id);
    expect(visibleIds).toContain('capture-prompt-as-quick-action');
    expect(eligibleMessageActions(plugin.chatMessageActions, command).map((a) => a.id))
      .not.toContain('capture-prompt-as-quick-action');
    expect(eligibleMessageActions(plugin.chatMessageActions, assistant).map((a) => a.id))
      .not.toContain('capture-prompt-as-quick-action');
  });

  it('drives the registered action through the real modal handleSave to write a parseable file', async () => {
    const fs = new Map<string, string>();
    const plugin = makePlugin(fs);
    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Summarize the highlighted note in three bullet points.',
      timestamp: 0,
    } as ChatMessage;

    // Trigger the same code path the chat toolbar runs.
    const action = eligibleMessageActions(plugin.chatMessageActions, msg)
      .find((a) => a.id === 'capture-prompt-as-quick-action');
    expect(action).toBeDefined();
    action!.run(msg, null);

    expect(lastModal).not.toBeNull();
    // Drive handleSave with values the seeded form would have surfaced on submit.
    await (lastModal as any).handleSave(
      'Summarize the highlighted note in three bullet',
      '',
      '',
      msg.content,
    );

    const writtenPath = 'Quick Actions/summarize-the-highlighted-note-in-three-bullet.md';
    expect(fs.has(writtenPath)).toBe(true);
    expect(plugin.quickActionFavoritesCache.refresh).toHaveBeenCalled();
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith(writtenPath, '', 'tab');
    expect(Notice).toHaveBeenCalledWith('quickActions.capture.saved');

    const parsed = parseQuickActionContent(fs.get(writtenPath)!, writtenPath);
    expect(parsed?.prompt).toBe(msg.content);
    expect(parsed?.name).toBe('Summarize the highlighted note in three bullet');
  });

  it("surfaces 'folderMissing' notice and never constructs the modal when the folder setting is blank", () => {
    const plugin = makePlugin();
    plugin.settings.quickActionsFolder = '';

    const action = plugin.chatMessageActions.find((a) => a.id === 'capture-prompt-as-quick-action')!;
    action.run({ id: 'm', role: 'user', content: 'capture me', timestamp: 0 } as ChatMessage, null);

    expect(Notice).toHaveBeenCalledWith('quickActions.capture.folderMissing');
    expect(lastModal).toBeNull();
  });

  it('blocks a second capture against the same slug via the editor add-flow collision guard', async () => {
    const fs = new Map<string, string>();
    const plugin = makePlugin(fs);
    const msg: ChatMessage = { id: 'u2', role: 'user', content: 'Dup prompt body.', timestamp: 0 } as ChatMessage;
    const action = plugin.chatMessageActions.find((a) => a.id === 'capture-prompt-as-quick-action')!;

    // First capture writes successfully.
    action.run(msg, null);
    await (lastModal as any).handleSave('Dup prompt body.', '', '', msg.content);
    const slugPath = 'Quick Actions/dup-prompt-body.md';
    expect(fs.has(slugPath)).toBe(true);

    // Second capture against the same name must trip the in-modal collision guard.
    (Notice as unknown as jest.Mock).mockClear();
    plugin.app.workspace.openLinkText.mockClear();
    action.run(msg, null);
    await (lastModal as any).handleSave('Dup prompt body.', '', '', msg.content);

    expect(Notice).toHaveBeenCalledWith('quickActions.editor.nameExists');
    expect(plugin.app.workspace.openLinkText).not.toHaveBeenCalled();
    // Original file still intact — no second write.
    expect(fs.size).toBe(1);
  });
});
