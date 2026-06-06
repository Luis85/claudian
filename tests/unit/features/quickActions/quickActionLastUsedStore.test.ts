import {
  parsePersistedLastUsed,
  PERSISTED_SCHEMA_VERSION,
  serializePersistedLastUsed,
} from '@/features/quickActions/quickActionLastUsedStore';

describe('quickActionLastUsedStore persistence', () => {
  describe('serializePersistedLastUsed', () => {
    it('writes schemaVersion + entries map', () => {
      const map = new Map([
        ['summarize', { providerId: 'claude' as const, model: 'claude-sonnet-4-5', updatedAt: 1700000000000 }],
      ]);
      const json = serializePersistedLastUsed(map, 1700000000123);
      const parsed = JSON.parse(json);
      expect(parsed.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
      expect(parsed.writtenAt).toBe(1700000000123);
      expect(parsed.entries.summarize).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1700000000000,
      });
    });
  });

  describe('parsePersistedLastUsed', () => {
    it('returns Map for valid input', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          summarize: { providerId: 'claude', model: 'claude-sonnet-4-5', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.get('summarize')).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1,
      });
    });

    it('returns null on malformed JSON', () => {
      expect(parsePersistedLastUsed('not-json')).toBeNull();
    });

    it('returns null on schema-version mismatch', () => {
      const raw = JSON.stringify({ schemaVersion: 999, writtenAt: 0, entries: {} });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('returns null when entries missing', () => {
      const raw = JSON.stringify({ schemaVersion: PERSISTED_SCHEMA_VERSION, writtenAt: 0 });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('skips non-object entry values without throwing', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          bad: 'not-an-object',
          good: { providerId: 'claude', model: 'm', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.has('bad')).toBe(false);
      expect(out?.get('good')?.model).toBe('m');
    });
  });
});
