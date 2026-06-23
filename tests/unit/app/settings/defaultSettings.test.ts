import { DEFAULT_SPECORATOR_SETTINGS } from '../../../../src/app/settings/defaultSettings';

describe('logging defaults', () => {
  it('defaults logging to disabled at warn level', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.loggingEnabled).toBe(false);
    expect(DEFAULT_SPECORATOR_SETTINGS.logLevel).toBe('warn');
  });
});

describe('DEFAULT_SPECORATOR_SETTINGS', () => {
  it('seeds firstRunDismissed=false', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.firstRunDismissed).toBe(false);
  });

  it('agentBoardDefaultProvider defaults to null', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.agentBoardDefaultProvider).toBeNull();
  });

  it('agentBoardDefaultModel defaults to null', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.agentBoardDefaultModel).toBeNull();
  });
});

describe('DEFAULT_SPECORATOR_SETTINGS — queue', () => {
  it('defaults agentBoardQueueCap to 1', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.agentBoardQueueCap).toBe(1);
  });

  it('defaults agentBoardQueueHaltAfter to 3', () => {
    expect(DEFAULT_SPECORATOR_SETTINGS.agentBoardQueueHaltAfter).toBe(3);
  });
});
