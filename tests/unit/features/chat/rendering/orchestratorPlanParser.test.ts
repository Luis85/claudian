import {
  extractOrchestratorPlan,
  type OrchestratorPlan,
} from '@/features/chat/rendering/orchestratorPlanParser';

const VALID_PLAN: OrchestratorPlan = {
  type: 'orchestrator_plan',
  tasks: [
    { id: '1', description: 'Research API', prompt: 'Survey the API surface and summarize endpoints.' },
    { id: '2', description: 'Write tests', prompt: 'Add unit tests for the parser module.' },
  ],
};

function planJson(plan: OrchestratorPlan = VALID_PLAN): string {
  return JSON.stringify(plan, null, 2);
}

describe('extractOrchestratorPlan', () => {
  it('parses a single fenced json block', () => {
    const text = `\`\`\`json\n${planJson()}\n\`\`\``;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('parses fenced block without json language tag', () => {
    const text = `\`\`\`\n${planJson()}\n\`\`\``;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('returns first valid plan when duplicate fenced blocks are present', () => {
    const invalid = '```json\n{ "type": "orchestrator_plan", "tasks": []\n```';
    const valid = `\`\`\`json\n${planJson()}\n\`\`\``;
    const text = `${invalid}\n\n${valid}\n\n${valid}`;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('tolerates trailing semicolon inside a fenced block', () => {
    const jsonWithSemicolon = `${planJson()};`;
    const text = `\`\`\`json\n${jsonWithSemicolon}\n\`\`\``;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('parses duplicate-fence assistant output (invalid first, valid second with semicolon)', () => {
    const brokenFirst = `\`\`\`json
{
  "type": "orchestrator_plan",
  "tasks": [
`;
    const validSecond = `\`\`\`json
${planJson()};
\`\`\``;
    const text = `${brokenFirst}\n\`\`\`\n\n${validSecond}`;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('parses bare orchestrator_plan object without fences', () => {
    const text = `Here is the plan:\n\n${planJson()}\n\nPlease approve.`;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('parses bare object when prose appears before the JSON', () => {
    const text = `I will delegate this goal.\n\n${planJson()}`;
    expect(extractOrchestratorPlan(text)).toEqual(VALID_PLAN);
  });

  it('returns null when no orchestrator_plan is present', () => {
    expect(extractOrchestratorPlan('Just a normal assistant reply.')).toBeNull();
  });

  it('returns null when tasks array is empty', () => {
    const text = `\`\`\`json\n{ "type": "orchestrator_plan", "tasks": [] }\n\`\`\``;
    expect(extractOrchestratorPlan(text)).toBeNull();
  });

  it('returns null when type is not orchestrator_plan', () => {
    const text = `\`\`\`json\n{ "type": "other_plan", "tasks": [{ "id": "1", "description": "x", "prompt": "y" }] }\n\`\`\``;
    expect(extractOrchestratorPlan(text)).toBeNull();
  });
});
