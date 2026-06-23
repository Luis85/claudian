import { createMockEl } from '@test/helpers/mockElement';

import {
  InlinePromptController,
  type InlinePromptControllerDeps,
} from '@/features/chat/controllers/InlinePromptController';

function setup(overrides: Partial<InlinePromptControllerDeps> = {}) {
  const inputContainerEl = createMockEl();
  const state = { needsAttention: false, planFilePath: null } as never;
  const deps: InlinePromptControllerDeps = {
    state,
    getInputContainerEl: () => inputContainerEl as never,
    renderContent: jest.fn().mockResolvedValue(undefined),
    hideThinkingIndicator: jest.fn(),
    getPlanPathPrefix: () => undefined,
    ...overrides,
  };
  return {
    controller: new InlinePromptController(deps),
    inputContainerEl,
    state: state as never as { needsAttention: boolean; planFilePath: string | null },
  };
}

describe('InlinePromptController', () => {
  describe('dismissPendingApprovalPrompt', () => {
    it('destroys and clears only the approval inline', () => {
      const { controller } = setup();
      const approval = { destroy: jest.fn() };
      const ask = { destroy: jest.fn() };
      (controller as never as { pendingApprovalInline: unknown }).pendingApprovalInline = approval;
      (controller as never as { pendingAskInline: unknown }).pendingAskInline = ask;

      controller.dismissPendingApprovalPrompt();

      expect(approval.destroy).toHaveBeenCalled();
      expect((controller as never as { pendingApprovalInline: unknown }).pendingApprovalInline).toBeNull();
      // The ask inline is untouched by the approval-only dismissal.
      expect(ask.destroy).not.toHaveBeenCalled();
    });
  });

  describe('dismissPendingApproval', () => {
    it('destroys every pending inline, clears them, and resets the attention flag', () => {
      const { controller, state } = setup();
      state.needsAttention = true;
      const approval = { destroy: jest.fn() };
      const ask = { destroy: jest.fn() };
      const exitPlan = { destroy: jest.fn() };
      const plan = { destroy: jest.fn() };
      const c = controller as never as Record<string, unknown>;
      c.pendingApprovalInline = approval;
      c.pendingAskInline = ask;
      c.pendingExitPlanModeInline = exitPlan;
      c.pendingPlanApproval = plan;

      controller.dismissPendingApproval();

      expect(approval.destroy).toHaveBeenCalled();
      expect(ask.destroy).toHaveBeenCalled();
      expect(exitPlan.destroy).toHaveBeenCalled();
      expect(plan.destroy).toHaveBeenCalled();
      expect(c.pendingApprovalInline).toBeNull();
      expect(c.pendingAskInline).toBeNull();
      expect(c.pendingExitPlanModeInline).toBeNull();
      expect(c.pendingPlanApproval).toBeNull();
      expect(state.needsAttention).toBe(false);
    });

    it('is a no-op when nothing is pending', () => {
      const { controller } = setup();
      expect(() => controller.dismissPendingApproval()).not.toThrow();
    });

    it('resets input-container visibility left hidden by an open prompt', () => {
      const { controller, inputContainerEl } = setup();
      // Simulate a prompt having hidden the input container twice.
      (controller as never as { inputContainerHideDepth: number }).inputContainerHideDepth = 2;
      inputContainerEl.addClass('specorator-hidden');

      controller.dismissPendingApproval();

      expect(inputContainerEl.hasClass('specorator-hidden')).toBe(false);
      expect((controller as never as { inputContainerHideDepth: number }).inputContainerHideDepth).toBe(0);
    });
  });

  describe('showPlanApproval', () => {
    it('resolves to no decision when the input container is detached', async () => {
      const detached = createMockEl();
      // No parentElement → detached.
      const { controller } = setup({ getInputContainerEl: () => detached as never });

      await expect(controller.showPlanApproval()).resolves.toEqual({
        decision: null,
        invalidated: false,
      });
    });
  });
});
