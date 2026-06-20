import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PreparedChatTurn } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';

// Windows CreateProcess argv and cmd.exe wrappers fail once the full command line
// grows too large (ENAMETOOLONG). cursor-agent accepts `@/path/to/prompt.txt` to
// load prompt text from disk instead of argv.
export const CURSOR_CLI_INLINE_PROMPT_MAX_CHARS = 8_000;

export interface ResolvedCursorCliPrompt {
  arg: string;
  cleanup?: () => void;
}

export interface BuildCursorAgentPromptOptions {
  turn: PreparedChatTurn;
  conversationHistory?: ChatMessage[];
  resumeSessionId?: string | null;
  boundAgentPrompt?: string;
}

/**
 * Cursor relies on `--resume` for multi-turn context. When that session id is
 * missing, rebuild prior turns into the prompt (OpenCode-style recovery).
 *
 * When a bound agent prompt is present it is appended as a clearly-delimited
 * section so the agent's instructions reach the model on every turn (Cursor is
 * one-shot per turn; re-appending each time is correct).
 */
export function buildCursorAgentPrompt(options: BuildCursorAgentPromptOptions): string {
  const {
    turn,
    conversationHistory,
    resumeSessionId,
    boundAgentPrompt,
  } = options;

  let prompt = turn.prompt;

  if (!resumeSessionId && conversationHistory && conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      turn.request.text,
      conversationHistory,
    );
  }

  if (boundAgentPrompt) {
    prompt += `\n\n# Agent Instructions\n\n${boundAgentPrompt}`;
  }

  return prompt;
}

export function resolveCursorCliPromptArg(prompt: string): ResolvedCursorCliPrompt {
  if (prompt.length <= CURSOR_CLI_INLINE_PROMPT_MAX_CHARS) {
    return { arg: prompt };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-cursor-prompt-'));
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best-effort; mode bits on Windows are not meaningful and POSIX EPERM is tolerated
    }
  }

  const filePath = path.join(dir, 'prompt.txt');
  try {
    fs.writeFileSync(filePath, prompt, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; rethrow the original write error
    }
    throw err;
  }

  return {
    arg: `@${filePath}`,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}
