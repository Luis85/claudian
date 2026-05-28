import { DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT } from '@/core/prompt/orchestratorMode';
import { appendOrchestratorInstructionsToCursorPrompt } from '@/providers/cursor/prompt/cursorOrchestratorPrompt';

describe('appendOrchestratorInstructionsToCursorPrompt', () => {
  it('returns the user prompt unchanged when orchestrator mode is off', () => {
    expect(appendOrchestratorInstructionsToCursorPrompt('Run tests', false)).toBe('Run tests');
  });

  it('prepends built-in orchestrator rules when orchestrator mode is on', () => {
    const result = appendOrchestratorInstructionsToCursorPrompt('Split into 2 workers', true);
    expect(result.startsWith(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT)).toBe(true);
    expect(result).toContain('Split into 2 workers');
    expect(result).toContain('---');
  });

  it('uses custom orchestrator system prompt from settings when set', () => {
    const custom = '## Custom orchestrator rules';
    const result = appendOrchestratorInstructionsToCursorPrompt('Goal', true, custom);
    expect(result.startsWith(custom)).toBe(true);
    expect(result).not.toContain('Orchestrator Mode');
  });
});
