import { createMockEl } from '@test/helpers/mockElement';

import type { ProviderCapabilities } from '@/core/providers/types';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
  QueuedMessageController,
  type QueuedMessageControllerDeps,
} from '@/features/chat/controllers/QueuedMessageController';
import { ChatState } from '@/features/chat/state/ChatState';
import type { QueuedMessage } from '@/features/chat/state/types';

function createCapabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    providerId: 'codex',
    supportsPersistentRuntime: true,
    supportsNativeHistory: true,
    supportsPlanMode: true,
    supportsRewind: false,
    supportsFork: true,
    supportsProviderCommands: false,
    supportsTurnSteer: true,
    reasoningControl: 'effort',
    ...overrides,
  } as ProviderCapabilities;
}

function createMockAgentService(overrides: Record<string, jest.Mock> = {}): ChatRuntime {
  return {
    providerId: 'codex',
    prepareTurn: jest.fn().mockImplementation((request: any) => ({
      request,
      persistedContent: request.text,
      isCompact: false,
    })),
    steer: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ChatRuntime;
}

function createMockFileContextManager() {
  return {
    markCurrentNoteSent: jest.fn(),
    clearAttachedPills: jest.fn(),
  };
}

function createMockImageContextManager() {
  return {
    getAttachedImages: jest.fn().mockReturnValue([]),
    setImages: jest.fn(),
  };
}

function makeQueuedMessage(content: string, overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    content,
    images: undefined,
    editorContext: null,
    browserContext: null,
    canvasContext: null,
    turnRequest: {
      text: content,
      images: undefined,
      editorSelection: null,
      browserSelection: null,
      canvasSelection: null,
    },
    ...overrides,
  };
}

interface Harness {
  controller: QueuedMessageController;
  state: ChatState;
  deps: QueuedMessageControllerDeps;
  agentService: ChatRuntime;
  inputEl: { value: string; focus: jest.Mock };
  fileContextManager: ReturnType<typeof createMockFileContextManager>;
  imageContextManager: ReturnType<typeof createMockImageContextManager>;
  requestSend: jest.Mock;
  onSteerCommitted: jest.Mock;
}

function createHarness(overrides: Partial<QueuedMessageControllerDeps> = {}): Harness {
  const state = new ChatState();
  const queueIndicatorEl = createMockEl();
  queueIndicatorEl.style.display = 'none';
  state.queueIndicatorEl = queueIndicatorEl as any;

  const inputEl = { value: '', focus: jest.fn() };
  const fileContextManager = createMockFileContextManager();
  const imageContextManager = createMockImageContextManager();
  const agentService = createMockAgentService();
  const requestSend = jest.fn();
  const onSteerCommitted = jest.fn();

  const deps: QueuedMessageControllerDeps = {
    state,
    getAgentService: () => agentService,
    getActiveCapabilities: () => createCapabilities(),
    getInputEl: () => inputEl as unknown as HTMLTextAreaElement,
    getImageContextManager: () => imageContextManager as any,
    getFileContextManager: () => fileContextManager as any,
    resetInputHeight: jest.fn(),
    requestSend,
    onSteerCommitted,
    ...overrides,
  };

  const controller = new QueuedMessageController(deps);
  return {
    controller,
    state,
    deps,
    agentService,
    inputEl,
    fileContextManager,
    imageContextManager,
    requestSend,
    onSteerCommitted,
  };
}

describe('QueuedMessageController', () => {
  describe('queue create / merge / clear', () => {
    it('creates a queued message from a turn request preserving content and images', () => {
      const { controller } = createHarness();
      const images = [{ id: 'img1', name: 'a.png' }] as any;
      const queued = controller.createQueuedMessage('hello', {
        text: 'hello',
        images,
        editorSelection: null,
        browserSelection: null,
        canvasSelection: null,
      });
      expect(queued.content).toBe('hello');
      expect(queued.images).toEqual(images);
      expect(queued.turnRequest?.text).toBe('hello');
    });

    it('merges two queued messages by concatenating display content', () => {
      const { controller } = createHarness();
      const merged = controller.mergeQueuedMessages(
        makeQueuedMessage('first'),
        makeQueuedMessage('second'),
      );
      expect(merged.content).toBe('first\n\nsecond');
    });

    it('returns a clone (not the same ref) when merging into an empty queue', () => {
      const { controller } = createHarness();
      const incoming = makeQueuedMessage('only');
      const merged = controller.mergeQueuedMessages(null, incoming);
      expect(merged.content).toBe('only');
      expect(merged).not.toBe(incoming);
      expect(merged.turnRequest).not.toBe(incoming.turnRequest);
    });

    it('clears the queued message and refreshes the indicator', () => {
      const { controller, state } = createHarness();
      state.queuedMessage = makeQueuedMessage('queued');
      controller.clearQueuedMessage();
      expect(state.queuedMessage).toBeNull();
      expect((state.queueIndicatorEl as any).style.display).toBe('none');
    });

    it('shows the queue indicator with queued text', () => {
      const { controller, state } = createHarness();
      state.queuedMessage = makeQueuedMessage('queued text');
      controller.updateQueueIndicator();
      const el = state.queueIndicatorEl as any;
      expect(el.querySelector('.specorator-queue-indicator-text')?.textContent)
        .toBe('⌙ Queued: queued text');
      expect(el.style.display).toBe('flex');
    });
  });

  describe('processQueuedMessage', () => {
    it('dequeues and dispatches the snapshot through requestSend', () => {
      jest.useFakeTimers();
      try {
        const { controller, state, requestSend } = createHarness();
        state.queuedMessage = makeQueuedMessage('go now');

        controller.processQueuedMessage();
        expect(state.queuedMessage).toBeNull();

        jest.runAllTimers();
        expect(requestSend).toHaveBeenCalledWith(expect.objectContaining({
          content: 'go now',
          turnRequestOverride: expect.objectContaining({ text: 'go now' }),
        }));
      } finally {
        jest.useRealTimers();
      }
    });

    it('no-ops when there is no queued message', () => {
      jest.useFakeTimers();
      try {
        const { controller, requestSend } = createHarness();
        controller.processQueuedMessage();
        jest.runAllTimers();
        expect(requestSend).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('steering', () => {
    function setupSteerable(steerOverrides: Record<string, jest.Mock> = {}) {
      const agentService = createMockAgentService(steerOverrides);
      const harness = createHarness({ getAgentService: () => agentService });
      harness.state.isStreaming = true;
      return { ...harness, agentService };
    }

    it('steers the queued message and records it as committed on success', async () => {
      const { controller, state, onSteerCommitted, agentService } = setupSteerable();
      state.queuedMessage = makeQueuedMessage('steer me');

      await (controller as any).steerQueuedMessage();

      expect(agentService.steer).toHaveBeenCalled();
      expect(state.queuedMessage).toBeNull();
      expect(onSteerCommitted).toHaveBeenCalledWith(expect.objectContaining({
        displayContent: 'steer me',
      }));
      // pending steer state is left in flight until the host reconciles the boundary
      expect((controller as any).pendingSteerMessage).not.toBeNull();
    });

    it('guards against concurrent steer while one is in flight', async () => {
      let resolveSteer: (v: boolean) => void = () => {};
      const steer = jest.fn().mockReturnValue(new Promise<boolean>((r) => { resolveSteer = r; }));
      const { controller, state, agentService } = setupSteerable({ steer });
      state.queuedMessage = makeQueuedMessage('first steer');

      const firstCall = (controller as any).steerQueuedMessage();
      // queuedMessage consumed; a re-queued message must not start a second steer
      state.queuedMessage = makeQueuedMessage('second steer');
      await (controller as any).steerQueuedMessage();

      expect(agentService.steer).toHaveBeenCalledTimes(1);

      resolveSteer(true);
      await firstCall;
    });

    it('re-checks cancellation after the async steer and does not commit', async () => {
      let resolveSteer: (v: boolean) => void = () => {};
      const steer = jest.fn().mockReturnValue(new Promise<boolean>((r) => { resolveSteer = r; }));
      const { controller, state, onSteerCommitted } = setupSteerable({ steer });
      state.queuedMessage = makeQueuedMessage('mid-cancel');

      const call = (controller as any).steerQueuedMessage();
      // user cancels while the steer is awaiting acceptance
      state.cancelRequested = true;
      resolveSteer(true);
      await call;

      expect(onSteerCommitted).not.toHaveBeenCalled();
    });

    it('restores the message to the queue on steer rejection while streaming', async () => {
      const steer = jest.fn().mockResolvedValue(false);
      const { controller, state, onSteerCommitted } = setupSteerable({ steer });
      state.queuedMessage = makeQueuedMessage('rejected steer');

      await (controller as any).steerQueuedMessage();

      expect(onSteerCommitted).not.toHaveBeenCalled();
      expect(state.queuedMessage).not.toBeNull();
      expect(state.queuedMessage?.content).toBe('rejected steer');
      expect((controller as any).pendingSteerMessage).toBeNull();
      expect((controller as any).steerInFlight).toBe(false);
    });

    it('restores the message to the composer on steer rejection when no longer streaming', async () => {
      const steer = jest.fn().mockImplementation(async () => false);
      const harness = createHarness({ getAgentService: () => createMockAgentService({ steer }) });
      harness.state.isStreaming = true;
      harness.state.queuedMessage = makeQueuedMessage('rejected steer');

      // Streaming ends concurrently before the rejection lands.
      const call = (harness.controller as any).steerQueuedMessage();
      harness.state.isStreaming = false;
      await call;

      expect(harness.inputEl.value).toBe('rejected steer');
      expect(harness.state.queuedMessage).toBeNull();
    });

    it('does not steer when the provider lacks turn-steer support', async () => {
      const agentService = createMockAgentService();
      const harness = createHarness({
        getAgentService: () => agentService,
        getActiveCapabilities: () => createCapabilities({ supportsTurnSteer: false }),
      });
      harness.state.isStreaming = true;
      harness.state.queuedMessage = makeQueuedMessage('no steer');

      await (harness.controller as any).steerQueuedMessage();

      expect(agentService.steer).not.toHaveBeenCalled();
      expect(harness.state.queuedMessage).not.toBeNull();
    });
  });

  describe('restorePendingSteerMessageToQueue', () => {
    it('folds an unreconciled pending steer message back into the queue', () => {
      const { controller, state } = createHarness();
      (controller as any).pendingSteerMessage = makeQueuedMessage('pending steer');
      (controller as any).steerInFlight = true;
      state.queuedMessage = makeQueuedMessage('still queued');

      controller.restorePendingSteerMessageToQueue();

      expect(state.queuedMessage?.content).toBe('pending steer\n\nstill queued');
      expect((controller as any).pendingSteerMessage).toBeNull();
      expect((controller as any).steerInFlight).toBe(false);
    });

    it('is a no-op when there is no pending steer message', () => {
      const { controller, state } = createHarness();
      state.queuedMessage = makeQueuedMessage('only queued');
      controller.restorePendingSteerMessageToQueue();
      expect(state.queuedMessage?.content).toBe('only queued');
    });
  });

  describe('restorePendingMessagesToInput', () => {
    it('merges pending steer and queued messages back into the composer on cancel', () => {
      const { controller, state, inputEl } = createHarness();
      (controller as any).pendingSteerMessage = makeQueuedMessage('steer part');
      state.queuedMessage = makeQueuedMessage('queue part');

      controller.restorePendingMessagesToInput();

      expect(inputEl.value).toBe('steer part\n\nqueue part');
      expect(state.queuedMessage).toBeNull();
      expect((controller as any).pendingSteerMessage).toBeNull();
      expect((controller as any).steerInFlight).toBe(false);
    });
  });

  describe('withdrawQueuedMessageToComposer', () => {
    it('moves the queued message into the input and clears the queue', () => {
      const { controller, state, inputEl } = createHarness();
      state.queuedMessage = makeQueuedMessage('withdraw me');

      controller.withdrawQueuedMessageToComposer();

      expect(inputEl.value).toBe('withdraw me');
      expect(state.queuedMessage).toBeNull();
    });
  });
});
