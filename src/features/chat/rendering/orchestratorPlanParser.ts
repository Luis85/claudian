export interface OrchestratorTask {
  id: string;
  description: string;
  prompt: string;
}

export interface OrchestratorPlan {
  type: 'orchestrator_plan';
  tasks: OrchestratorTask[];
}

const PLAN_BLOCK_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
const ORCHESTRATOR_TYPE_RE = /["']type["']\s*:\s*["']orchestrator_plan["']/;

export function extractOrchestratorPlan(text: string): OrchestratorPlan | null {
  const fromFences = extractFromFencedBlocks(text);
  if (fromFences) {
    return fromFences;
  }
  return extractFromBareObject(text);
}

function extractFromFencedBlocks(text: string): OrchestratorPlan | null {
  PLAN_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAN_BLOCK_RE.exec(text)) !== null) {
    const plan = tryParsePlan(match[1]);
    if (plan) {
      return plan;
    }
  }
  return null;
}

function extractFromBareObject(text: string): OrchestratorPlan | null {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const typeIdx = text.indexOf('"type"', searchFrom);
    if (typeIdx === -1) {
      break;
    }

    const snippet = text.slice(typeIdx, typeIdx + 80);
    if (!ORCHESTRATOR_TYPE_RE.test(snippet)) {
      searchFrom = typeIdx + 6;
      continue;
    }

    const openBrace = findObjectOpenBrace(text, typeIdx);
    if (openBrace === -1) {
      searchFrom = typeIdx + 6;
      continue;
    }

    const json = extractBalancedJson(text, openBrace);
    if (json) {
      const plan = tryParsePlan(json);
      if (plan) {
        return plan;
      }
    }

    searchFrom = typeIdx + 6;
  }

  return null;
}

function findObjectOpenBrace(text: string, beforeIndex: number): number {
  for (let i = beforeIndex; i >= 0; i--) {
    if (text[i] === '{') {
      return i;
    }
  }
  return -1;
}

function extractBalancedJson(text: string, start: number): string | null {
  if (text[start] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function normalizeJsonBeforeParse(json: string): string {
  let trimmed = json.trim();
  while (trimmed.endsWith(';')) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed;
}

function tryParsePlan(json: string): OrchestratorPlan | null {
  const normalized = normalizeJsonBeforeParse(json);
  try {
    const parsed: unknown = JSON.parse(normalized);
    return isValidPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidPlan(value: unknown): value is OrchestratorPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type !== 'orchestrator_plan') {
    return false;
  }
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    return false;
  }
  return (obj.tasks as unknown[]).every(isValidTask);
}

function isValidTask(value: unknown): value is OrchestratorTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string'
    && typeof obj.description === 'string'
    && typeof obj.prompt === 'string'
  );
}
