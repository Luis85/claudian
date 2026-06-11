import { registerClaudeTabFields } from '../../../../../../src/features/settings/registry/fields/claude';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

const enabled = { providerConfigs: { claude: { enabled: true } } } as any;

describe('Claude tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Claude tab only when enabled', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs(enabled);
    expect(tabs.find((t) => t.id === 'claude')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { claude: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'claude')).toBeUndefined();
  });

  it('registers the legacy tab sections in order', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('claude', enabled);
    expect(sections.map((s) => s.id)).toEqual([
      'setup',
      'safety',
      'models',
      'commands',
      'subagents',
      'mcp',
      'plugins',
      'environment',
      'experimental',
    ]);
  });

  it('replaces the flat cliPath field with the hostname-keyed cliPathsByHost widget', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const setupIds = r.getFields('claude', 'setup', enabled).map((f) => f.id);
    expect(setupIds).toContain('providerConfigs.claude.cliPathsByHost');
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.claude.cliPath')).toBeUndefined();
  });

  it('registers safety fields with the real Claude safe modes', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('claude', 'safety', enabled);
    expect(fields.map((f) => f.id)).toEqual([
      'providerConfigs.claude.safeMode',
      'providerConfigs.claude.loadUserSettings',
      'claude.trustVault',
    ]);

    const safeMode = fields.find((f) => f.id === 'providerConfigs.claude.safeMode');
    expect(safeMode?.type.kind).toBe('dropdown');
    const options = (safeMode?.type as { options: (s: unknown) => Array<{ value: string }> })
      .options(enabled)
      .map((o) => o.value);
    expect(options).toEqual(['acceptEdits', 'auto', 'default']);
    expect(safeMode?.default).toBe('acceptEdits');
  });

  it('registers the model variant toggles and custom models as widgets', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('claude', 'models', enabled);
    expect(fields.map((f) => f.id)).toEqual([
      'providerConfigs.claude.enableOpus1M',
      'providerConfigs.claude.enableSonnet1M',
      'providerConfigs.claude.customModels',
    ]);
    for (const field of fields) {
      expect(field.type.kind).toBe('custom');
    }
  });

  it('registers every workspace widget field with keywords', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const ids = r.getAllFields().filter((f) => f.tabId === 'claude').map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      'claude.slashCommands',
      'hiddenProviderCommands.claude',
      'claude.subagents',
      'claude.mcpServers',
      'claude.plugins',
      'providerConfigs.claude.environmentVariables',
      'providerConfigs.claude.enableChrome',
      'providerConfigs.claude.enableBangBash',
    ]));

    for (const field of r.getAllFields().filter((f) => f.tabId === 'claude')) {
      expect(field.keywords?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does not register a providerConfigs.claude.enabled field (lives on General tab)', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.claude.enabled')).toBeUndefined();
  });
});
