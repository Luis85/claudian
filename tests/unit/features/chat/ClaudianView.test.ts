import { createMockEl } from '@test/helpers/mockElement';
import { readdirSync, readFileSync, statSync } from 'fs';
import { Platform, Scope } from 'obsidian';
import { join } from 'path';

import { ClaudianView } from '@/features/chat/ClaudianView';

const MockScope = Scope as typeof Scope & { instances: Scope[] };

function createViewHarness(options: {
  canCreateTab: boolean;
  tabBarPosition?: 'input' | 'header';
  tabCount?: number;
}): {
  newTabButtonEl: ReturnType<typeof createMockEl>;
  view: any;
} {
  const newTabButtonEl = createMockEl();
  const view = Object.create(ClaudianView.prototype) as any;

  view.plugin = {
    settings: {
      tabBarPosition: options.tabBarPosition ?? 'input',
    },
  };
  view.tabManager = {
    canCreateTab: jest.fn().mockReturnValue(options.canCreateTab),
    getTabCount: jest.fn().mockReturnValue(options.tabCount ?? 1),
  };
  view.tabBarContainerEl = createMockEl();
  view.logoEl = createMockEl();
  view.titleTextEl = createMockEl();
  view.newTabButtonEl = newTabButtonEl;

  return { newTabButtonEl, view };
}

describe('ClaudianView tab controls', () => {
  it('creates the git action in the header actions instead of the input nav content', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.containerEl = createMockEl();
    view.containerEl.ownerDocument.createDocumentFragment = () => createMockEl('fragment');
    view.plugin = {
      gitStatusWatcher: {
        subscribe: jest.fn(() => jest.fn()),
      },
      settings: {},
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };
    view.syncHeaderLogo = jest.fn();
    const header = createMockEl();
    view.buildHeader(header);

    const navContent = view.buildNavRowContent();

    expect(view.headerActionsEl.querySelector('.claudian-git-action')).not.toBeNull();
    expect(navContent.querySelector('.claudian-git-action')).toBeNull();
  });

  it('hides the new-tab button when the tab manager is at capacity', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: false });

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBe('true');
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new-tab button when another tab can be created', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: true });
    newTabButtonEl.addClass('claudian-hidden');
    newTabButtonEl.setAttribute('aria-disabled', 'true');
    newTabButtonEl.setAttribute('aria-hidden', 'true');

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBeNull();
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('ClaudianView.injectCommitTurnForConversation', () => {
  type InjectHarness = {
    view: any;
    sendMessage: jest.Mock;
    crossSendMessage: jest.Mock;
    switchToTab: jest.Mock;
    crossSwitchToTab: jest.Mock;
    openConversation: jest.Mock;
    canCreateTab: jest.Mock;
    startTaskRunInFreshTab: jest.Mock;
    findConversationAcrossViews: jest.Mock;
  };

  function makeHarness(opts: {
    canCreateTab?: boolean;
    initialCross?: 'this' | 'other' | null;
    postOpenCross?: 'this' | 'other' | null;
  }): InjectHarness {
    const sendMessage = jest.fn(async () => undefined);
    const crossSendMessage = jest.fn(async () => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const crossSwitchToTab = jest.fn(async () => undefined);
    const openConversation = jest.fn(async () => undefined);
    const canCreateTab = jest.fn(() => opts.canCreateTab ?? true);
    const startTaskRunInFreshTab = jest.fn(async () => ({
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-fresh',
      subscribe: () => () => {},
      sendFollowUp: async () => {},
      cancel: () => {},
      terminal: Promise.resolve({ status: 'completed' as const, finalAssistantContent: '' }),
    }));

    const view = Object.create(ClaudianView.prototype) as any;
    const localTab = {
      id: 'tab-local',
      controllers: { inputController: { sendMessage } },
    };
    const otherTab = {
      id: 'tab-other',
      controllers: { inputController: { sendMessage: crossSendMessage } },
    };
    const otherTabManager = {
      switchToTab: crossSwitchToTab,
      getTab: jest.fn(() => otherTab),
    };
    const otherView = { getTabManager: () => otherTabManager };

    view.tabManager = {
      switchToTab,
      getTab: jest.fn(() => localTab),
      openConversation,
      canCreateTab,
    };
    view.startTaskRunInFreshTab = startTaskRunInFreshTab;

    const resolveCross = (mode: 'this' | 'other' | null) => {
      if (mode === 'this') return { view, tabId: 'tab-local' };
      if (mode === 'other') return { view: otherView, tabId: 'tab-other' };
      return null;
    };
    const findConversationAcrossViews = jest.fn();
    findConversationAcrossViews
      .mockReturnValueOnce(resolveCross(opts.initialCross ?? null));
    findConversationAcrossViews
      .mockReturnValueOnce(resolveCross(opts.postOpenCross ?? opts.initialCross ?? null));
    view.plugin = { findConversationAcrossViews };

    return {
      view,
      sendMessage,
      crossSendMessage,
      switchToTab,
      crossSwitchToTab,
      openConversation,
      canCreateTab,
      startTaskRunInFreshTab,
      findConversationAcrossViews,
    };
  }

  it('focuses an in-view tab and sends the prompt without reopening from history', async () => {
    const h = makeHarness({ initialCross: 'this' });

    await h.view.injectCommitTurnForConversation({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.openConversation).not.toHaveBeenCalled();
    expect(h.switchToTab).toHaveBeenCalledWith('tab-local');
    expect(h.sendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
    expect(h.startTaskRunInFreshTab).not.toHaveBeenCalled();
  });

  it('focuses a cross-view tab and sends the prompt there', async () => {
    const h = makeHarness({ initialCross: 'other' });

    await h.view.injectCommitTurnForConversation({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.openConversation).not.toHaveBeenCalled();
    expect(h.crossSwitchToTab).toHaveBeenCalledWith('tab-other');
    expect(h.crossSendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.startTaskRunInFreshTab).not.toHaveBeenCalled();
  });

  it('reopens the saved conversation from history into a fresh tab when no tab hosts it', async () => {
    const h = makeHarness({
      canCreateTab: true,
      initialCross: null,
      postOpenCross: 'this',
    });

    await h.view.injectCommitTurnForConversation({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.openConversation).toHaveBeenCalledWith('conv-1', { preferNewTab: true });
    expect(h.sendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
    expect(h.startTaskRunInFreshTab).not.toHaveBeenCalled();
  });

  it('restores the saved conversation into the active tab when the tab cap blocks a new tab', async () => {
    // canCreateTab false → TabManager.openConversation loads the saved
    // history into the active tab (no createTab path). The post-open lookup
    // resolves the active tab as the owner; the commit prompt fires there
    // instead of bouncing off the tab cap with a fresh-tab failure.
    const h = makeHarness({
      canCreateTab: false,
      initialCross: null,
      postOpenCross: 'this',
    });

    await h.view.injectCommitTurnForConversation({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.openConversation).toHaveBeenCalledWith('conv-1', { preferNewTab: true });
    expect(h.sendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
    expect(h.startTaskRunInFreshTab).not.toHaveBeenCalled();
  });

  it('falls back to a fresh task-run tab when openConversation cannot surface any tab', async () => {
    // Edge case: openConversation runs but neither the new-tab nor the
    // active-tab restore path lands a tab. findConversationAcrossViews
    // still returns null post-open → fresh task-run tab is the last resort.
    const h = makeHarness({
      canCreateTab: false,
      initialCross: null,
      postOpenCross: null,
    });

    await h.view.injectCommitTurnForConversation({
      conversationId: 'conv-1',
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.openConversation).toHaveBeenCalledWith('conv-1', { preferNewTab: true });
    expect(h.startTaskRunInFreshTab).toHaveBeenCalledWith({
      providerId: 'claude',
      model: 'opus',
      prompt: 'PROMPT',
    });
  });

  it('falls back to a fresh task-run tab when no conversationId is supplied', async () => {
    const h = makeHarness({ initialCross: null });

    await h.view.injectCommitTurnForConversation({
      conversationId: null,
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    expect(h.findConversationAcrossViews).not.toHaveBeenCalled();
    expect(h.openConversation).not.toHaveBeenCalled();
    expect(h.startTaskRunInFreshTab).toHaveBeenCalled();
  });

  it('disposes the fresh-tab stream observer after the commit fallback settles', async () => {
    const h = makeHarness({ initialCross: null });
    const dispose = jest.fn();
    h.view.startTaskRunInFreshTab = jest.fn(async () => ({
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-fresh',
      subscribe: jest.fn(() => dispose),
      sendFollowUp: async () => {},
      cancel: () => {},
      terminal: Promise.resolve({ status: 'completed' as const, finalAssistantContent: '' }),
    }));

    await h.view.injectCommitTurnForConversation({
      conversationId: null,
      fallbackProviderId: 'claude',
      fallbackModel: 'opus',
      prompt: 'PROMPT',
    });

    // The commit flow doesn't read the stream, so it must release the eagerly
    // registered observer instead of leaking it for the tab lifetime.
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('throws when the chat view has no tabManager', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = null;
    view.plugin = { findConversationAcrossViews: jest.fn() };
    await expect(
      view.injectCommitTurnForConversation({
        conversationId: 'conv-1',
        fallbackProviderId: 'claude',
        fallbackModel: 'opus',
        prompt: 'PROMPT',
      }),
    ).rejects.toThrow(/chat view/i);
  });
});

describe('ClaudianView.startTaskRunInFreshTab — chat-tab reservation', () => {
  it('releases the reservation once the tab is created', async () => {
    const release = jest.fn();
    const sendMessage = jest.fn(async () => ({ ok: true, finalAssistantContent: 'done' }));
    const createTaskRunTab = jest.fn(async () => ({
      id: 'tab-1',
      conversationId: 'conv-1',
      controllers: {
        inputController: { sendMessage },
        streamController: { addStreamObserver: () => () => {} },
      },
    }));
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab };

    const result = await view.startTaskRunInFreshTab({
      providerId: 'claude',
      model: 'opus',
      prompt: 'PROMPT',
      tabReservation: { release },
    });

    expect(createTaskRunTab).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    // A live handle is returned once the tab exists.
    expect(result).not.toBeNull();
  });

  it('releases the reservation when the tab cap blocks creation', async () => {
    const release = jest.fn();
    const createTaskRunTab = jest.fn(async () => null);
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab };

    const result = await view.startTaskRunInFreshTab({
      providerId: 'claude',
      model: 'opus',
      prompt: 'PROMPT',
      tabReservation: { release },
    });

    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('releases the reservation when the chat view is not ready', async () => {
    const release = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = null;

    await view.startTaskRunInFreshTab({
      providerId: 'claude',
      model: 'opus',
      prompt: 'PROMPT',
      tabReservation: { release },
    });

    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('direct chat independence from Agent Board', () => {
  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (full.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('chat feature never imports the tasks/Agent Board feature', () => {
    const chatDir = join(__dirname, '../../../../src/features/chat');
    const importsTasks = /\bfrom\s+['"][^'"]*\btasks\//;

    const offenders = collectTsFiles(chatDir).filter((file) =>
      importsTasks.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

describe('ClaudianView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
  }): {
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    view: any;
  } {
    const cancelStreaming = jest.fn();
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.register = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
      events: {
        on: jest.fn(() => () => {}),
        emit: jest.fn(),
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { cancelStreaming, eventRefs, view };
  }

  function createScopedSendHarness(options: {
    inputFocused: boolean;
  }): {
    inputEl: HTMLTextAreaElement;
    sendMessage: jest.Mock;
    view: any;
  } {
    const sendMessage = jest.fn();
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    Object.defineProperty(inputEl.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => options.inputFocused ? inputEl : null,
    });
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.register = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
      events: {
        on: jest.fn(() => () => {}),
        emit: jest.fn(),
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: false },
        dom: { inputEl },
        controllers: {
          inputController: { sendMessage },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { inputEl, sendMessage, view };
  }

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('sends from focused composer through scoped Mod+Enter', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('sends from focused composer through scoped Ctrl+Enter on non-mac', () => {
    Platform.isMacOS = false;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('ignores scoped Mod+Enter when composer is not focused', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: false });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe('ClaudianView.startTaskRunInFreshTab — stream buffering', () => {
  it('buffers chunks emitted before the runner subscribes and replays them in order', async () => {
    let rawObserver: ((chunk: { type: string }) => void) | null = null;
    const streamController = {
      addStreamObserver: (obs: (chunk: { type: string }) => void) => {
        rawObserver = obs;
        return () => { rawObserver = null; };
      },
    };
    const inputController = {
      sendMessage: jest.fn(async () => {
        // Emit synchronously during the turn — before the runner subscribes.
        rawObserver?.({ type: 'text' });
        rawObserver?.({ type: 'done' });
        return { ok: true, finalAssistantContent: 'early' };
      }),
      cancelStreaming: jest.fn(),
    };
    const tab = {
      id: 'tab-1',
      conversationId: 'conv-1',
      controllers: { inputController, streamController },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab: jest.fn(async () => tab) };

    const handle = await view.startTaskRunInFreshTab({ providerId: 'claude', model: 'opus', prompt: 'go' });
    expect(handle).not.toBeNull();

    const seen: string[] = [];
    handle.subscribe((chunk: { type: string }) => seen.push(chunk.type));
    expect(seen).toEqual(['text', 'done']);

    const terminal = await handle.terminal;
    expect(terminal.status).toBe('completed');
  });

  it('reports a failed follow-up turn via its settlement outcome', async () => {
    const streamController = { addStreamObserver: () => () => {} };
    let call = 0;
    const inputController = {
      sendMessage: jest.fn(async () => {
        call += 1;
        return call === 1
          ? { ok: true, finalAssistantContent: '' }
          : { ok: false, finalAssistantContent: '', error: 'init failed' };
      }),
      cancelStreaming: jest.fn(),
    };
    const tab = { id: 'tab-1', conversationId: 'conv-1', controllers: { inputController, streamController } };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab: jest.fn(async () => tab) };

    const handle = await view.startTaskRunInFreshTab({ providerId: 'claude', model: 'opus', prompt: 'go' });
    const outcome = await handle.sendFollowUp('reply');

    expect(outcome).toEqual({ ok: false, error: 'init failed' });
  });

  it('reports a successful follow-up turn (no stream end needed) via its outcome', async () => {
    let rawObserver: ((chunk: { type: string }) => void) | null = null;
    const streamController = {
      addStreamObserver: (obs: (chunk: { type: string }) => void) => {
        rawObserver = obs;
        return () => { rawObserver = null; };
      },
    };
    let call = 0;
    const inputController = {
      sendMessage: jest.fn(async () => {
        call += 1;
        // The first turn ends with a real done; the follow-up resolves ok but
        // emits none (e.g. the provider threw after creating the message). The
        // settlement outcome — not a synthetic chunk — carries the completion.
        if (call === 1) rawObserver?.({ type: 'done' });
        return { ok: true, finalAssistantContent: 'reply-content' };
      }),
      cancelStreaming: jest.fn(),
    };
    const tab = { id: 'tab-1', conversationId: 'conv-1', controllers: { inputController, streamController } };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab: jest.fn(async () => tab) };

    const handle = await view.startTaskRunInFreshTab({ providerId: 'claude', model: 'opus', prompt: 'go' });
    const seen: Array<{ type: string }> = [];
    handle.subscribe((chunk: { type: string }) => seen.push(chunk));
    seen.length = 0; // drop the initial turn's replayed chunks

    const outcome = await handle.sendFollowUp('reply');

    expect(outcome).toEqual({ ok: true, finalAssistantContent: 'reply-content' });
    // No synthetic stream chunk is emitted; the runner finishes from the outcome.
    expect(seen).toEqual([]);
  });

  it('reports no outcome for a queued follow-up (sendMessage signals queued)', async () => {
    const streamController = { addStreamObserver: () => () => {} };
    let call = 0;
    const inputController = {
      sendMessage: jest.fn(async () => {
        call += 1;
        // First turn settles; the reply arrives while still streaming, so the
        // controller queues it and signals `queued` (accepted, will run later).
        return call === 1
          ? { ok: true, finalAssistantContent: '' }
          : { ok: true, finalAssistantContent: '', queued: true };
      }),
      cancelStreaming: jest.fn(),
    };
    const tab = { id: 'tab-1', conversationId: 'conv-1', controllers: { inputController, streamController } };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab: jest.fn(async () => tab) };

    const handle = await view.startTaskRunInFreshTab({ providerId: 'claude', model: 'opus', prompt: 'go' });
    const outcome = await handle.sendFollowUp('reply');

    // Queued, not failed — the runner must wait for the queued turn's stream end.
    expect(outcome).toBeUndefined();
  });

  it('fails a follow-up that was not sent (sendMessage resolves undefined, no queued turn)', async () => {
    const streamController = { addStreamObserver: () => () => {} };
    let call = 0;
    const inputController = {
      sendMessage: jest.fn(async () => {
        call += 1;
        // First turn settles; the reply is a no-op (e.g. conversation switching
        // or a built-in command) — no queued turn and no stream end will arrive.
        return call === 1 ? { ok: true, finalAssistantContent: '' } : undefined;
      }),
      cancelStreaming: jest.fn(),
    };
    const tab = { id: 'tab-1', conversationId: 'conv-1', controllers: { inputController, streamController } };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = { createTaskRunTab: jest.fn(async () => tab) };

    const handle = await view.startTaskRunInFreshTab({ providerId: 'claude', model: 'opus', prompt: 'go' });
    const outcome = await handle.sendFollowUp('reply');

    // No queued turn will deliver: fail fast rather than hang until the stale timer.
    expect(outcome).toEqual({ ok: false, error: 'Follow-up turn could not be sent.' });
  });
});
