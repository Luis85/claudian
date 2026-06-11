import { registerCodexTabFields } from '../../../../../../src/features/settings/registry/fields/codex';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

const enabled = { providerConfigs: { codex: { enabled: true } } } as any;
const isWindowsHost = process.platform === 'win32';

describe('Codex tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Codex tab only when enabled', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs(enabled);
    expect(tabs.find((t) => t.id === 'codex')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { codex: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'codex')).toBeUndefined();
  });

  it('registers the legacy tab sections in order', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('codex', enabled);
    expect(sections.map((s) => s.id)).toEqual([
      'setup',
      'safety',
      'models',
      'skills',
      'subagents',
      'mcp',
      'environment',
    ]);
  });

  it('replaces the bogus appServerPath field with the hostname-keyed cliPathsByHost widget', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const setupIds = r.getFields('codex', 'setup', enabled).map((f) => f.id);
    expect(setupIds).toContain('providerConfigs.codex.cliPathsByHost');
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.codex.appServerPath')).toBeUndefined();
  });

  it('gates installation method and WSL distro override on Windows, matching the legacy tab', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const installationMethod = r
      .getAllFields()
      .find((f) => f.id === 'providerConfigs.codex.installationMethodsByHost');
    const wslDistro = r
      .getAllFields()
      .find((f) => f.id === 'providerConfigs.codex.wslDistroOverridesByHost');

    expect(installationMethod).toBeDefined();
    expect(wslDistro).toBeDefined();
    expect(installationMethod?.visible?.(enabled)).toBe(isWindowsHost);
    expect(wslDistro?.visible?.(enabled)).toBe(isWindowsHost);
  });

  it('registers safeMode and reasoningSummary as native dropdowns with the legacy options', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();

    const safeMode = r.getAllFields().find((f) => f.id === 'providerConfigs.codex.safeMode');
    expect(safeMode?.sectionId).toBe('safety');
    expect(safeMode?.type.kind).toBe('dropdown');
    expect(
      (safeMode?.type as { options: (s: unknown) => Array<{ value: string }> })
        .options(enabled)
        .map((o) => o.value),
    ).toEqual(['workspace-write', 'read-only']);
    expect(safeMode?.default).toBe('workspace-write');

    const reasoningSummary = r
      .getAllFields()
      .find((f) => f.id === 'providerConfigs.codex.reasoningSummary');
    expect(reasoningSummary?.sectionId).toBe('models');
    expect(reasoningSummary?.type.kind).toBe('dropdown');
    expect(
      (reasoningSummary?.type as { options: (s: unknown) => Array<{ value: string }> })
        .options(enabled)
        .map((o) => o.value),
    ).toEqual(['auto', 'concise', 'detailed', 'none']);
    expect(reasoningSummary?.default).toBe('detailed');
  });

  it('no longer registers the dead plaintext apiKey field (migrated to a secret ref)', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('codex', 'setup', enabled);
    expect(fields.map((f) => f.id)).not.toContain('providerConfigs.codex.apiKey');
  });

  it('registers providerConfigs.codex.customModels under models', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const field = r
      .getFields('codex', 'models', enabled)
      .find((f) => f.id === 'providerConfigs.codex.customModels');
    expect(field).toBeDefined();
    expect(field?.type.kind).toBe('custom');
  });

  it('registers every workspace widget field with keywords', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const ids = r.getAllFields().filter((f) => f.tabId === 'codex').map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      'codex.skills',
      'hiddenProviderCommands.codex',
      'codex.subagents',
      'codex.mcpNotice',
      'providerConfigs.codex.environmentVariables',
    ]));

    for (const field of r.getAllFields().filter((f) => f.tabId === 'codex')) {
      expect(field.keywords?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does not register a providerConfigs.codex.enabled field (lives on General tab)', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.codex.enabled')).toBeUndefined();
  });
});
