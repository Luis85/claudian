import { DEFAULT_CLAUDIAN_SETTINGS } from '../../../../src/app/settings/defaultSettings';

describe('logging defaults', () => {
  it('defaults logging to disabled at warn level', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.loggingEnabled).toBe(false);
    expect(DEFAULT_CLAUDIAN_SETTINGS.logLevel).toBe('warn');
  });
});

describe('DEFAULT_CLAUDIAN_SETTINGS', () => {
  it('seeds firstRunDismissed=false', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.firstRunDismissed).toBe(false);
  });

  it('agentBoardDefaultProvider defaults to null', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardDefaultProvider).toBeNull();
  });

  it('agentBoardDefaultModel defaults to null', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardDefaultModel).toBeNull();
  });
});

describe('DEFAULT_CLAUDIAN_SETTINGS — queue', () => {
  it('defaults agentBoardQueueCap to 1', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardQueueCap).toBe(1);
  });

  it('defaults agentBoardQueueHaltAfter to 3', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardQueueHaltAfter).toBe(3);
  });
});
