import type { RuntimeHost } from '@/core/runtime/RuntimeHost';

/**
 * RuntimeHost test double (ADR-0001 Phase 2). Every member is a jest mock so
 * tests assert "runtime invokes host behavior" instead of the deleted
 * "setter was called" pattern. Defaults mirror the neutral no-user answers:
 * approval resolves 'cancel', askUser/exitPlanMode resolve null.
 */
export interface MockRuntimeHost extends RuntimeHost {
  approval: jest.MockedFunction<RuntimeHost['approval']>;
  dismissApproval: jest.MockedFunction<RuntimeHost['dismissApproval']>;
  askUser: jest.MockedFunction<RuntimeHost['askUser']>;
  exitPlanMode: jest.MockedFunction<RuntimeHost['exitPlanMode']>;
  permissionModeSync: jest.MockedFunction<RuntimeHost['permissionModeSync']>;
  autoTurn: jest.MockedFunction<RuntimeHost['autoTurn']>;
  getSubagentState: jest.MockedFunction<RuntimeHost['getSubagentState']>;
}

type Returns<F extends (...args: never[]) => unknown> = ReturnType<F>;
type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

export function createMockRuntimeHost(overrides: Partial<RuntimeHost> = {}): MockRuntimeHost {
  const host: MockRuntimeHost = {
    approval: jest.fn<Returns<RuntimeHost['approval']>, Args<RuntimeHost['approval']>>(
      async () => 'cancel',
    ),
    dismissApproval: jest.fn<void, []>(),
    askUser: jest.fn<Returns<RuntimeHost['askUser']>, Args<RuntimeHost['askUser']>>(
      async () => null,
    ),
    exitPlanMode: jest.fn<Returns<RuntimeHost['exitPlanMode']>, Args<RuntimeHost['exitPlanMode']>>(
      async () => null,
    ),
    permissionModeSync: jest.fn<void, [string]>(),
    autoTurn: jest.fn<Returns<RuntimeHost['autoTurn']>, Args<RuntimeHost['autoTurn']>>(),
    getSubagentState: jest.fn<Returns<RuntimeHost['getSubagentState']>, []>(
      () => ({ hasRunning: false }),
    ),
  };
  return Object.assign(host, overrides);
}
