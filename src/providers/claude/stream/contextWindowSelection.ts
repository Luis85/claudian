import { isDefaultClaudeModel } from '../types/models';

export interface ContextWindowEntry {
  model: string;
  contextWindow: number;
}

interface ClaudeModelSignature {
  normalizedModel: string;
  family: 'haiku' | 'sonnet' | 'opus';
  is1M: boolean;
  major?: string;
  minor?: string;
  date?: string;
}

function normalizeClaudeModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const claudeIndex = normalized.indexOf('claude-');
  return claudeIndex >= 0 ? normalized.slice(claudeIndex) : normalized;
}

function parseClaudeModelSignature(model: string): ClaudeModelSignature | null {
  const normalized = normalizeClaudeModelId(model);
  if (normalized === 'haiku') {
    return { normalizedModel: normalized, family: 'haiku', is1M: false };
  }
  if (normalized === 'sonnet' || normalized === 'sonnet[1m]') {
    return { normalizedModel: normalized, family: 'sonnet', is1M: normalized.endsWith('[1m]') };
  }
  if (normalized === 'opus' || normalized === 'opus[1m]') {
    return { normalizedModel: normalized, family: 'opus', is1M: normalized.endsWith('[1m]') };
  }

  const versionedMatch = normalized.match(
    /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d+))?(?:-(\d{8}))?(?:-v\d+:\d+)?(\[1m\])?$/,
  );
  if (versionedMatch) {
    const [, familyMatch, major, minor, date, oneMillionSuffix] = versionedMatch;
    const family = familyMatch as ClaudeModelSignature['family'];
    return {
      normalizedModel: normalized,
      family,
      is1M: oneMillionSuffix === '[1m]',
      major,
      minor,
      date,
    };
  }

  return null;
}

function findUniqueEntry(
  entries: ContextWindowEntry[],
  predicate: (entry: ContextWindowEntry) => boolean,
): ContextWindowEntry | null {
  const matches = entries.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function matchClaudeModelVersionFields(
  entrySignature: ClaudeModelSignature,
  intendedSignature: ClaudeModelSignature,
): boolean {
  if (intendedSignature.major && entrySignature.major !== intendedSignature.major) {
    return false;
  }
  if (intendedSignature.minor && entrySignature.minor !== intendedSignature.minor) {
    return false;
  }
  if (intendedSignature.date && entrySignature.date !== intendedSignature.date) {
    return false;
  }
  return true;
}

function matchClaudeModelSignature(
  entrySignature: ClaudeModelSignature | null,
  intendedSignature: ClaudeModelSignature,
  options?: { ignoreIs1M?: boolean },
): boolean {
  if (!entrySignature || entrySignature.family !== intendedSignature.family) {
    return false;
  }
  if (!options?.ignoreIs1M && entrySignature.is1M !== intendedSignature.is1M) {
    return false;
  }
  return matchClaudeModelVersionFields(entrySignature, intendedSignature);
}

export function selectContextWindowEntry(
  modelUsage: Record<string, { contextWindow?: number }>,
  intendedModel?: string
): ContextWindowEntry | null {
  const entries: ContextWindowEntry[] = Object.entries(modelUsage)
    .flatMap(([model, usage]) =>
      typeof usage?.contextWindow === 'number' && usage.contextWindow > 0
        ? [{ model, contextWindow: usage.contextWindow }]
        : []
    );

  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1) {
    return entries[0];
  }

  if (!intendedModel) {
    return null;
  }

  const literalExactMatch = entries.find((entry) => entry.model === intendedModel);
  if (literalExactMatch) {
    return literalExactMatch;
  }

  const normalizedIntendedModel = normalizeClaudeModelId(intendedModel);
  const exactMatch = findUniqueEntry(entries, (entry) => normalizeClaudeModelId(entry.model) === normalizedIntendedModel);
  if (exactMatch) {
    return exactMatch;
  }

  if (!isDefaultClaudeModel(intendedModel)) {
    return null;
  }

  const intendedSignature = parseClaudeModelSignature(intendedModel);
  if (!intendedSignature) {
    return null;
  }

  const strictSignatureMatch = findUniqueEntry(entries, (entry) =>
    matchClaudeModelSignature(parseClaudeModelSignature(entry.model), intendedSignature),
  );
  if (strictSignatureMatch) {
    return strictSignatureMatch;
  }

  const hasVersionedTarget = Boolean(intendedSignature.major || intendedSignature.date);
  if (!hasVersionedTarget) {
    return null;
  }

  return findUniqueEntry(entries, (entry) =>
    matchClaudeModelSignature(parseClaudeModelSignature(entry.model), intendedSignature, { ignoreIs1M: true }),
  );
}
