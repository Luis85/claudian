import type {
  SettingsField,
  SettingsFieldType,
  SettingsSection,
  SettingsTab,
} from '../../../../../src/features/settings/registry/SettingsField';

describe('SettingsField types', () => {
  it('accepts a minimal toggle field declaration', () => {
    const field: SettingsField<boolean> = {
      id: 'general.firstRunDismissed',
      tabId: 'general',
      sectionId: 'providers',
      label: 'First-run dismissed',
      type: { kind: 'toggle' },
      default: false,
    };
    expect(field.default).toBe(false);
  });

  it('accepts a dropdown field with options factory', () => {
    const fieldType: SettingsFieldType = {
      kind: 'dropdown',
      options: () => [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
      ],
    };
    expect(fieldType.kind).toBe('dropdown');
  });

  it('accepts tab and section declarations with order and visibility', () => {
    const tab: SettingsTab = { id: 'claude', label: 'Claude', order: 10, visible: () => true };
    const section: SettingsSection = {
      id: 'models',
      tabId: 'claude',
      label: 'Models',
      order: 20,
    };
    expect(tab.id).toBe('claude');
    expect(section.tabId).toBe('claude');
  });
});
