import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../../../src/features/settings/registry/registry';

describe('settings registry singleton', () => {
  beforeEach(() => resetSettingsRegistryForTests());

  it('returns the same instance across calls', () => {
    const a = getSettingsRegistry();
    const b = getSettingsRegistry();
    expect(a).toBe(b);
  });

  it('reset clears all state', () => {
    const a = getSettingsRegistry();
    a.registerTab({ id: 't', label: 'T', order: 1, visible: () => true });
    resetSettingsRegistryForTests();
    const b = getSettingsRegistry();
    expect(b).not.toBe(a);
  });
});
