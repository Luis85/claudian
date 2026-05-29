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

  it('falls back to default when a status maps to two lanes', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready'] },
        { id: 'b', title: 'B', statuses: ['ready'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.some((e) => e.includes('more than one lane'))).toBe(true);
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
    expect(DEFAULT_BOARD_CONFIG.lanes).toHaveLength(10);
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
