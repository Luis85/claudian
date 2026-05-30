import { registerAgentBoardTabFields } from '../../../../../../src/features/settings/registry/fields/agentBoard';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Agent Board tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers the Agent Board tab as always visible', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: {} } as any);
    const tab = tabs.find((t) => t.id === 'agentBoard');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('Agent Board');
    expect(tab?.order).toBe(60);
  });

  it('registers 5 sections under Agent Board in spec order', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('agentBoard', { providerConfigs: {} } as any);
    expect(sections.map((s) => s.id)).toEqual([
      'folders',
      'defaults',
      'lanes',
      'templates',
      'archive',
    ]);
  });

  it('registers agentBoardWorkOrderFolder in folders section with correct default', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('agentBoard', 'folders', { providerConfigs: {} } as any);
    const workOrderFolder = fields.find((f) => f.id === 'agentBoardWorkOrderFolder');
    expect(workOrderFolder).toBeDefined();
    expect(workOrderFolder?.label).toBe('Work order folder');
    expect(workOrderFolder?.default).toBe('Agent Board/tasks');
    expect(workOrderFolder?.sectionId).toBe('folders');
    expect(workOrderFolder?.type.kind).toBe('folder');
  });

  it('hides agentBoardDefaultModel until agentBoardDefaultProvider is set', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();

    const hiddenFields = r.getFields(
      'agentBoard',
      'defaults',
      { providerConfigs: {}, agentBoardDefaultProvider: null } as any,
    );
    expect(hiddenFields.find((f) => f.id === 'agentBoardDefaultModel')).toBeUndefined();

    const undefinedFields = r.getFields(
      'agentBoard',
      'defaults',
      { providerConfigs: {} } as any,
    );
    expect(undefinedFields.find((f) => f.id === 'agentBoardDefaultModel')).toBeUndefined();

    const visibleFields = r.getFields(
      'agentBoard',
      'defaults',
      { providerConfigs: { claude: { enabled: true } }, agentBoardDefaultProvider: 'claude' } as any,
    );
    expect(visibleFields.find((f) => f.id === 'agentBoardDefaultModel')).toBeDefined();
  });

  it('registers installCommonTemplatesButton in templates section as a button field', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('agentBoard', 'templates', { providerConfigs: {} } as any);
    const button = fields.find((f) => f.id === 'installCommonTemplatesButton');
    expect(button).toBeDefined();
    expect(button?.sectionId).toBe('templates');
    const type = button!.type;
    expect(type.kind).toBe('button');
    if (type.kind !== 'button') {
      throw new Error('installCommonTemplatesButton type must be button');
    }
    expect(type.label).toBe('Install common templates');
  });
});
