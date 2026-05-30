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
});
