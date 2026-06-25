import { t } from '../../../../i18n/i18n';
import { customModelsCommitHooks } from '../../customModels/customModelsCommitHooks';
import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { renderProviderSettingsWidget } from '../providers/providerWidgets';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

const isWindowsHost = (): boolean => process.platform === 'win32';

// Field definitions mirror the legacy `codexSettingsTabRenderer` (the parity
// source of truth — see tests/integration/settings/codexPort). Pure
// value-backed fields are native registry kinds with ids equal to their
// persisted settings paths; the Windows installation fields and the CLI path
// persist hostname-keyed maps via `updateCodexProviderSettings` (Decision 1),
// so they mount the SAME widget code the legacy tab uses, as do the composite
// skills/subagents/MCP/environment sections.
//
// Deliberately absent: the provider `enabled` toggle. The General tab owns
// `providerConfigs.codex.enabled` (field ids are registry-unique), and this
// tab is only visible while Codex is enabled.
export function registerCodexTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'codex',
    label: 'Codex',
    order: 20,
    sections: [
      { id: 'setup', label: t('settings.setup'), order: 10 },
      { id: 'safety', label: t('settings.safety'), order: 20 },
      { id: 'models', label: t('settings.models'), order: 30 },
      { id: 'skills', label: 'Codex skills', order: 40 },
      { id: 'subagents', label: 'Codex subagents', order: 50 },
      { id: 'mcp', label: t('settings.mcpServers.name'), order: 60 },
      { id: 'environment', label: t('settings.environment'), order: 70 },
    ],
  });

  registerSetupAndSafetyFields(r);
  registerModelFields(r);
  registerWorkspaceWidgetFields(r);
}

type Registry = ReturnType<typeof getSettingsRegistry>;

function registerSetupAndSafetyFields(r: Registry): void {
  // Legacy guard: the installation-method dropdown only exists on Windows.
  r.registerField({
    id: 'providerConfigs.codex.installationMethodsByHost',
    tabId: 'codex',
    sectionId: 'setup',
    label: 'Installation method',
    description:
      'How Specorator should launch Codex on Windows. Native Windows uses a Windows executable path. WSL launches the Linux CLI inside a selected distro.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'installationMethod'),
    },
    default: null,
    visible: () => isWindowsHost(),
    keywords: ['windows', 'wsl', 'installation', 'launch', 'native'],
  });

  // Decision 1: the persisted shape is the hostname-keyed map, not a flat
  // string. The widget edits the current host's entry.
  r.registerField({
    id: 'providerConfigs.codex.cliPathsByHost',
    tabId: 'codex',
    sectionId: 'setup',
    label: 'Codex CLI path',
    description: 'Custom path to the local Codex CLI. Leave empty for auto-detection from PATH.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'cliPathsByHost'),
    },
    default: null,
    keywords: ['cli', 'path', 'executable', 'binary', 'codex'],
  });

  // Legacy guard: rendered on Windows only; the widget itself hides/disables
  // the control unless the installation method is WSL (same as the legacy
  // tab's `specorator-hidden` toggle).
  r.registerField({
    id: 'providerConfigs.codex.wslDistroOverridesByHost',
    tabId: 'codex',
    sectionId: 'setup',
    label: 'WSL distro override',
    description:
      'Optional advanced override. Leave empty to infer the distro from a WSL workspace path when possible, otherwise use the default WSL distro.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'wslDistroOverride'),
    },
    default: null,
    visible: () => isWindowsHost(),
    keywords: ['wsl', 'distro', 'ubuntu', 'windows'],
  });

  r.registerField({
    id: 'providerConfigs.codex.safeMode',
    tabId: 'codex',
    sectionId: 'safety',
    label: t('settings.codexSafeMode.name'),
    description: t('settings.codexSafeMode.desc'),
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'workspace-write', label: 'Workspace write' },
        { value: 'read-only', label: 'Read only' },
      ],
    },
    default: 'workspace-write',
    keywords: ['safe', 'mode', 'sandbox', 'read only', 'workspace'],
  });
}

function registerModelFields(r: Registry): void {
  r.registerField({
    id: 'providerConfigs.codex.customModels',
    tabId: 'codex',
    sectionId: 'models',
    label: 'Custom models',
    description: 'Append additional Codex model ids to the picker, one per line. `OPENAI_MODEL` still takes precedence when set.',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'codex', ctx, customModelsCommitHooks(ctx, 'codex'));
        table.render();
      },
    },
    default: null,
    keywords: ['custom', 'models', 'model id', 'alias'],
  });

  r.registerField({
    id: 'providerConfigs.codex.reasoningSummary',
    tabId: 'codex',
    sectionId: 'models',
    label: 'Reasoning summary',
    description: "Show a summary of the model's reasoning process in the thinking block.",
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'auto', label: 'Auto' },
        { value: 'concise', label: 'Concise' },
        { value: 'detailed', label: 'Detailed' },
        { value: 'none', label: 'Off' },
      ],
    },
    default: 'detailed',
    keywords: ['reasoning', 'summary', 'thinking', 'effort'],
  });
}

function registerWorkspaceWidgetFields(r: Registry): void {
  r.registerField({
    id: 'codex.skills',
    tabId: 'codex',
    sectionId: 'skills',
    label: 'Codex skills',
    description:
      'Manage vault-level Codex skills stored in .codex/skills/ or .agents/skills/. Home-level skills are excluded here.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'skills'),
    },
    default: null,
    keywords: ['skills', 'vault', '$', 'commands'],
  });

  r.registerField({
    id: 'hiddenProviderCommands.codex',
    tabId: 'codex',
    sectionId: 'skills',
    label: 'Hidden Skills',
    description:
      'Hide specific Codex skills from the dropdown. Enter skill names without the leading $, one per line.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'hiddenCommands'),
    },
    default: null,
    keywords: ['hidden', 'skills', 'dropdown'],
  });

  r.registerField({
    id: 'codex.subagents',
    tabId: 'codex',
    sectionId: 'subagents',
    label: 'Codex subagents',
    description:
      'Manage vault-level Codex subagents stored in .codex/agents/. Each TOML file defines one custom agent.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'subagents'),
    },
    default: null,
    keywords: ['subagents', 'agents', 'toml', 'custom agent'],
  });

  r.registerField({
    id: 'codex.mcpNotice',
    tabId: 'codex',
    sectionId: 'mcp',
    label: t('settings.mcpServers.name'),
    description: 'Codex manages MCP servers via its own CLI (codex mcp).',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'mcpNotice'),
    },
    default: null,
    keywords: ['mcp', 'servers', 'model context protocol'],
  });

  r.registerField({
    id: 'providerConfigs.codex.environmentVariables',
    tabId: 'codex',
    sectionId: 'environment',
    label: 'Codex environment',
    description:
      'Codex-owned runtime variables only. Use this for OPENAI_* and CODEX_* settings. If Codex auto-detection needs help, add its install directory to shared PATH instead of this provider section.',
    type: {
      kind: 'custom',
      // Heading intentionally omitted: the section walker renders it.
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'codex', 'environment'),
    },
    default: '',
    keywords: ['environment', 'env', 'variables', 'openai', 'api key', 'secrets'],
  });
}
