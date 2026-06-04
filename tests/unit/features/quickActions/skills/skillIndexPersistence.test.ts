import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '@/core/providers/types';
import {
  parsePersistedSkillIndex,
  PERSISTED_SCHEMA_VERSION,
  serializePersistedSkillIndex,
} from '@/features/quickActions/skills/skillIndexPersistence';

function entry(overrides: Partial<ProviderCommandEntry> = {}): ProviderCommandEntry {
  return {
    id: 'skill-a',
    providerId: 'claude',
    kind: 'skill',
    name: 'a',
    description: 'd',
    content: 'long body here',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/a/SKILL.md',
    ...overrides,
  };
}

describe('skillIndexPersistence', () => {
  it('serializes buckets with content stripped', () => {
    const buckets = new Map<ProviderId, ProviderCommandEntry[]>([
      ['claude', [entry({ content: 'should be stripped' })]],
    ]);
    const json = serializePersistedSkillIndex(buckets, 1_700_000_000_000);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
    expect(parsed.writtenAt).toBe(1_700_000_000_000);
    expect(parsed.buckets.claude[0].content).toBe('');
  });

  it('round-trips via parse', () => {
    const original = new Map<ProviderId, ProviderCommandEntry[]>([
      ['codex', [entry({ providerId: 'codex', insertPrefix: '$' })]],
    ]);
    const json = serializePersistedSkillIndex(original, 1);
    const out = parsePersistedSkillIndex(json);
    expect(out).not.toBeNull();
    expect(out!.get('codex')?.[0].name).toBe('a');
  });

  it('returns null on malformed JSON', () => {
    expect(parsePersistedSkillIndex('not-json')).toBeNull();
  });

  it('returns null on schema mismatch', () => {
    const json = JSON.stringify({
      schemaVersion: 999,
      writtenAt: 0,
      buckets: { claude: [] },
    });
    expect(parsePersistedSkillIndex(json)).toBeNull();
  });

  it('returns null on missing buckets field', () => {
    const json = JSON.stringify({
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      writtenAt: 0,
    });
    expect(parsePersistedSkillIndex(json)).toBeNull();
  });
});
