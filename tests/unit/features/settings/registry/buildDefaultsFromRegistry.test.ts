import { buildDefaultsFromRegistry } from '../../../../../src/features/settings/registry/buildDefaultsFromRegistry';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

describe('buildDefaultsFromRegistry', () => {
  it('returns an empty object for an empty registry', () => {
    expect(buildDefaultsFromRegistry(new SettingsRegistry())).toEqual({});
  });

  it('seeds top-level and nested defaults from registered fields', () => {
    const r = new SettingsRegistry();
    r.registerField({
      id: 'maxTabs',
      tabId: 'general',
      sectionId: 's',
      label: 'Max',
      type: { kind: 'number' },
      default: 3,
    });
    r.registerField({
      id: 'agentBoard.workOrderFolder',
      tabId: 'agentBoard',
      sectionId: 's',
      label: 'Folder',
      type: { kind: 'text' },
      default: 'Agent Board/tasks',
    });
    expect(buildDefaultsFromRegistry(r)).toEqual({
      maxTabs: 3,
      agentBoard: { workOrderFolder: 'Agent Board/tasks' },
    });
  });
});
