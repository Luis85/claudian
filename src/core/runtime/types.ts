import type { BrowserSelectionContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import type { EditorSelectionContext } from '../../utils/editor';
import type {
  ApprovalDecision,
  Conversation,
  ExitPlanModeCallback,
  ImageAttachment,
  StreamChunk,
} from '../types';

export interface ApprovalDecisionOption {
  label: string;
  description?: string;
  value: string;
  decision?: ApprovalDecision;
}

export interface ApprovalNetworkContext {
  host: string;
  protocol: string;
}

export interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
  decisionOptions?: ApprovalDecisionOption[];
  networkApprovalContext?: ApprovalNetworkContext;
  additionalPermissions?: unknown;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
  options?: ApprovalCallbackOptions,
) => Promise<ApprovalDecision>;

export type AskUserQuestionCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, string | string[]> | null>;

export interface ChatTurnRequest {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  externalContextPaths?: string[];
  enabledMcpServers?: Set<string>;
}

export interface PreparedChatTurn {
  request: ChatTurnRequest;
  persistedContent: string;
  prompt: string;
  isCompact: boolean;
  mcpMentions: Set<string>;
}

export interface ChatRuntimeQueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
  /** System prompt appendix sourced from the conversation's bound roster agent. Claude-only. */
  boundAgentPrompt?: string;
  /** Model override sourced from the conversation's bound roster agent. Beats settings.model but loses to an explicit tab/work-order override. Claude-only. */
  boundAgentModel?: string;
}

export interface ChatRuntimeEnsureReadyOptions {
  allowSessionCreation?: boolean;
  force?: boolean;
}

export type ChatRuntimeConversationState = Pick<
  Conversation,
  'sessionId' | 'providerState'
>;

export interface SessionUpdateResult {
  updates: Partial<Conversation>;
}

export interface ChatRewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

export type ChatRewindMode = 'conversation' | 'code-and-conversation';

export interface SubagentRuntimeState {
  hasRunning: boolean;
}

export interface ChatTurnMetadata {
  userMessageId?: string;
  assistantMessageId?: string;
  wasSent?: boolean;
  planCompleted?: boolean;
  /**
   * Text the controller should auto-send as a resumed follow-up turn once this
   * turn completes. Cursor uses it to deliver an AskUserQuestion answer back to
   * the agent: its one-shot CLI cannot answer the tool in-process, so the
   * collected answer continues the conversation as the next (resumed) turn.
   */
  autoFollowUpText?: string;
}

export interface AutoTurnResult {
  chunks: StreamChunk[];
  metadata: ChatTurnMetadata;
}

export type AutoTurnCallback = (result: AutoTurnResult) => void | Promise<void>;

export type {
  ApprovalDecision,
  ExitPlanModeCallback,
};
