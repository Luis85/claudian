import {
  DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT,
  getOrchestratorSystemPromptForSettings,
  persistOrchestratorSystemPromptFromSettings,
  resolveOrchestratorSystemPrompt,
} from '@/core/prompt/orchestratorMode';

describe('orchestratorMode', () => {
  it('uses built-in default when settings override is empty', () => {
    expect(resolveOrchestratorSystemPrompt('')).toBe(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT);
    expect(resolveOrchestratorSystemPrompt(undefined)).toBe(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT);
  });

  it('shows built-in default in settings when override is empty', () => {
    expect(getOrchestratorSystemPromptForSettings('')).toBe(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT);
    expect(getOrchestratorSystemPromptForSettings(undefined)).toBe(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT);
  });

  it('stores empty when settings textarea still matches built-in default', () => {
    expect(persistOrchestratorSystemPromptFromSettings(DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT)).toBe('');
    expect(persistOrchestratorSystemPromptFromSettings(`  ${DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT}  `)).toBe('');
  });

  it('stores custom orchestrator prompt when edited', () => {
    const custom = '## My orchestrator\n\nCustom rules.';
    expect(persistOrchestratorSystemPromptFromSettings(custom)).toBe(custom);
  });
});
