import type {
  CanUseTool,
  PermissionMode as SDKPermissionMode,
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import { createMockRuntimeHost } from '@test/helpers/runtimeHost';

import type {
  ApprovalCallback,
  AskUserQuestionCallback,
} from '@/core/runtime/types';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EXIT_PLAN_MODE,
  TOOL_SKILL,
} from '@/core/tools/toolNames';
import type {
  ApprovalDecision,
  ExitPlanModeCallback,
  ExitPlanModeDecision,
} from '@/core/types';
import type { PermissionMode } from '@/core/types/settings';
import {
  type ClaudeApprovalHandlerDeps,
  createClaudeApprovalCallback,
} from '@/providers/claude/runtime/ClaudeApprovalHandler';

type CallOptions = Parameters<CanUseTool>[2];

function makeOptions(overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tu-test',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ClaudeApprovalHandlerDeps> = {}): ClaudeApprovalHandlerDeps {
  const sdkMap: Record<PermissionMode, SDKPermissionMode> = {
    normal: 'default',
    plan: 'plan',
    yolo: 'bypassPermissions',
  };
  return {
    getAllowedTools: () => null,
    host: createMockRuntimeHost(),
    getPermissionMode: () => 'normal',
    resolveSDKPermissionMode: (mode: PermissionMode) => sdkMap[mode],
    syncPermissionMode: jest.fn(),
    ...overrides,
  };
}

describe('createClaudeApprovalCallback', () => {
  it('returns a CanUseTool function', () => {
    const cb = createClaudeApprovalCallback(makeDeps());
    expect(typeof cb).toBe('function');
  });

  describe('allowed-tools gate', () => {
    it('skips the gate when allowedTools is null', async () => {
      // A null allowedTools list lets the request fall through to the host
      // approval prompt — proving the gate did not short-circuit first.
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(makeDeps({ getAllowedTools: () => null, host }));
      await cb(TOOL_BASH, { command: 'ls' }, makeOptions());
      expect(host.approval).toHaveBeenCalledWith(
        TOOL_BASH, { command: 'ls' }, expect.any(String), expect.any(Object),
      );
    });

    it('passes through tools in the allow list', async () => {
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(makeDeps({ getAllowedTools: () => [TOOL_BASH], host }));
      await cb(TOOL_BASH, {}, makeOptions());
      expect(host.approval).toHaveBeenCalled();
    });

    it('denies tools not in the allow list with the full allowed list appended', async () => {
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(
        makeDeps({ getAllowedTools: () => ['Read', 'Grep'], host }),
      );
      const result = await cb(TOOL_BASH, {}, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'deny' }
      >;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain(`Tool "${TOOL_BASH}" is not allowed`);
      expect(result.message).toContain('Allowed tools: Read, Grep.');
      // The gate denies before the host is ever consulted.
      expect(host.approval).not.toHaveBeenCalled();
    });

    it('denies with the "No tools are allowed" suffix when the allow list is empty', async () => {
      const cb = createClaudeApprovalCallback(makeDeps({ getAllowedTools: () => [] }));
      const result = await cb(TOOL_BASH, {}, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'deny' }
      >;
      expect(result.message).toContain('No tools are allowed for this query type.');
    });

    it('always allows the Skill tool through even when not on the allow list', async () => {
      // Skill bypasses the per-query allow list because user-authored skill
      // payloads define their own tool surface.
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(makeDeps({ getAllowedTools: () => ['Read'], host }));
      await cb(TOOL_SKILL, {}, makeOptions());
      expect(host.approval).toHaveBeenCalled();
    });
  });

  describe('ExitPlanMode handling', () => {
    function makeExitPlanDeps(
      callback: ExitPlanModeCallback,
      override: Partial<ClaudeApprovalHandlerDeps> = {},
    ): ClaudeApprovalHandlerDeps {
      return makeDeps({ host: createMockRuntimeHost({ exitPlanMode: callback }), ...override });
    }

    it('returns a User-cancelled deny with interrupt when the callback returns null', async () => {
      const exit: ExitPlanModeCallback = jest.fn().mockResolvedValue(null);
      const cb = createClaudeApprovalCallback(makeExitPlanDeps(exit));
      const result = await cb(TOOL_EXIT_PLAN_MODE, { plan: 'x' }, makeOptions());
      expect(result).toEqual({ behavior: 'deny', message: 'User cancelled.', interrupt: true });
    });

    it('returns a feedback deny without interrupt when the callback returns feedback', async () => {
      const decision: ExitPlanModeDecision = { type: 'feedback', text: 'tighten step 3' };
      const exit: ExitPlanModeCallback = jest.fn().mockResolvedValue(decision);
      const cb = createClaudeApprovalCallback(makeExitPlanDeps(exit));
      const result = await cb(TOOL_EXIT_PLAN_MODE, { plan: 'x' }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'tighten step 3',
        interrupt: false,
      });
    });

    it('returns allow with a session-mode setMode permission update on approval', async () => {
      const decision: ExitPlanModeDecision = { type: 'approve' };
      const exit: ExitPlanModeCallback = jest.fn().mockResolvedValue(decision);
      const syncPermissionMode = jest.fn();
      const cb = createClaudeApprovalCallback(
        makeExitPlanDeps(exit, {
          getPermissionMode: () => 'normal',
          resolveSDKPermissionMode: () => 'default',
          syncPermissionMode,
        }),
      );
      const input = { plan: 'do thing' };
      const result = await cb(TOOL_EXIT_PLAN_MODE, input, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'allow' }
      >;
      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toBe(input);
      expect(result.updatedPermissions).toEqual([
        { type: 'setMode', mode: 'default', destination: 'session' },
      ]);
      // Sync must run with both the source and resolved SDK mode so internal
      // state stays in lockstep with the SDK.
      expect(syncPermissionMode).toHaveBeenCalledWith('normal', 'default');
    });

    it('forwards the call options signal to the exit-plan callback', async () => {
      const controller = new AbortController();
      const exit: ExitPlanModeCallback = jest.fn().mockResolvedValue({ type: 'approve' });
      const cb = createClaudeApprovalCallback(makeExitPlanDeps(exit));
      await cb(TOOL_EXIT_PLAN_MODE, {}, makeOptions({ signal: controller.signal }));
      expect(exit).toHaveBeenCalledWith({}, controller.signal);
    });

    it('returns a generic deny with interrupt when the callback throws an Error', async () => {
      const exit: ExitPlanModeCallback = jest.fn().mockRejectedValue(new Error('boom'));
      const cb = createClaudeApprovalCallback(makeExitPlanDeps(exit));
      const result = await cb(TOOL_EXIT_PLAN_MODE, {}, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'Failed to handle plan mode exit: boom',
        interrupt: true,
      });
    });

    it('uses "Unknown error" when the callback rejects with a non-Error value', async () => {
      const exit: ExitPlanModeCallback = jest.fn().mockRejectedValue('string failure');
      const cb = createClaudeApprovalCallback(makeExitPlanDeps(exit));
      const result = await cb(TOOL_EXIT_PLAN_MODE, {}, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'deny' }
      >;
      expect(result.message).toBe('Failed to handle plan mode exit: Unknown error');
    });

    it('never routes ExitPlanMode through the generic approval prompt', async () => {
      // The host is always present (ADR-0001 Phase 2), so plan-exit decisions
      // are owned by host.exitPlanMode and must not fall through to approval.
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(makeDeps({ host }));
      await cb(TOOL_EXIT_PLAN_MODE, {}, makeOptions());
      expect(host.exitPlanMode).toHaveBeenCalled();
      expect(host.approval).not.toHaveBeenCalled();
    });
  });

  describe('AskUserQuestion handling', () => {
    function makeAskDeps(callback: AskUserQuestionCallback): ClaudeApprovalHandlerDeps {
      return makeDeps({ host: createMockRuntimeHost({ askUser: callback }) });
    }

    it('injects isOther: true on every question that does not declare it', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue({ q1: 'yes' });
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const input = {
        questions: [
          { question: 'one?' },
          { question: 'two?' },
        ],
      };
      await cb(TOOL_ASK_USER_QUESTION, input, makeOptions());
      expect(input.questions[0]).toMatchObject({ isOther: true });
      expect(input.questions[1]).toMatchObject({ isOther: true });
    });

    it('preserves the existing isOther flag (does not overwrite false to true)', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue({});
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const input = {
        questions: [
          { question: 'one?', isOther: false },
          { question: 'two?', isOther: true },
        ],
      };
      await cb(TOOL_ASK_USER_QUESTION, input, makeOptions());
      expect(input.questions[0].isOther).toBe(false);
      expect(input.questions[1].isOther).toBe(true);
    });

    it('skips injection when questions is not an array', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue({});
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const input = { questions: 'not an array' as unknown };
      const result = await cb(TOOL_ASK_USER_QUESTION, input, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'allow' }
      >;
      expect(result.behavior).toBe('allow');
      // Adapter still allows the call; injection is a no-op for non-array shapes.
      expect((input.questions as unknown)).toBe('not an array');
    });

    it('returns a User-declined deny with interrupt when the callback returns null', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue(null);
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const result = await cb(TOOL_ASK_USER_QUESTION, { questions: [] }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User declined to answer.',
        interrupt: true,
      });
    });

    it('returns allow with the answers merged into the existing input', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue({ q1: 'yes' });
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const result = await cb(
        TOOL_ASK_USER_QUESTION,
        { questions: [{ question: 'q1?' }] },
        makeOptions(),
      ) as Extract<PermissionResult, { behavior: 'allow' }>;
      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toMatchObject({
        questions: [{ question: 'q1?', isOther: true }],
        answers: { q1: 'yes' },
      });
    });

    it('returns a generic deny with interrupt when the callback throws', async () => {
      const ask: AskUserQuestionCallback = jest.fn().mockRejectedValue(new Error('ask failed'));
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      const result = await cb(TOOL_ASK_USER_QUESTION, { questions: [] }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'Failed to get user answers: ask failed',
        interrupt: true,
      });
    });

    it('forwards the call options signal to the ask callback', async () => {
      const controller = new AbortController();
      const ask: AskUserQuestionCallback = jest.fn().mockResolvedValue({});
      const cb = createClaudeApprovalCallback(makeAskDeps(ask));
      await cb(
        TOOL_ASK_USER_QUESTION,
        { questions: [] },
        makeOptions({ signal: controller.signal }),
      );
      const [, signal] = (ask as jest.Mock).mock.calls[0] as [unknown, AbortSignal];
      expect(signal).toBe(controller.signal);
    });

    it('never routes AskUserQuestion through the generic approval prompt', async () => {
      const host = createMockRuntimeHost();
      const cb = createClaudeApprovalCallback(makeDeps({ host }));
      await cb(TOOL_ASK_USER_QUESTION, { questions: [] }, makeOptions());
      expect(host.askUser).toHaveBeenCalled();
      expect(host.approval).not.toHaveBeenCalled();
    });
  });

  describe('default approval path', () => {
    it('returns a User-interrupted deny with interrupt on cancel', async () => {
      const approval: ApprovalCallback = jest.fn().mockResolvedValue('cancel' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const result = await cb(TOOL_BASH, { command: 'ls' }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User interrupted.',
        interrupt: true,
      });
    });

    it('returns allow with a session-destination addRules update on "allow"', async () => {
      const approval: ApprovalCallback = jest.fn().mockResolvedValue('allow' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const input = { command: 'ls' };
      const result = await cb(TOOL_BASH, input, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'allow' }
      >;
      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toBe(input);
      expect(result.updatedPermissions).toEqual([
        {
          type: 'addRules',
          behavior: 'allow',
          rules: [{ toolName: TOOL_BASH, ruleContent: 'ls' }],
          destination: 'session',
        },
      ]);
    });

    it('returns allow with a projectSettings-destination addRules update on "allow-always"', async () => {
      const approval: ApprovalCallback = jest
        .fn()
        .mockResolvedValue('allow-always' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const result = await cb(TOOL_BASH, { command: 'ls' }, makeOptions()) as Extract<
        PermissionResult,
        { behavior: 'allow' }
      >;
      expect(result.updatedPermissions?.[0]).toMatchObject({
        type: 'addRules',
        destination: 'projectSettings',
      });
    });

    it('forwards the suggestion list through buildPermissionUpdates', async () => {
      const approval: ApprovalCallback = jest.fn().mockResolvedValue('allow' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const result = await cb(
        TOOL_BASH,
        { command: 'ls' },
        makeOptions({
          suggestions: [
            {
              type: 'addRules',
              behavior: 'allow',
              rules: [{ toolName: TOOL_BASH, ruleContent: 'echo' }],
              destination: 'session',
            },
          ],
        }),
      ) as Extract<PermissionResult, { behavior: 'allow' }>;
      // When a rule suggestion is present, buildPermissionUpdates uses it instead
      // of synthesizing one from the action pattern.
      expect(result.updatedPermissions).toHaveLength(1);
      expect(result.updatedPermissions?.[0]).toMatchObject({
        type: 'addRules',
        rules: [{ toolName: TOOL_BASH, ruleContent: 'echo' }],
      });
    });

    it('returns a User-denied deny without interrupt on "deny"', async () => {
      const approval: ApprovalCallback = jest.fn().mockResolvedValue('deny' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const result = await cb(TOOL_BASH, { command: 'ls' }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User denied this action.',
        interrupt: false,
      });
    });

    it('returns a generic deny without interrupt when the callback throws', async () => {
      const approval: ApprovalCallback = jest.fn().mockRejectedValue(new Error('approval boom'));
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      const result = await cb(TOOL_BASH, { command: 'ls' }, makeOptions());
      expect(result).toEqual({
        behavior: 'deny',
        message: 'Approval request failed: approval boom',
        interrupt: false,
      });
    });

    it('forwards decisionReason, blockedPath, and agentID into the approval callback options', async () => {
      const approval: ApprovalCallback = jest.fn().mockResolvedValue('allow' as ApprovalDecision);
      const cb = createClaudeApprovalCallback(makeDeps({ host: createMockRuntimeHost({ approval }) }));
      await cb(
        TOOL_BASH,
        { command: 'ls' },
        makeOptions({
          decisionReason: 'rule miss',
          blockedPath: '/etc/passwd',
          agentID: 'agent-1',
        }),
      );
      expect(approval).toHaveBeenCalledWith(
        TOOL_BASH,
        { command: 'ls' },
        expect.any(String),
        { decisionReason: 'rule miss', blockedPath: '/etc/passwd', agentID: 'agent-1' },
      );
    });
  });

  // Cancellation: callers cancel by aborting the AbortSignal the SDK threads
  // through `options.signal`. The handler does not subscribe to the signal
  // itself; it only forwards it to the user-supplied ExitPlanMode and
  // AskUserQuestion callbacks (verified above). The default approval callback
  // is fire-and-await with no cancellation hook by contract.
});
