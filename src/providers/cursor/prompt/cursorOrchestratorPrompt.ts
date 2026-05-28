import { resolveOrchestratorSystemPrompt } from '../../../core/prompt/orchestratorMode';

/**
 * Cursor chat has no separate system channel; orchestrator rules are prepended to the CLI prompt.
 */
export function appendOrchestratorInstructionsToCursorPrompt(
  prompt: string,
  orchestratorMode: boolean | undefined,
  orchestratorSystemPrompt?: string,
): string {
  if (!orchestratorMode) {
    return prompt;
  }
  const appendix = resolveOrchestratorSystemPrompt(orchestratorSystemPrompt);
  return `${appendix}\n\n---\n\n${prompt}`;
}
