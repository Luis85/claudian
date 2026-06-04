import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import type { ProviderRecord } from '@/features/quickActions/skills/types';
import { VaultSkillAggregator } from '@/features/quickActions/skills/VaultSkillAggregator';

function makeRecord(
  overrides: Partial<ProviderRecord> & {
    entries: ProviderCommandEntry[] | (() => Promise<ProviderCommandEntry[]>);
  },
): ProviderRecord {
  const { entries, ...rest } = overrides;
  return {
    providerId: 'claude',
    displayName: 'Claude',
    isEnabled: true,
    commandCatalog: {
      setRuntimeCommands: jest.fn(),
      listDropdownEntries: jest.fn().mockResolvedValue([]),
      listVaultEntries: typeof entries === 'function'
        ? (entries as () => Promise<ProviderCommandEntry[]>)
        : jest.fn().mockResolvedValue(entries),
      saveVaultEntry: jest.fn(),
      deleteVaultEntry: jest.fn(),
      getDropdownConfig: jest.fn().mockReturnValue({
        providerId: rest.providerId ?? 'claude',
        triggerChars: ['/'],
        builtInPrefix: '/',
        skillPrefix: '/',
        commandPrefix: '/',
      }),
      refresh: jest.fn(),
    },
    ...rest,
  };
}

function makeSkillEntry(overrides: Partial<ProviderCommandEntry>): ProviderCommandEntry {
  return {
    id: 'skill-default',
    providerId: 'claude',
    kind: 'skill',
    name: 'default',
    description: 'desc',
    content: '',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    ...overrides,
  };
}

describe('VaultSkillAggregator', () => {
  it('returns empty array when no providers registered', async () => {
    const agg = new VaultSkillAggregator(() => []);
    expect(await agg.listAll()).toEqual([]);
  });

  it('filters out non-skill entries', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-foo', name: 'foo' }),
          makeSkillEntry({ id: 'cmd-bar', name: 'bar', kind: 'command' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.name)).toEqual(['foo']);
  });

  it('tags entries with providerId and providerDisplayName', async () => {
    const records = [
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [
          makeSkillEntry({
            id: 'codex-skill-x',
            name: 'x',
            providerId: 'codex',
            insertPrefix: '$',
          }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.providerId).toBe('codex');
    expect(entry.providerDisplayName).toBe('Codex');
    expect(entry.id).toBe('codex:codex-skill-x');
    expect(entry.insertPrefix).toBe('$');
  });

  it('sorts skills alphabetically within each provider', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-zebra', name: 'zebra' }),
          makeSkillEntry({ id: 'skill-apple', name: 'apple' }),
          makeSkillEntry({ id: 'skill-mango', name: 'mango' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.name)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('preserves provider order from factory', async () => {
    const records = [
      makeRecord({
        providerId: 'claude',
        displayName: 'Claude',
        entries: [makeSkillEntry({ id: 'a', name: 'a' })],
      }),
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [
          makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.providerId)).toEqual(['claude', 'codex']);
  });

  it('swallows a per-provider throw and keeps others', async () => {
    const records = [
      makeRecord({
        providerId: 'claude',
        entries: () => Promise.reject(new Error('boom')),
      }),
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [
          makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.providerId)).toEqual(['codex']);
  });

  it('logs a warn breadcrumb when a provider rejects and a logger is supplied', async () => {
    const warn = jest.fn();
    const logger = { scope: jest.fn().mockReturnValue({ warn }) };
    const records = [
      makeRecord({
        providerId: 'claude',
        entries: () => Promise.reject(new Error('boom')),
      }),
    ];
    const agg = new VaultSkillAggregator(() => records, {
      logger: logger as never,
    });
    await agg.listAll();
    expect(logger.scope).toHaveBeenCalledWith('quickActions');
    expect(warn).toHaveBeenCalledWith(
      'vault skill aggregation failed',
      expect.objectContaining({ providerId: 'claude' }),
    );
  });

  it('merges empty result buckets cleanly when one provider has no skills', async () => {
    const records = [
      makeRecord({
        providerId: 'claude',
        entries: [],
      }),
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [
          makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.providerId)).toEqual(['codex']);
  });

  it('maps undefined sourceFilePath to null', async () => {
    const records = [
      makeRecord({
        entries: [makeSkillEntry({ id: 'skill-r', name: 'r' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.sourceFilePath).toBeNull();
  });

  it('passes through sourceFilePath when present', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({
            id: 'skill-r',
            name: 'r',
            sourceFilePath: '.claude/skills/r/SKILL.md',
          }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.sourceFilePath).toBe('.claude/skills/r/SKILL.md');
  });

  it('reflects providerEnabled flag onto each entry', async () => {
    const records = [
      makeRecord({
        isEnabled: false,
        entries: [makeSkillEntry({ id: 'skill-x', name: 'x' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.providerEnabled).toBe(false);
  });

  it('exposes streaming + cached + invalidate + dispose contract', () => {
    const agg = new VaultSkillAggregator(() => []);
    expect(typeof agg.listAll).toBe('function');
    expect(typeof agg.listCachedNow).toBe('function');
    expect(typeof agg.listAllStreaming).toBe('function');
    expect(typeof agg.invalidate).toBe('function');
    expect(typeof agg.dispose).toBe('function');
  });

  it('caches per-provider listVaultEntries calls within TTL', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });

    await agg.listAll();
    await agg.listAll();
    await agg.listAll();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expiry', async () => {
    let now = 1_000;
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 1_000,
      nowMs: () => now,
    });

    await agg.listAll();
    now += 500;
    await agg.listAll();
    now += 600;            // total elapsed 1100ms > ttl
    await agg.listAll();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reflects current providerEnabled on cache hit (no refetch needed)', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    let enabled = true;
    const recordsFactory = () => [
      makeRecord({
        entries: fetch,
        get isEnabled() {
          return enabled;
        },
      } as never),
    ];
    const agg = new VaultSkillAggregator(recordsFactory, { ttlMs: 60_000 });

    const [first] = await agg.listAll();
    expect(first.providerEnabled).toBe(true);

    enabled = false;
    const [second] = await agg.listAll();
    expect(second.providerEnabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);   // bucket reused
  });

  it('invalidate(providerId) clears only that bucket', async () => {
    const fetchA = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const fetchB = jest.fn().mockResolvedValue([
      makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' }),
    ]);
    const records = [
      makeRecord({ providerId: 'claude', entries: fetchA }),
      makeRecord({ providerId: 'codex', displayName: 'Codex', entries: fetchB }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    await agg.listAll();
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);

    agg.invalidate('claude');
    await agg.listAll();
    expect(fetchA).toHaveBeenCalledTimes(2);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it('invalidate() with no arg clears all buckets', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    await agg.listAll();
    agg.invalidate();
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('subscribes to EventBus vaultSkill.changed and invalidates the matching provider', async () => {
    const { EventBus } = await import('@/core/events/EventBus');
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' | 'codex' } }>();
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ providerId: 'claude', entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      eventBus: bus as never,
    });

    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(1);

    bus.emit('vaultSkill.changed', { providerId: 'claude' });
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('dispose() unsubscribes EventBus and clears caches', async () => {
    const { EventBus } = await import('@/core/events/EventBus');
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' | 'codex' } }>();
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ providerId: 'claude', entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      eventBus: bus as never,
    });

    await agg.listAll();
    agg.dispose();

    // After dispose, emit should not invalidate (cache cleared anyway, but
    // event handler must be unregistered to prevent late re-entry)
    bus.emit('vaultSkill.changed', { providerId: 'claude' });

    // Cache cleared by dispose, so this refetches
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
    // No double-invalidate from a stale handler
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
