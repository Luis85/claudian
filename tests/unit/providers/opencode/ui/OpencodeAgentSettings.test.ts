jest.mock('obsidian', () => ({
  Modal: class MockModal {},
  Notice: jest.fn(),
  Setting: jest.fn(),
  setIcon: jest.fn(),
}));

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirmDelete: jest.fn(),
}));

import { createOpencodeAgentPersistenceKey } from '@/providers/opencode/storage/OpencodeAgentStorage';
import type { OpencodeAgentDefinition } from '@/providers/opencode/types/agent';
import {
  findOpencodeAgentNameConflict,
  validateOpencodeAgentName,
} from '@/providers/opencode/ui/OpencodeAgentSettings';

function makeAgent(overrides: Partial<OpencodeAgentDefinition> = {}): OpencodeAgentDefinition {
  return {
    name: 'review',
    description: 'Reviews code.',
    prompt: 'Review carefully.',
    ...overrides,
  };
}

describe('validateOpencodeAgentName', () => {
  it('accepts mixed-case nested names with spaces', () => {
    expect(validateOpencodeAgentName('Security Review/Builder')).toBeNull();
  });

  it('rejects an empty name with the "required" validation key', () => {
    expect(validateOpencodeAgentName('')).toEqual({
      key: 'provider.opencode.subagent.validation.required',
    });
  });

  it('rejects leading or trailing slashes with the "slashSegments" key', () => {
    expect(validateOpencodeAgentName('/review')).toEqual({
      key: 'provider.opencode.subagent.validation.slashSegments',
    });
    expect(validateOpencodeAgentName('review/')).toEqual({
      key: 'provider.opencode.subagent.validation.slashSegments',
    });
  });

  it('rejects whitespace-only segments with the "emptySegment" key', () => {
    expect(validateOpencodeAgentName('review/   /builder')).toEqual({
      key: 'provider.opencode.subagent.validation.emptySegment',
    });
  });

  it('rejects dot path segments with the "dotSegment" key', () => {
    expect(validateOpencodeAgentName('review/../builder')).toEqual({
      key: 'provider.opencode.subagent.validation.dotSegment',
    });
  });

  it('rejects Windows-reserved filename characters with the "reservedChars" key', () => {
    expect(validateOpencodeAgentName('review:builder')).toEqual({
      key: 'provider.opencode.subagent.validation.reservedChars',
    });
  });

  it('rejects leading or trailing whitespace inside a segment with the "whitespaceSegment" key', () => {
    expect(validateOpencodeAgentName('review /builder')).toEqual({
      key: 'provider.opencode.subagent.validation.whitespaceSegment',
    });
  });
});

describe('findOpencodeAgentNameConflict', () => {
  it('detects conflicts against primary-capable agents, not just visible subagents', () => {
    const agents = [
      makeAgent({
        name: 'Builder',
        mode: 'primary',
        persistenceKey: createOpencodeAgentPersistenceKey({ filePath: '.opencode/agent/Builder.md' }),
      }),
      makeAgent({
        name: 'review',
        mode: 'subagent',
        persistenceKey: createOpencodeAgentPersistenceKey({ filePath: '.opencode/agent/review.md' }),
      }),
    ];

    expect(findOpencodeAgentNameConflict(agents, 'builder')?.name).toBe('Builder');
  });

  it('ignores the current backing file when editing in place', () => {
    const persistenceKey = createOpencodeAgentPersistenceKey({ filePath: '.opencode/agent/review.md' });
    const agents = [
      makeAgent({
        name: 'review',
        mode: 'subagent',
        persistenceKey,
      }),
    ];

    expect(findOpencodeAgentNameConflict(agents, 'review', persistenceKey)).toBeNull();
  });
});
