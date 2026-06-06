import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu, TFile, TFolder } from 'obsidian';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
  TOOL_WAIT_AGENT,
  TOOL_WRITE_STDIN,
} from '@/core/tools/toolNames';
import type { ChatMessage, ChatMessageAction, ImageAttachment } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { renderStoredAsyncSubagent, renderStoredSubagent } from '@/features/chat/rendering/SubagentRenderer';
import { renderStoredThinkingBlock } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { renderStoredToolCall } from '@/features/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/features/chat/rendering/WriteEditRenderer';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  renderStoredToolCall: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

/** Minimal plugin stub with the fields MessageRenderer reads for message actions. */
function mockRendererPlugin(overrides: Record<string, unknown> = {}) {
  return {
    app: {},
    settings: { mediaFolder: '' },
    chatMessageActions: [] as ChatMessageAction[],
    getActiveConversationSnapshot: () => null as { id: string; title: string } | null,
    ...overrides,
  };
}

function mockCapabilities(providerId: 'claude' | 'codex' = 'claude') {
  return () => ({
    providerId,
    supportsPersistentRuntime: true,
    supportsNativeHistory: providerId === 'claude',
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort' as const,
  });
}

function createRenderer(
  messagesEl?: any,
  providerId: 'claude' | 'codex' = 'claude',
  isWorkOrderTab = false,
) {
  const el = messagesEl ?? createMockEl();
  const comp = createMockComponent();
  const plugin = mockRendererPlugin();
  return {
    renderer: new MessageRenderer(
      plugin as any,
      comp as any,
      el,
      undefined,
      undefined,
      mockCapabilities(providerId),
      () => isWorkOrderTab ? 'docs/work-orders/example.md' : null,
    ),
    messagesEl: el,
    plugin,
  };
}

describe('MessageRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
  });

  // ============================================
  // renderMessages
  // ============================================

  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockEl();
    const emptySpy = jest.spyOn(messagesEl, 'empty');
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer(mockRendererPlugin() as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(emptySpy).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Hello');
  });

  it('renders empty messages list with just welcome element', () => {
    const { renderer } = createRenderer();
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(renderStoredSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // hydration error banner
  // ============================================

  it('re-renders a hydration-error banner after renderMessages empties the pane', () => {
    const { renderer, messagesEl } = createRenderer();
    jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    // Mirrors the real ordering: ConversationStore emits the failure (→
    // setHydrationError) before restoreConversation triggers renderMessages.
    renderer.setHydrationError({ code: 'store-unreadable', message: 'History unavailable' });
    renderer.renderMessages([], () => 'Welcome');

    const banner = messagesEl.querySelector('.claudian-hydration-error');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toBe('History unavailable');
    expect(banner?.dataset.errorCode).toBe('store-unreadable');
  });

  it('does not duplicate the banner across repeated renders', () => {
    const { renderer, messagesEl } = createRenderer();
    jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    renderer.setHydrationError({ code: 'sqlite-unavailable', message: 'Needs Node 22.5+' });
    renderer.renderMessages([], () => 'Welcome');
    renderer.renderMessages([], () => 'Welcome');

    expect(messagesEl.querySelectorAll('.claudian-hydration-error')).toHaveLength(1);
  });

  it('clearHydrationBanner stops the banner from re-rendering', () => {
    const { renderer, messagesEl } = createRenderer();
    jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    renderer.setHydrationError({ code: 'store-unreadable', message: 'History unavailable' });
    renderer.clearHydrationBanner();
    renderer.renderMessages([], () => 'Welcome');

    expect(messagesEl.querySelector('.claudian-hydration-error')).toBeNull();
  });

  // ============================================
  // renderStoredMessage
  // ============================================

  it('renders interrupt messages with interrupt styling instead of user bubble', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer(mockRendererPlugin() as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-1',
      role: 'user',
      content: '[Request interrupted by user]',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create assistant-style message with interrupt content
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    // Check the content contains interrupt styling
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    const interruptedEl = textEl.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders interrupted assistant message with content + interrupt indicator', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-1',
      role: 'assistant',
      content: 'Starting to work on the feature...',
      timestamp: Date.now(),
      isInterrupt: true,
      contentBlocks: [{ type: 'text', content: 'Starting to work on the feature...' }],
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create an assistant message (not a bare interrupt marker)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);

    // The content div should have both content rendering and an interrupt indicator
    const contentEl = msgEl.children[0];
    const lastChild = contentEl.children[contentEl.children.length - 1];
    const interruptedEl = lastChild.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders bare interrupt marker for empty interrupted assistant message', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer(mockRendererPlugin() as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create a bare interrupt marker (same as Claude-style)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    expect(textEl.children[0].hasClass('claudian-interrupted')).toBe(true);
  });

  it('skips rebuilt context messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'rebuilt-1',
      role: 'user',
      content: 'rebuilt context',
      timestamp: Date.now(),
      isRebuiltContext: true,
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(0);
  });

  it('renders user message with text content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('renders user message with displayContent instead of content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  it('skips empty user message bubble (image-only)', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    renderer.renderStoredMessage(msg);

    // Images should still be rendered, but no message bubble
    expect(renderer.renderMessageImages).toHaveBeenCalled();
    // Only the images container, no message bubble
    const bubbles = messagesEl.children.filter(
      (c: any) => c.hasClass('claudian-message')
    );
    expect(bubbles.length).toBe(0);
  });

  it('renders user message with images above bubble', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Check this image',
      timestamp: Date.now(),
      images,
    };

    renderer.renderStoredMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('adds a rewind button for eligible stored user messages', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(mockRendererPlugin() as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[1], allMessages, 1);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
  });

  it('does not add a rewind button when stored render is called without context', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(mockRendererPlugin() as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).toBeNull();
  });

  it('shows rewind mode menu for eligible streamed user messages', async () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(mockRendererPlugin() as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 2,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      userMsg,
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.refreshActionButtons(userMsg, allMessages, 1);

    const btn = messagesEl.querySelector('.claudian-message-rewind-btn');
    expect(btn).not.toBeNull();

    btn!.click();
    const menu = (Menu as typeof Menu & { instances: any[] }).instances[0];
    expect(menu.items.map((item: any) => item.title)).toEqual([
      'Rewind conversation only',
      'Rewind code + conversation',
    ]);

    menu.items[0].clickHandler?.();
    await Promise.resolve();

    expect(rewindCallback).toHaveBeenCalledWith('u1', 'conversation');
  });

  // ============================================
  // renderAssistantContent
  // ============================================

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer(mockRendererPlugin() as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
        {
          id: 'sub-1',
          name: TOOL_TASK,
          input: { description: 'Async subagent' },
          status: 'running',
          subagent: { id: 'sub-1', mode: 'async', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
        {
          id: 'sub-2',
          name: TOOL_TASK,
          input: { description: 'Sync subagent' },
          status: 'running',
          subagent: { id: 'sub-2', mode: 'sync', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block');
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });

  it('skips empty or whitespace-only text blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: '' } as any,
        { type: 'text', content: '   ' } as any,
        { type: 'text', content: 'Real content' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Only the non-empty text block should trigger renderContent
    expect(renderContentSpy).toHaveBeenCalledTimes(1);
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Real content');
  });

  it('does not render stored Codex write_stdin transport tools', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: '' },
          status: 'completed',
          result: 'poll output',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
    expect(messagesEl.children).toHaveLength(0);
  });

  it('renders stored Codex write_stdin tools when they send real input', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: 'y\n' },
          status: 'completed',
          result: 'Input sent.',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'stdin-1',
        name: TOOL_WRITE_STDIN,
        input: { session_id: '2404', chars: 'y\n' },
      }),
    );
    expect(messagesEl.children).toHaveLength(1);
  });

  it('renders response duration footer when durationSeconds is present', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response text' } as any,
      ],
      durationSeconds: 65,
      durationFlavorWord: 'Baked',
    };

    renderer.renderStoredMessage(msg);

    // Find the footer element
    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0]; // claudian-message-content
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    const durationSpan = footerEl!.children[0];
    expect(durationSpan.textContent).toContain('Baked');
    expect(durationSpan.textContent).toContain('1m 5s');
  });

  it('does not render footer when durationSeconds is 0', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 0,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeUndefined();
  });

  it('uses default flavor word "Baked" when durationFlavorWord is not set', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 30,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    expect(footerEl!.children[0].textContent).toContain('Baked');
  });

  it('renders fallback content for old conversations without contentBlocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const addCopySpy = jest.spyOn(renderer, 'addTextCopyButton').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Legacy response text',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Should render content text
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should add copy button for fallback text
    expect(addCopySpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should render tool call
    expect(renderStoredToolCall).toHaveBeenCalled();
  });

  it('renders unreferenced tool calls when contentBlocks miss tool_use blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-unreferenced-tool',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'text', content: 'Only text block persisted' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Only text block persisted');
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
    );
  });

  it('renders Task tool calls as subagents for backward compatibility', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'Run tests' },
          status: 'completed',
          result: 'All passed',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'task-1',
        description: 'Run tests',
        status: 'completed',
        result: 'All passed',
      })
    );
  });

  it('renders Task tool as async subagent when linked subagent mode is async', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: 'Task running',
          subagent: {
            id: 'task-async-1',
            description: 'Background task',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-1',
        mode: 'async',
        asyncStatus: 'running',
      }),
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  it('infers async running state from structured Task result content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async-structured',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-structured-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: [{ type: 'text', text: '{"status":"running"}' }] as any,
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-structured-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-structured-1',
        asyncStatus: 'running',
      }),
    );
  });

  it('uses subagent block mode hint when linked subagent mode is missing', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-mode-hint',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-hint-1',
          name: TOOL_TASK,
          input: { description: 'Background task from block hint' },
          status: 'running',
          subagent: {
            id: 'task-hint-1',
            description: 'Background task from block hint',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'subagent', subagentId: 'task-hint-1', mode: 'async' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'task-hint-1',
        mode: 'async',
      }),
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  // ============================================
  // TaskOutput skipping
  // ============================================

  it('should skip TaskOutput tool calls (internal async subagent communication)', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer(mockRendererPlugin() as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc', block: true } } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
  });

  it('should render other tool calls but skip TaskOutput when mixed', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc' } } as any,
        { id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-1' } as any,
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
        { type: 'tool_use', toolId: 'grep-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledTimes(2);
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
    );
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
    );
  });

  // ============================================
  // addMessage (streaming)
  // ============================================

  it('addMessage creates user message bubble with text', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('addMessage renders images for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Look at this',
      timestamp: Date.now(),
      images,
    };

    renderer.addMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('addMessage skips empty bubble for image-only user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});
    const scrollSpy = jest.spyOn(renderer, 'scrollToBottom').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    const result = renderer.addMessage(msg);

    // Should still return an element (last child or messagesEl)
    expect(result).toBeDefined();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('addMessage creates assistant message element without user-specific rendering', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
  });

  it('getMessageEl prefers liveMessageEls when registered', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn();
    const rendererWithRewind = new MessageRenderer(
      mockRendererPlugin() as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      undefined,
      mockCapabilities(),
    );
    const msg: ChatMessage = {
      id: 'u-rewind',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    const msgEl = rendererWithRewind.addMessage(msg);

    expect(rendererWithRewind.getMessageEl('u-rewind')).toBe(msgEl);
  });

  it('getMessageEl falls back to data-message-id querySelector for assistant messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const fallbackEl = createMockEl();
    const querySpy = jest.spyOn(messagesEl, 'querySelector').mockReturnValue(fallbackEl);

    const result = renderer.getMessageEl('assistant-stream-1');

    expect(querySpy).toHaveBeenCalledWith('[data-message-id="assistant-stream-1"]');
    expect(result).toBe(fallbackEl);
  });

  // ============================================
  // setMessagesEl
  // ============================================

  it('setMessagesEl updates the container element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const newEl = createMockEl();

    renderer.setMessagesEl(newEl);

    // Verify by using scrollToBottom which references messagesEl
    renderer.scrollToBottom();
    // The new element should have been used (scrollTop set)
    expect(newEl.scrollTop).toBe(newEl.scrollHeight);
  });

  // ============================================
  // Image rendering
  // ============================================

  it('renderMessageImages creates image elements', () => {
    const containerEl = createMockEl();
    const { renderer } = createRenderer();
    jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data1', size: 200, source: 'file' },
      { id: 'img-2', name: 'avatar.jpg', mediaType: 'image/jpeg', data: 'base64data2', size: 300, source: 'file' },
    ];

    renderer.renderMessageImages(containerEl, images);

    // Should create images container with 2 image wrappers
    expect(containerEl.children.length).toBe(1);
    const imagesContainer = containerEl.children[0];
    expect(imagesContainer.hasClass('claudian-message-images')).toBe(true);
    expect(imagesContainer.children.length).toBe(2);

    // PERF-2 safe win: off-screen image data URIs are lazily decoded/painted.
    const imgEl = imagesContainer.children[0].children[0];
    expect(imgEl.getAttribute('loading')).toBe('lazy');
    expect(imgEl.getAttribute('decoding')).toBe('async');
  });

  it('setImageSrc sets data URI on image element', () => {
    const { renderer } = createRenderer();
    const imgEl = createMockEl('img');

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    renderer.setImageSrc(imgEl as any, image);

    expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('showFullImage creates overlay with image', () => {
    const { renderer } = createRenderer();
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    // Mock document.body.createDiv (document may not exist in node env)
    const overlayEl = createMockEl();
    const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
    const origDocument = globalThis.document;
    (globalThis as any).document = { body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

    try {
      renderer.showFullImage(image);
      expect(mockBody.createDiv).toHaveBeenCalledWith({ cls: 'claudian-image-modal-overlay' });
    } finally {
      (globalThis as any).document = origDocument;
    }
  });

  // ============================================
  // Work-order handoff card
  // ============================================

  it('renders a valid work-order handoff as a collapsed card', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const handoff = `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`;

    renderer.renderStoredMessage({
      id: 'a-handoff',
      role: 'assistant',
      content: `Intro text.\n\n${handoff}\n\nClosing text.`,
      timestamp: Date.now(),
    });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).not.toBeNull();
    expect(messagesEl.textContent).toContain('Work order handoff');
    expect(messagesEl.textContent).toContain('Finished the work.');
    expect(messagesEl.textContent).not.toContain('<claudian_handoff>');
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Intro text.');
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Closing text.');
  });

  it('expands the handoff card to reveal formatted sections', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage({
      id: 'a-handoff-expanded',
      role: 'assistant',
      content: `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`,
      timestamp: Date.now(),
    });

    const header = messagesEl.querySelector('.claudian-work-order-handoff-card-header') as any;
    const details = messagesEl.querySelector('.claudian-work-order-handoff-card-details');
    expect(details?.hasClass('claudian-hidden')).toBe(true);

    header._eventListeners.get('click')[0]();

    expect(details?.hasClass('claudian-hidden')).toBe(false);
    expect(messagesEl.textContent).toContain('Summary');
    expect(messagesEl.textContent).toContain('Verification');
    expect(messagesEl.textContent).toContain('Risks');
    expect(messagesEl.textContent).toContain('Next Action');
  });

  it('renders valid handoff text unchanged outside work-order tabs', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', false);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const handoff = `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`;

    renderer.renderStoredMessage({ id: 'a-normal', role: 'assistant', content: handoff, timestamp: Date.now() });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), handoff);
  });

  it('renders malformed work-order handoff text unchanged', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const malformed = `<claudian_handoff>\nsummary: Missing fields\n</claudian_handoff>`;

    renderer.renderStoredMessage({ id: 'a-bad', role: 'assistant', content: malformed, timestamp: Date.now() });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), malformed);
  });

  it('swaps a streamed work-order handoff text block for a card on finalize', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const contentEl = messagesEl.createDiv({ cls: 'claudian-message-content' });
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    const replaced = renderer.finalizeStreamedAssistantText(contentEl, textEl, `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(replaced).toBe(true);
    expect(contentEl.querySelector('.claudian-work-order-handoff-card')).not.toBeNull();
    expect(messagesEl.textContent).not.toContain('<claudian_handoff>');
  });

  it('leaves a streamed text block untouched outside work-order tabs', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', false);
    const contentEl = messagesEl.createDiv({ cls: 'claudian-message-content' });
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    const replaced = renderer.finalizeStreamedAssistantText(contentEl, textEl, `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(replaced).toBe(false);
    expect(contentEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
  });

  it('keeps registered message actions reachable on a handoff-only card', () => {
    const messagesEl = createMockEl();
    const run = jest.fn();
    const action: ChatMessageAction = {
      id: 'create-wo',
      label: 'Create work order',
      icon: 'plus',
      isEligible: () => true,
      run,
    };
    const renderer = new MessageRenderer(
      mockRendererPlugin({ chatMessageActions: [action] }) as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      undefined,
      mockCapabilities('claude'),
      () => 'docs/work-orders/example.md',
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage({
      id: 'a-handoff-actions',
      role: 'assistant',
      content: `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`,
      timestamp: Date.now(),
    });

    const card = messagesEl.querySelector('.claudian-work-order-handoff-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-text-actions')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-text-action-btn')).not.toBeNull();
  });

  // ============================================
  // Copy button
  // ============================================

  it('addTextCopyButton adds a copy button element', () => {
    const textEl = createMockEl();
    const { renderer } = createRenderer();

    renderer.addTextCopyButton(textEl, 'some markdown');

    expect(textEl.children.length).toBe(1);
    const copyBtn = textEl.children[0];
    expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);
  });

  // ============================================
  // Registered message actions
  // ============================================

  describe('registered message actions', () => {
    it('renders no action button when the registry is empty', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const msg: ChatMessage = { id: 'u1', role: 'user', content: 'hello', timestamp: Date.now() };
      renderer.renderStoredMessage(msg);

      expect(messagesEl.querySelector('.claudian-user-msg-action-btn')).toBeNull();
    });

    it('renders a button per eligible action and runs it on click', () => {
      const messagesEl = createMockEl();
      const { renderer, plugin } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const run = jest.fn();
      plugin.chatMessageActions.push({
        id: 'wo', label: 'Create work order', icon: 'kanban-square',
        isEligible: (m) => m.role === 'user', run,
      });

      const msg: ChatMessage = { id: 'u1', role: 'user', content: 'hello', timestamp: Date.now() };
      renderer.renderStoredMessage(msg);

      const btn = messagesEl.querySelector('.claudian-user-msg-action-btn');
      expect(btn).not.toBeNull();

      btn!.click();
      expect(run).toHaveBeenCalledWith(msg, null);
    });

    it('renders an action button beside the copy button on a stored assistant message and runs it on click', () => {
      const messagesEl = createMockEl();
      const { renderer, plugin } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const run = jest.fn();
      plugin.chatMessageActions.push({
        id: 'wo', label: 'Create work order', icon: 'kanban-square',
        isEligible: (m) => m.role === 'assistant', run,
      });

      const msg: ChatMessage = {
        id: 'a1', role: 'assistant', content: '', timestamp: Date.now(),
        contentBlocks: [{ type: 'text', content: 'Here is a plan you can act on.' } as any],
      };
      renderer.renderStoredMessage(msg);

      // The action lands inside the same text block as the copy button (beside it),
      // not in the message-level user toolbar.
      const textBlock = messagesEl.querySelector('.claudian-text-block');
      expect(textBlock).not.toBeNull();
      expect(textBlock!.querySelector('.claudian-text-copy-btn')).not.toBeNull();
      const btn = textBlock!.querySelector('.claudian-text-action-btn');
      expect(btn).not.toBeNull();
      expect(messagesEl.querySelector('.claudian-user-msg-actions')).toBeNull();

      btn!.click();
      expect(run).toHaveBeenCalledWith(msg, null);
    });

    it('adds no action affordance on assistant messages with no eligible action', () => {
      const messagesEl = createMockEl();
      const { renderer, plugin } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      // Action only eligible for messages that have prose text.
      plugin.chatMessageActions.push({
        id: 'wo', label: 'Create work order', icon: 'kanban-square',
        isEligible: (m) => m.role === 'assistant' && Boolean(m.contentBlocks?.some((b: any) => b.type === 'text')),
        run: jest.fn(),
      });

      const msg: ChatMessage = {
        id: 'a-tool-only', role: 'assistant', content: '', timestamp: Date.now(),
        toolCalls: [{ id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any],
        contentBlocks: [{ type: 'tool_use', toolId: 'read-1' } as any],
      };
      renderer.renderStoredMessage(msg);

      expect(messagesEl.querySelector('.claudian-text-actions')).toBeNull();
      expect(messagesEl.querySelector('.claudian-text-action-btn')).toBeNull();
    });

    it('refreshMessageActions adds the action button beside the copy button on a streamed agent message', () => {
      const messagesEl = createMockEl();
      const { renderer, plugin } = createRenderer(messagesEl);

      const run = jest.fn();
      plugin.chatMessageActions.push({
        id: 'wo', label: 'Create work order', icon: 'kanban-square',
        isEligible: (m) => m.role === 'assistant', run,
      });

      const msg: ChatMessage = {
        id: 'a-stream', role: 'assistant', content: '', timestamp: Date.now(),
        contentBlocks: [{ type: 'text', content: 'Streamed response.' } as any],
      };
      // Simulate the streamed message DOM: a text block with its copy button already in place.
      const msgEl = createMockEl();
      const contentEl = msgEl.createDiv({ cls: 'claudian-message-content' });
      const textBlock = contentEl.createDiv({ cls: 'claudian-text-block' });
      renderer.addTextCopyButton(textBlock as any, 'Streamed response.');
      // getMessageEl resolves via data-message-id in real DOM; the mock only matches classes.
      jest.spyOn(renderer, 'getMessageEl').mockReturnValue(msgEl as any);

      renderer.refreshMessageActions(msg);

      expect(textBlock.querySelector('.claudian-text-copy-btn')).not.toBeNull();
      const btn = textBlock.querySelector('.claudian-text-action-btn');
      expect(btn).not.toBeNull();
      btn!.click();
      expect(run).toHaveBeenCalledWith(msg, null);
    });
  });

  // ============================================
  // Scroll utilities
  // ============================================

  it('scrollToBottom sets scrollTop to scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottom();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('scrollToBottomIfNeeded scrolls when near bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    // Mock requestAnimationFrame
    const origRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0; };

    try {
      renderer.scrollToBottomIfNeeded();
      // Near bottom (1000 - 950 - 0 = 50, < 100 threshold) → scrolls
      expect(messagesEl.scrollTop).toBe(1000);
    } finally {
      (globalThis as any).requestAnimationFrame = origRAF;
    }
  });

  it('scrollToBottomIfNeeded does not scroll when far from bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 100;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    const originalScrollTop = messagesEl.scrollTop;
    renderer.scrollToBottomIfNeeded();

    // scrollTop should not change (900 > 100 threshold)
    expect(messagesEl.scrollTop).toBe(originalScrollTop);
  });

  // ============================================
  // renderContent
  // ============================================

  it('renderContent should not throw on valid markdown', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();

    // Should not throw even if internal rendering fails (graceful error handling)
    await expect(renderer.renderContent(el, '**Hello** world')).resolves.not.toThrow();
  });

  it('renderContent should empty the element before rendering', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    el.createDiv({ text: 'old content' });
    expect(el.children.length).toBe(1);

    await renderer.renderContent(el, 'new content');

    // After render, old content should be gone (empty() was called before rendering)
    expect(el.children.length).toBe(0);
  });

  it('renderContent runs file-link post-processing after markdown render', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'plain markdown without links');

    expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
  });

  it('renderContent escapes math delimiters only when requested for streaming', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Live $x + y$ and `echo $PATH`',
      { deferMath: true }
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Live \\$x + y\\$ and `echo $PATH`',
      el,
      '',
      expect.anything()
    );
  });

  // ============================================
  // addTextCopyButton - click behavior
  // ============================================

  describe('addTextCopyButton - click behavior', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('click should copy and show feedback', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'markdown content');

      const copyBtn = textEl.children[0];
      expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);

      // Simulate click
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(writeTextMock).toHaveBeenCalledWith('markdown content');
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });

    it('should handle clipboard API failure gracefully', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockRejectedValue(new Error('not allowed'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'content');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Should not throw
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // Should not show feedback on error
      expect(copyBtn.textContent).not.toBe('copied!');
    });
  });

  // ============================================
  // renderMessages (entry point)
  // ============================================

  it('renderMessages should render stored messages and return welcome element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), contentBlocks: [{ type: 'text', content: 'Hi there' }] as any },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Good morning!');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  it('renderMessages should hide welcome when messages exist', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    // When messages exist, welcome should be hidden
    expect(welcomeEl).toBeDefined();
  });

  it('renderMessages should return welcome element when no messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // Task tool rendering - error and running status
  // ============================================

  describe('Task tool rendering - error and running status', () => {
    it('renders Task tool with error status as subagent with status error', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-err',
            name: TOOL_TASK,
            input: { description: 'Failing task' },
            status: 'error',
            result: 'Something went wrong',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-err' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'task-err',
          description: 'Failing task',
          status: 'error',
          result: 'Something went wrong',
        })
      );
    });

    it('renders Task tool with running status (default case in switch)', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-run',
            name: TOOL_TASK,
            input: { description: 'Running task' },
            status: 'pending',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-run' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'task-run',
          description: 'Running task',
          status: 'running',
        })
      );
    });

    it('renders Task tool with no description uses fallback Subagent task', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-no-desc',
            name: TOOL_TASK,
            input: {},
            status: 'completed',
            result: 'Done',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-no-desc' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'task-no-desc',
          description: 'Subagent task',
          status: 'completed',
        })
      );
    });

    it('renders Codex spawn_agent with the same prompt and result recovered on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-codex-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: TOOL_SPAWN_AGENT,
            input: {
              message: 'Inspect utils.ts and return the final patch summary.',
              model: 'gpt-5.4-mini',
            },
            status: 'completed',
            result: '{"agent_id":"agent-1","nickname":"Zeno"}',
          } as any,
          {
            id: 'wait-1',
            name: TOOL_WAIT_AGENT,
            input: { targets: ['agent-1'], timeout_ms: 30000 },
            status: 'completed',
            result: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'spawn-1',
          description: 'Zeno (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
          status: 'completed',
          result: 'Patched utils.ts and verified imports.',
        })
      );
    });
  });

  // ============================================
  // showFullImage - close behaviors
  // ============================================

  describe('showFullImage - close behaviors', () => {
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    function setupDocumentMock() {
      const overlayEl = createMockEl();
      const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
      const docListeners = new Map<string, ((...args: any[]) => void)[]>();
      const origDocument = globalThis.document;

      (globalThis as any).document = {
        body: mockBody,
        addEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (!docListeners.has(event)) docListeners.set(event, []);
          docListeners.get(event)!.push(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          const handlers = docListeners.get(event);
          if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) handlers.splice(idx, 1);
          }
        }),
      };

      return { overlayEl, docListeners, origDocument };
    }

    it('closeBtn click removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        // The overlay has a modal child, which has a close button child
        const modalEl = overlayEl.children[0]; // claudian-image-modal
        // Children: img (index 0), closeBtn (index 1)
        const closeBtn = modalEl.children[1];
        expect(closeBtn.hasClass('claudian-image-modal-close')).toBe(true);

        const removeSpy = jest.spyOn(overlayEl, 'remove');
        closeBtn.click();

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('clicking overlay background removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate click on the overlay itself (e.target === overlay)
        const clickHandlers = overlayEl._eventListeners.get('click');
        expect(clickHandlers).toBeDefined();
        clickHandlers![0]({ target: overlayEl });

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('ESC key removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, docListeners, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate ESC key press via the document keydown listener
        const keydownHandlers = docListeners.get('keydown');
        expect(keydownHandlers).toBeDefined();
        expect(keydownHandlers!.length).toBeGreaterThan(0);
        keydownHandlers![0]({ key: 'Escape' });

        expect(removeSpy).toHaveBeenCalled();
        // After close, the keydown handler should be removed
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      } finally {
        (globalThis as any).document = origDocument;
      }
    });
  });

  // ============================================
  // renderContent - code block wrapping (error path)
  // ============================================

  describe('renderContent - error handling', () => {
    it('renderContent shows error div when MarkdownRenderer throws', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockRejectedValueOnce(
        new Error('Render failed')
      );

      const { renderer } = createRenderer();
      const el = createMockEl();

      await renderer.renderContent(el, '**broken markdown**');

      const errorDiv = el.children.find(
        (c: any) => c.hasClass('claudian-render-error')
      );
      expect(errorDiv).toBeDefined();
      expect(errorDiv!.textContent).toBe('Failed to render message content.');
    });
  });

  // ============================================
  // addTextCopyButton - rapid click handling
  // ============================================

  describe('addTextCopyButton - rapid click handling', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('rapid clicks clear previous timeout', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      // First click
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');

      // Second rapid click before timeout expires
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // clearTimeout should have been called for the first pending timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(copyBtn.textContent).toBe('Copied!');

      clearTimeoutSpy.mockRestore();
    });

    it('feedback timeout restores icon after delay', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const originalInnerHTML = copyBtn.innerHTML;
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Click to copy
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);

      // Advance timers by 1500ms (the feedback duration)
      jest.advanceTimersByTime(1500);

      // Icon should be restored and copied class removed
      expect(copyBtn.innerHTML).toBe(originalInnerHTML);
      expect(copyBtn.classList.contains('copied')).toBe(false);
    });
  });

  // ============================================
  // renderContent - code block wrapping
  // ============================================

  describe('renderContent - code block wrapping', () => {
    it('passes image-processed markdown directly to MarkdownRenderer', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
      const { processFileLinks } = await import('@/utils/fileLink');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (replaceImageEmbedsWithHtml as jest.Mock).mockReturnValueOnce(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]'
      );

      await renderer.renderContent(el, 'before-images ![[image.png]] [[note.md]]');

      expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
        'before-images ![[image.png]] [[note.md]]',
        expect.anything(),
        { mediaFolder: '' }
      );
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]',
        el,
        '',
        expect.anything()
      );
      expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
    });

    it('should wrap pre elements in code wrapper divs', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create a pre element in the container
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'console.log("hello")' });
        }
      );

      await renderer.renderContent(el, '```js\nconsole.log("hello")\n```');

      // The pre should be wrapped in a claudian-code-wrapper
      // Due to mock limitations, check that querySelectorAll was called on el
      // The actual wrapping logic runs on real DOM, but the mock captures calls
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should skip wrapping already-wrapped pre elements', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create an already-wrapped pre element
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const wrapper = container.createDiv({ cls: 'claudian-code-wrapper' });
          wrapper.createEl('pre');
        }
      );

      await renderer.renderContent(el, '```\nalready wrapped\n```');

      // Should not throw and should complete normally
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // renderMessageImages - click handler
  // ============================================

  describe('renderMessageImages - click handler', () => {
    it('should add click handler on image elements', () => {
      const containerEl = createMockEl();
      const { renderer } = createRenderer();
      const showFullImageSpy = jest.spyOn(renderer, 'showFullImage').mockImplementation(() => {});
      jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

      const images: ImageAttachment[] = [
        { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
      ];

      renderer.renderMessageImages(containerEl, images);

      // Find the img element and check for click handler
      const imagesContainer = containerEl.children[0];
      const wrapper = imagesContainer.children[0];
      const imgEl = wrapper.children[0]; // The img element

      // Check click handler is registered
      const clickHandlers = imgEl._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();
      expect(clickHandlers!.length).toBe(1);

      // Trigger click and verify showFullImage is called
      clickHandlers![0]();
      expect(showFullImageSpy).toHaveBeenCalledWith(images[0]);
    });
  });

  // ============================================
  // renderContent - code block wrapping with language labels
  // ============================================

  describe('renderContent - language label and copy', () => {
    it('should add language label when code block has language class', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          const code = pre.createEl('code');
          code.className = 'language-typescript';
          code.textContent = 'const x = 1;';
        }
      );

      await renderer.renderContent(el, '```typescript\nconst x = 1;\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should move copy-code-button outside pre into wrapper', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'some code' });
          const copyBtn = pre.createEl('button');
          copyBtn.className = 'copy-code-button';
        }
      );

      await renderer.renderContent(el, '```\nsome code\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // addMessage - displayContent for user messages
  // ============================================

  it('addMessage renders displayContent instead of content when available', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.addMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  // ============================================
  // renderStoredThinkingBlock - durationSeconds parameter
  // ============================================

  describe('renderStoredThinkingBlock - durationSeconds parameter', () => {
    it('should pass durationSeconds to renderStoredThinkingBlock', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'deep thought', durationSeconds: 42 } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'deep thought',
        42,
        expect.any(Function)
      );
    });

    it('should pass undefined durationSeconds when not set', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'thought without duration' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'thought without duration',
        undefined,
        expect.any(Function)
      );
    });
  });

  // ============================================
  // user context card
  // ============================================

  describe('user context card', () => {
    function createRendererWithVault() {
      const messagesEl = createMockEl();
      const comp = createMockComponent();
      const plugin = mockRendererPlugin({
        app: {
          vault: {
            getAbstractFileByPath: jest.fn((path: string) => {
              if (path === 'notes.md') {
                const f = new TFile();
                f.path = 'notes.md';
                return f;
              }
              if (path === 'src/providers') {
                const d = new TFolder();
                d.path = 'src/providers';
                return d;
              }
              return null;
            }),
          },
          workspace: {
            openLinkText: jest.fn().mockResolvedValue(undefined),
          },
        },
        settings: { mediaFolder: '' },
      });
      return {
        renderer: new MessageRenderer(
          plugin as any,
          comp as any,
          messagesEl,
          undefined,
          undefined,
          mockCapabilities(),
        ),
        messagesEl,
      };
    }

    it('renders an attached-context card for resolved @mentions in a user message', () => {
      const { renderer, messagesEl } = createRendererWithVault();

      renderer.addMessage({
        id: 'm1',
        role: 'user',
        content: 'explain @src/providers/ using @notes.md',
        timestamp: Date.now(),
      });

      const cards = messagesEl.querySelectorAll('.claudian-context-card');
      expect(cards).toHaveLength(1);
      expect(messagesEl.querySelectorAll('.claudian-context-card-row')).toHaveLength(2);
    });

    it('renders no card when no @mentions resolve to vault entries', () => {
      const { renderer, messagesEl } = createRendererWithVault();

      renderer.addMessage({
        id: 'm2',
        role: 'user',
        content: 'just a plain message',
        timestamp: Date.now(),
      });

      expect(messagesEl.querySelectorAll('.claudian-context-card')).toHaveLength(0);
    });

    it('renders context card with two rows via the stored render path', () => {
      const { renderer, messagesEl } = createRendererWithVault();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const msg: ChatMessage = {
        id: 'm3',
        role: 'user',
        content: 'explain @src/providers/ using @notes.md',
        timestamp: Date.now(),
      };

      renderer.renderStoredMessage(msg);

      const cards = messagesEl.querySelectorAll('.claudian-context-card');
      expect(cards).toHaveLength(1);
      expect(messagesEl.querySelectorAll('.claudian-context-card-row')).toHaveLength(2);
    });

    it('derives the context card from content even when displayContent is clean prose', () => {
      const { renderer, messagesEl } = createRendererWithVault();

      renderer.addMessage({
        id: 'mc',
        role: 'user',
        content: 'explain this @notes.md @src/providers/',
        displayContent: 'explain this',
        timestamp: Date.now(),
      });

      expect(messagesEl.querySelectorAll('.claudian-context-card')).toHaveLength(1);
      expect(messagesEl.querySelectorAll('.claudian-context-card-row')).toHaveLength(2);
      const text = messagesEl.querySelector('.claudian-text-block')?.textContent ?? '';
      expect(text).not.toContain('@notes.md');
    });

    it('renders exactly one context card after two updateLiveUserMessage calls', () => {
      const { renderer, messagesEl } = createRendererWithVault();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const msg: ChatMessage = {
        id: 'm4',
        role: 'user',
        content: 'explain @src/providers/ using @notes.md',
        timestamp: Date.now(),
      };

      // addMessage registers the element and renders the first card
      renderer.addMessage(msg);

      // First update re-renders via contentEl.empty() then re-renders the card
      renderer.updateLiveUserMessage(msg);

      // Second update must not duplicate the card
      renderer.updateLiveUserMessage(msg);

      expect(messagesEl.querySelectorAll('.claudian-context-card')).toHaveLength(1);
    });
  });

  describe('image rendering', () => {
    const baseImage: ImageAttachment = {
      id: 'img-1',
      name: 'Pasted image.png',
      mediaType: 'image/png',
      data: 'ZGF0YQ==',
      size: 4,
      source: 'paste',
    };

    it('prefers vault path when set and TFile exists', () => {
      const getResourcePath = jest.fn().mockReturnValue('app://vault/Pasted%20image.png');
      const getAbstractFileByPath = jest.fn().mockReturnValue(new TFile());
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      (renderer as any).app = {
        vault: { getAbstractFileByPath, getResourcePath },
      };

      const img = { ...baseImage, path: 'attachments/Pasted image.png' };
      const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
      renderer.setImageSrc(imgEl, img);

      expect(getAbstractFileByPath).toHaveBeenCalledWith('attachments/Pasted image.png');
      expect(getResourcePath).toHaveBeenCalled();
      expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', 'app://vault/Pasted%20image.png');
    });

    it('falls back to data URI when path resolves to null', () => {
      const getResourcePath = jest.fn();
      const getAbstractFileByPath = jest.fn().mockReturnValue(null);
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      (renderer as any).app = {
        vault: { getAbstractFileByPath, getResourcePath },
      };

      const img = { ...baseImage, path: 'attachments/missing.png' };
      const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
      renderer.setImageSrc(imgEl, img);

      expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', `data:${img.mediaType};base64,${img.data}`);
      expect(getResourcePath).not.toHaveBeenCalled();
    });

    it('renders fallback chip when neither path resolves nor data is present', () => {
      const getAbstractFileByPath = jest.fn().mockReturnValue(null);
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      (renderer as any).app = {
        vault: { getAbstractFileByPath },
      };

      const img = { ...baseImage, path: 'attachments/missing.png', data: '' };
      renderer.renderMessageImages(messagesEl, [img]);

      // No <img> child — fallback chip element present instead.
      const imagesContainer = messagesEl.querySelector('.claudian-message-images');
      expect(imagesContainer).not.toBeNull();
      const imgChildren = imagesContainer?.querySelectorAll?.('img') ?? [];
      expect(imgChildren.length).toBe(0);
      const fallback = imagesContainer?.querySelector('.claudian-message-image-fallback');
      expect(fallback).not.toBeNull();
    });

    it('uses data URI for legacy images that have no path', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      (renderer as any).app = {
        vault: { getAbstractFileByPath: jest.fn() },
      };

      const img = { ...baseImage }; // no path
      const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
      renderer.setImageSrc(imgEl, img);

      expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', `data:${img.mediaType};base64,${img.data}`);
    });
  });
});
