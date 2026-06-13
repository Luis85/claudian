import type { AskUserQuestionOption } from '../../../core/types/tools';

function extractLabel(obj: Record<string, unknown>): string {
  if (typeof obj.label === 'string') return obj.label;
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.name === 'string') return obj.name;
  return 'Option';
}

function stringifyOptionValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return 'Option';
}

function extractValue(obj: Record<string, unknown>, fallback: string): string {
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.id === 'string') return obj.id;
  return fallback;
}

/** Normalizes a raw option (object or primitive) into an AskUserQuestionOption. */
export function coerceOption(opt: unknown): AskUserQuestionOption {
  if (typeof opt === 'object' && opt !== null) {
    const obj = opt as Record<string, unknown>;
    const label = extractLabel(obj);
    const description = typeof obj.description === 'string' ? obj.description : '';
    const value = extractValue(obj, label);
    return { label, description, ...(value !== label ? { value } : {}) };
  }
  return { label: stringifyOptionValue(opt), description: '' };
}

/** Drops options whose label was already seen (first occurrence wins). */
export function deduplicateOptions(
  options: AskUserQuestionOption[],
): AskUserQuestionOption[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    if (seen.has(o.label)) return false;
    seen.add(o.label);
    return true;
  });
}
