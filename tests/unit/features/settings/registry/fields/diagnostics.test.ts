import { registerDiagnosticsTabFields } from '../../../../../../src/features/settings/registry/fields/diagnostics';
import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../../../../src/features/settings/registry/registry';

describe('Diagnostics tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers the Diagnostics tab as always visible', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: {} } as any);
    const tab = tabs.find((t) => t.id === 'diagnostics');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('Diagnostics');
    expect(tab?.order).toBe(80);
    expect(tab?.visible({ providerConfigs: {} } as any)).toBe(true);
  });

  it('registers 2 sections under Diagnostics in spec order', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('diagnostics', { providerConfigs: {} } as any);
    expect(sections.map((s) => s.id)).toEqual(['logging', 'actions']);
  });

  it('registers loggingEnabled in logging section as a toggle with false default', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('diagnostics', 'logging', {
      providerConfigs: {},
      loggingEnabled: true,
    } as any);
    const enabled = fields.find((f) => f.id === 'loggingEnabled');
    expect(enabled).toBeDefined();
    expect(enabled?.label).toBe('Enable logging');
    expect(enabled?.default).toBe(false);
    expect(enabled?.sectionId).toBe('logging');
    expect(enabled?.type.kind).toBe('toggle');
  });

  it('registers logLevel in logging section as a dropdown with warn default', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('diagnostics', 'logging', {
      providerConfigs: {},
      loggingEnabled: true,
    } as any);
    const level = fields.find((f) => f.id === 'logLevel');
    expect(level).toBeDefined();
    expect(level?.label).toBe('Log level');
    expect(level?.default).toBe('warn');
    expect(level?.sectionId).toBe('logging');
    expect(level?.type.kind).toBe('dropdown');
  });

  it('logLevel dropdown options expose all five log levels in spec order', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('diagnostics', 'logging', {
      providerConfigs: {},
      loggingEnabled: true,
    } as any);
    const level = fields.find((f) => f.id === 'logLevel');
    expect(level).toBeDefined();
    const type = level!.type;
    if (type.kind !== 'dropdown') {
      throw new Error('logLevel type must be dropdown');
    }
    const options = type.options({ providerConfigs: {} } as any);
    expect(options).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'error', label: 'Error' },
      { value: 'warn', label: 'Warn' },
      { value: 'info', label: 'Info' },
      { value: 'debug', label: 'Debug' },
    ]);
  });

  it('hides logLevel when loggingEnabled is false and shows it when true', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();

    const disabled = r.getFields('diagnostics', 'logging', {
      providerConfigs: {},
      loggingEnabled: false,
    } as any);
    expect(disabled.map((f) => f.id)).toContain('loggingEnabled');
    expect(disabled.map((f) => f.id)).not.toContain('logLevel');

    const enabled = r.getFields('diagnostics', 'logging', {
      providerConfigs: {},
      loggingEnabled: true,
    } as any);
    expect(enabled.map((f) => f.id)).toEqual(expect.arrayContaining(['loggingEnabled', 'logLevel']));
  });

  it('registers copyDiagnosticLogs in actions section as a button field', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('diagnostics', 'actions', { providerConfigs: {} } as any);
    const button = fields.find((f) => f.id === 'copyDiagnosticLogs');
    expect(button).toBeDefined();
    expect(button?.label).toBe('Copy logs');
    expect(button?.sectionId).toBe('actions');
    const type = button!.type;
    expect(type.kind).toBe('button');
    if (type.kind !== 'button') {
      throw new Error('copyDiagnosticLogs type must be button');
    }
    expect(type.label).toBe('Copy diagnostic logs');
  });

  it('registers clearDiagnosticLogs in actions section as a button field', () => {
    registerDiagnosticsTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('diagnostics', 'actions', { providerConfigs: {} } as any);
    const button = fields.find((f) => f.id === 'clearDiagnosticLogs');
    expect(button).toBeDefined();
    expect(button?.label).toBe('Clear logs');
    expect(button?.sectionId).toBe('actions');
    const type = button!.type;
    expect(type.kind).toBe('button');
    if (type.kind !== 'button') {
      throw new Error('clearDiagnosticLogs type must be button');
    }
    expect(type.label).toBe('Clear diagnostic logs');
  });
});
