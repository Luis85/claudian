import { getSettingsRegistry } from '../registry';

export function registerDiagnosticsTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'diagnostics',
    label: 'Diagnostics',
    order: 80,
    visible: () => true,
  });

  r.registerSection({
    id: 'logging',
    tabId: 'diagnostics',
    label: 'Logging',
    order: 10,
  });

  r.registerSection({
    id: 'actions',
    tabId: 'diagnostics',
    label: 'Actions',
    order: 20,
  });

  r.registerField({
    id: 'loggingEnabled',
    tabId: 'diagnostics',
    sectionId: 'logging',
    label: 'Enable logging',
    type: { kind: 'toggle' },
    default: false,
  });

  r.registerField({
    id: 'logLevel',
    tabId: 'diagnostics',
    sectionId: 'logging',
    label: 'Log level',
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'off', label: 'Off' },
        { value: 'error', label: 'Error' },
        { value: 'warn', label: 'Warn' },
        { value: 'info', label: 'Info' },
        { value: 'debug', label: 'Debug' },
      ],
    },
    default: 'warn',
    visible: (settings) => settings.loggingEnabled === true,
  });

  r.registerField({
    id: 'copyDiagnosticLogs',
    tabId: 'diagnostics',
    sectionId: 'actions',
    label: 'Copy logs',
    type: {
      kind: 'button',
      label: 'Copy diagnostic logs',
      // TODO Phase F: invoke command 'specorator:copy-diagnostic-logs' once SettingsCtx exposes plugin handle
      onClick: () => undefined,
    },
    default: null,
  });

  r.registerField({
    id: 'clearDiagnosticLogs',
    tabId: 'diagnostics',
    sectionId: 'actions',
    label: 'Clear logs',
    type: {
      kind: 'button',
      label: 'Clear diagnostic logs',
      // TODO Phase F: invoke command 'specorator:clear-diagnostic-logs' once SettingsCtx exposes plugin handle
      onClick: () => undefined,
    },
    default: null,
  });
}
