import { getLaneForStatus, loadBoardConfig } from '../../../../../src/features/tasks/config/BoardConfigStore';
import { DEFAULT_BOARD_CONFIG } from '../../../../../src/features/tasks/config/boardConfigTypes';

describe('loadBoardConfig', () => {
  it('returns the default config when none is set', () => {
    expect(loadBoardConfig({})).toEqual({ config: DEFAULT_BOARD_CONFIG, errors: [] });
  });

  it('keeps a valid custom config and normalizes defaults', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'running'], definitionOfReady: ['x'] }],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(errors).toEqual([]);
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[0].visible).toBe(true);
    expect(config.lanes[0].definitionOfDone).toEqual([]);
  });

  it('preserves user intent across duplicate statuses with a warning per duplicate', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready', 'done'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    // Tolerant store: the user's lanes survive verbatim so the lane editor can
    // show inline duplicate hints. Earlier behavior fell back to
    // DEFAULT_BOARD_CONFIG, which silently reverted the user's edits on every
    // settings re-render and made the UI feel frozen.
    expect(config.lanes.map((lane) => lane.id)).toEqual(['a', 'b']);
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[1].statuses).toEqual(['ready', 'done']);
    expect(errors.some((e) => e.includes('"ready"') && e.includes('more than one lane'))).toBe(true);
  });

  it('reports exactly one warning per cross-lane duplicate without collapsing lanes', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready', 'running', 'done'] },
        { id: 'c', title: 'C', statuses: ['ready', 'failed'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes.map((lane) => lane.statuses)).toEqual([
      ['ready', 'running'],
      ['ready', 'running', 'done'],
      ['ready', 'failed'],
    ]);
    // Exactly 3 warnings expected: lane b duplicates `ready` and `running`,
    // lane c duplicates `ready`. Stricter than `>= 3` so a future regression
    // that emits per-status-per-lane (or over-counts intra-lane) is caught.
    expect(errors.length).toBe(3);
  });

  it('collapses intra-lane duplicate statuses silently and still detects later cross-lane duplicates', () => {
    // A hand-edited config with `['ready', 'ready']` in one lane used to poison
    // the cross-lane duplicate detector: the first occurrence pushed a warning
    // and skipped `seen.add(...)`, so a later legitimate lane claiming `ready`
    // was wrongly accepted as unique. Now `normalizeLane` dedupes intra-lane
    // first, and `seen.add(...)` runs unconditionally.
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[1].statuses).toEqual(['ready']);
    // Exactly one cross-lane warning: lane b's `ready` conflicts with lane a.
    // The intra-lane duplicate must NOT show up as a warning of its own.
    const dupWarnings = errors.filter((e) => e.includes('more than one lane'));
    expect(dupWarnings).toHaveLength(1);
    expect(dupWarnings[0]).toContain('ready');
  });

  it('falls back to default when a lane has no title', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: '', statuses: ['ready'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('drops unknown statuses with a warning but keeps the config', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'bogus'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].statuses).toEqual(['ready']);
    expect(errors.some((e) => e.includes('bogus'))).toBe(true);
  });

  it('accepts an explicit empty lanes array', () => {
    const { config, errors } = loadBoardConfig({ agentBoardConfig: { schemaVersion: 1, lanes: [] } });
    expect(config.lanes).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('returns a frozen default that callers cannot mutate', () => {
    const { config } = loadBoardConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => config.lanes.push(config.lanes[0])).toThrow();
    expect(DEFAULT_BOARD_CONFIG.lanes).toHaveLength(11);
  });

  it('falls back to default when two lanes share an id', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'dup', title: 'A', statuses: ['ready'] },
        { id: 'dup', title: 'B', statuses: ['done'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.some((e) => e.includes('Lane id "dup"'))).toBe(true);
  });
});

describe('getLaneForStatus', () => {
  it('finds the lane owning a status, else null', () => {
    expect(getLaneForStatus(DEFAULT_BOARD_CONFIG, 'review')?.id).toBe('review');
  });

  it('returns null when no lane owns the status', () => {
    const config = {
      schemaVersion: 1 as const,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready' as const], visible: true, definitionOfReady: [], definitionOfDone: [] }],
    };
    expect(getLaneForStatus(config, 'done')).toBeNull();
  });
});
