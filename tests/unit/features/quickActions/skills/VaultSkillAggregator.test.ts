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
});
