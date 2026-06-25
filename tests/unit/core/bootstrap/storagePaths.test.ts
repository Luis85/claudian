import {
  SESSIONS_PATH,
  SPECORATOR_SETTINGS_PATH,
  SPECORATOR_STORAGE_PATH,
} from '../../../../src/core/bootstrap/StoragePaths';

describe('StoragePaths', () => {
  it('resolves the Specorator storage root', () => {
    expect(SPECORATOR_STORAGE_PATH).toBe('.specorator');
  });

  it('resolves the Specorator settings path', () => {
    expect(SPECORATOR_SETTINGS_PATH).toBe('.specorator/specorator-settings.json');
  });

  it('resolves the sessions path beneath the Specorator root', () => {
    expect(SESSIONS_PATH).toBe('.specorator/sessions');
  });
});
