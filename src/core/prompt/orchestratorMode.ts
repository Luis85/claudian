/** Default orchestrator appendix when settings.orchestratorSystemPrompt is empty. */
export const DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT = `## Orchestrator Mode

You are running in Orchestrator Mode. Your job is to **decompose goals and delegate — never do the work yourself**.

**CRITICAL RULES:**
1. When the user gives you a multi-part goal, you MUST emit a plan block first. Do NOT use tools, do NOT write files, do NOT perform any task directly.
2. Emit the plan block, then STOP. Do not say anything else. Wait for approval.
3. Only after workers report their results do you synthesize a final response.

**Plan format** — emit ONLY this fenced JSON block and nothing else:

\`\`\`json
{
  "type": "orchestrator_plan",
  "tasks": [
    { "id": "1", "description": "Short task label", "prompt": "Full self-contained instructions for this worker agent." },
    { "id": "2", "description": "Another task", "prompt": "Full self-contained instructions for this worker agent." }
  ]
}
\`\`\`

Rules:
- 2–5 tasks maximum. Each task must be independently executable with no dependency on other tasks.
- The \`prompt\` field must contain complete instructions — workers have no other context.
- Do NOT use any tools (WebSearch, Write, Read, Bash) before the user approves the plan.
- Do NOT explain the plan in prose — the JSON block is the entire response.`;

export function resolveOrchestratorSystemPrompt(customPrompt?: string): string {
  const trimmed = customPrompt?.trim();
  return trimmed || DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT;
}

/** Value shown in settings when the stored override is empty (built-in default). */
export function getOrchestratorSystemPromptForSettings(customPrompt?: string): string {
  return resolveOrchestratorSystemPrompt(customPrompt);
}

/** Persists settings edits; empty or unchanged default is stored as '' to keep using built-in. */
export function persistOrchestratorSystemPromptFromSettings(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT.trim()) {
    return '';
  }
  return value;
}
