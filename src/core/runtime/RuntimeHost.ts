import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ExitPlanModeCallback,
  SubagentRuntimeState,
} from './types';

/**
 * Host-side callbacks a provider runtime invokes during a turn.
 *
 * ADR-0001 Phase 2 (Move 3) replaces the previous seven `set*Callback`
 * methods on `ChatRuntime` with this single object, passed to the runtime
 * at construction. Three contract points:
 *
 * 1. **Always callable.** Once a runtime is constructed with a host, every
 *    method below is invocable for the life of the runtime. The host
 *    implementation is responsible for no-oping when its backing UI is
 *    not yet ready — the runtime never holds a reference to a null
 *    callback.
 * 2. **Closures over live state.** The single wiring site
 *    (`features/chat/tabs/tabControllers.ts`) builds methods that read
 *    `tab.controllers.inputController` at call time, so controller
 *    lazy-init / restart cycles do not require host re-wiring.
 * 3. **`dismissApproval` is load-bearing.** Cancel paths in Claude
 *    (`ClaudeChatRuntime.cancel()`) and Codex (`CodexChatRuntime.
 *    dismissApprovalUI()`) call it to clear pending approval UI; omitting
 *    it leaves prompts stuck on screen after a cancel/reset.
 */
export interface RuntimeHost {
  /** Tool-use approval prompt. */
  approval: ApprovalCallback;

  /** Clears any pending approval UI on cancel/reset. */
  dismissApproval(): void;

  /** Ask-user-question prompt. */
  askUser: AskUserQuestionCallback;

  /** Plan-mode exit decision prompt. */
  exitPlanMode: ExitPlanModeCallback;

  /** Permission-mode change notification (Shift+Tab in Claude, etc.). */
  permissionModeSync(sdkMode: string): void;

  /** Auto-triggered turn (e.g. background subagent completion). */
  autoTurn: AutoTurnCallback;

  /** Lazy accessor for subagent runtime state, called per dispatch. */
  getSubagentState(): SubagentRuntimeState;
}
