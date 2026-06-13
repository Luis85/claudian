import type { ValidationError } from '../../../i18n/types';
import type { OpencodeAgentDefinition } from '../types/agent';

const OPENCODE_AGENT_INVALID_SEGMENT_PATTERN = /[<>:"\\|?*]/;

export function validateOpencodeAgentName(name: string): ValidationError | null {
  if (!name) {
    return { key: 'provider.opencode.subagent.validation.required' };
  }

  const segments = name.split('/');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return { key: 'provider.opencode.subagent.validation.slashSegments' };
  }

  for (const segment of segments) {
    if (!segment.trim()) {
      return { key: 'provider.opencode.subagent.validation.emptySegment' };
    }

    if (segment !== segment.trim()) {
      return { key: 'provider.opencode.subagent.validation.whitespaceSegment' };
    }

    if (segment === '.' || segment === '..') {
      return { key: 'provider.opencode.subagent.validation.dotSegment' };
    }

    if (segment.includes('\0') || OPENCODE_AGENT_INVALID_SEGMENT_PATTERN.test(segment)) {
      return { key: 'provider.opencode.subagent.validation.reservedChars' };
    }
  }

  return null;
}

export function findOpencodeAgentNameConflict(
  agents: OpencodeAgentDefinition[],
  name: string,
  currentPersistenceKey?: string,
): OpencodeAgentDefinition | null {
  const normalizedName = name.toLowerCase();
  return agents.find(
    (agent) => agent.name.toLowerCase() === normalizedName
      && agent.persistenceKey !== currentPersistenceKey,
  ) ?? null;
}
