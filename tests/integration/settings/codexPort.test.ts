/**
 * @jest-environment jsdom
 */
/**
 * Parity test for the Codex tab registry port (settings-registry port
 * completion, Task 3). Renders the tab through the registry walker directly —
 * NOT through the `REGISTRY_TABS` flag — and asserts every Setting the legacy
 * `codexSettingsTabRenderer` creates is present (with the Windows-only
 * installation fields gated exactly like the legacy tab), the provider-owned
 * widgets actually mount through the `widgets` seam, and representative
 * fields round-trip onto the real persisted paths (`cliPathsByHost` /
 * `installationMethodsByHost`, not flat keys — plan Decision 1).
 */
import '../../setup/obsidianDom';

import { Setting } from 'obsidian';

import { ProviderWorkspaceRegistry } from '../../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceServices } from '../../../src/core/providers/types';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';
import { codexSettingsTabRenderer } from '../../../src/providers/codex/ui/CodexSettingsTab';
import { getHostnameKey } from '../../../src/utils/env';
import {
  assertTabRendersRegistry,
  type MountedRegistryTab,
  mountRegistryTab,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

// Inventory of the legacy Codex tab, derived from `codexSettingsTabRenderer`
// (the source of truth, per plan Task 3 Step 1). Ids are the REAL persisted
// settings paths for value-backed fields. The Windows-only installation
// fields are listed separately because their registry `visible` guard mirrors
// the legacy `if (isWindowsHost)` blocks.
const LEGACY_FIELD_IDS = [
  'providerConfigs.codex.cliPathsByHost',
  'providerConfigs.codex.safeMode',
  'providerConfigs.codex.customModels',
  'providerConfigs.codex.reasoningSummary',
  'codex.skills',
  'hiddenProviderCommands.codex',
  'codex.subagents',
  'codex.mcpNotice',
  'providerConfigs.codex.environmentVariables',
];

const WINDOWS_ONLY_FIELD_IDS = [
  'providerConfigs.codex.installationMethodsByHost',
  'providerConfigs.codex.wslDistroOverridesByHost',
];

const LEGACY_SECTION_IDS = [
  'setup',
  'safety',
  'models',
  'skills',
  'subagents',
  'mcp',
  'environment',
];

type MockComponent = { kind: string; props: Record<string, unknown> };
type MockSetting = { containerEl: HTMLElement; components: MockComponent[] };

function settingsForRow(row: Element | null): MockSetting[] {
  const instances = (Setting as unknown as { instances: MockSetting[] }).instances;
  return instances.filter(
    (s) =>
      s.containerEl instanceof HTMLElement &&
      (s.containerEl === row || (row?.contains(s.containerEl) ?? false)),
  );
}

function fieldRow(host: HTMLElement, fieldId: string): Element | null {
  return host.querySelector(`[data-field-id="${fieldId}"]`);
}

function componentFor(
  host: HTMLElement,
  fieldId: string,
  kind: string,
): MockComponent | undefined {
  const row = fieldRow(host, fieldId);
  for (const setting of settingsForRow(row)) {
    const match = setting.components.find((c) => c.kind === kind);
    if (match) return match;
  }
  return undefined;
}

function installCodexWorkspaceStub(): void {
  const services = {
    commandCatalog: {
      listVaultEntries: jest.fn().mockResolvedValue([]),
      saveVaultEntry: jest.fn().mockResolvedValue(undefined),
      deleteVaultEntry: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    },
    subagentStorage: {
      loadAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    refreshAgentMentions: jest.fn().mockResolvedValue(undefined),
    // The REAL renderer: registry custom fields must reach the REAL widget
    // mounts through `ProviderWorkspaceRegistry.getSettingsTabRenderer`.
    settingsTabRenderer: codexSettingsTabRenderer,
  } as unknown as ProviderWorkspaceServices;
  ProviderWorkspaceRegistry.setServices('codex', services);
}

function mountCodex(): MountedRegistryTab {
  return mountRegistryTab({
    tabId: 'codex',
    providerEnabled: true,
    tabContentIndex: 4,
    extraSettings: {
      providerConfigs: { codex: { enabled: true } },
      hiddenProviderCommands: { codex: ['analyze'] },
    },
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    run();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}

describe('codex tab registry port', () => {
  let mounted: MountedRegistryTab | null = null;

  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    (Setting as unknown as { instances: unknown[] }).instances.length = 0;
    installCodexWorkspaceStub();
  });

  afterEach(() => {
    mounted?.dispose();
    mounted = null;
    ProviderWorkspaceRegistry.setServices('codex', undefined);
  });

  it('renders every legacy codex field through the registry walker', () => {
    mounted = mountCodex();
    const { host, plugin } = mounted;

    for (const fieldId of LEGACY_FIELD_IDS) {
      if (!fieldRow(host, fieldId)) {
        throw new Error(`missing registry field row for "${fieldId}"`);
      }
    }

    const sectionIds = Array.from(host.querySelectorAll('[data-section-id]')).map(
      (el) => (el as HTMLElement).dataset.sectionId,
    );
    for (const sectionId of LEGACY_SECTION_IDS) {
      expect(sectionIds).toContain(sectionId);
    }

    // The bogus flat appServerPath field is gone — Decision 1 replaced it with
    // the hostname-keyed CLI path widget the legacy tab persists.
    expect(fieldRow(host, 'providerConfigs.codex.appServerPath')).toBeNull();

    assertTabRendersRegistry(host, plugin, 'codex');
  });

  it('gates the Windows installation fields exactly like the legacy tab', () => {
    // Force a POSIX platform (CI also runs this suite on windows-latest,
    // where the host platform would legitimately show the rows): absent...
    withPlatform('linux', () => {
      mounted = mountCodex();
      for (const fieldId of WINDOWS_ONLY_FIELD_IDS) {
        expect(fieldRow(mounted!.host, fieldId)).toBeNull();
      }
      mounted!.dispose();
      mounted = null;
    });

    // ...and present (with the legacy dropdown options) on Windows.
    withPlatform('win32', () => {
      mounted = mountCodex();
      const { host } = mounted;
      for (const fieldId of WINDOWS_ONLY_FIELD_IDS) {
        expect(fieldRow(host, fieldId)).not.toBeNull();
      }

      const dropdown = componentFor(
        host,
        'providerConfigs.codex.installationMethodsByHost',
        'dropdown',
      );
      expect(
        (dropdown?.props.options as Array<{ value: string }>).map((o) => o.value),
      ).toEqual(['native-windows', 'wsl']);
      expect(dropdown?.props.value).toBe('native-windows');

      // WSL distro input mirrors the legacy disabled state for native-windows.
      const wslText = componentFor(
        host,
        'providerConfigs.codex.wslDistroOverridesByHost',
        'text',
      );
      expect((wslText?.props.inputEl as { disabled?: boolean }).disabled).toBe(true);
    });
  });

  it('mounts the provider-owned widgets for real (not no-op stubs)', async () => {
    mounted = mountCodex();
    const { host } = mounted;
    await flush();

    const cliRow = fieldRow(host, 'providerConfigs.codex.cliPathsByHost');
    expect(cliRow?.querySelector('.claudian-cli-path-validation')).not.toBeNull();
    const cliText = componentFor(host, 'providerConfigs.codex.cliPathsByHost', 'text');
    // The widget picks a platform-specific example path; this suite also runs
    // on the windows-latest CI leg.
    expect(cliText?.props.placeholder).toBe(
      process.platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\codex.exe'
        : '/usr/local/bin/codex',
    );

    const skillsRow = fieldRow(host, 'codex.skills');
    const skillsContainer = skillsRow?.querySelector('.claudian-slash-commands-container');
    expect(skillsContainer).not.toBeNull();
    expect(skillsContainer?.childElementCount ?? 0).toBeGreaterThan(0);

    const subagentsRow = fieldRow(host, 'codex.subagents');
    const subagentsContainer = subagentsRow?.querySelector('.claudian-slash-commands-container');
    expect(subagentsContainer).not.toBeNull();
    expect(subagentsContainer?.childElementCount ?? 0).toBeGreaterThan(0);

    const mcpRow = fieldRow(host, 'codex.mcpNotice');
    expect(mcpRow?.querySelector('.claudian-mcp-settings-desc')?.textContent).toContain(
      'Codex manages MCP servers via its own CLI',
    );

    const envRow = fieldRow(host, 'providerConfigs.codex.environmentVariables');
    expect(envRow?.querySelector('.claudian-env-snippets-container')).not.toBeNull();
    expect(envRow?.querySelector('.claudian-secret-env-vars')).not.toBeNull();

    const hidden = componentFor(host, 'hiddenProviderCommands.codex', 'textarea');
    expect(hidden?.props.value).toBe('analyze');
  });

  it('round-trips the native dropdowns through SettingsCtx onto the persisted paths', async () => {
    mounted = mountCodex();
    const { host, plugin } = mounted;

    const safeMode = componentFor(host, 'providerConfigs.codex.safeMode', 'dropdown');
    expect(safeMode?.props.value).toBe('workspace-write');
    await (safeMode?.props.changeHandler as (v: string) => Promise<void>)('read-only');

    const codexConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).codex;
    expect(codexConfig.safeMode).toBe('read-only');

    const reasoning = componentFor(host, 'providerConfigs.codex.reasoningSummary', 'dropdown');
    expect(reasoning?.props.value).toBe('detailed');
    await (reasoning?.props.changeHandler as (v: string) => Promise<void>)('none');
    expect(codexConfig.reasoningSummary).toBe('none');

    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('persists the CLI path into the hostname-keyed map (not flat cliPath)', async () => {
    mounted = mountCodex();
    const { host, plugin } = mounted;

    const text = componentFor(host, 'providerConfigs.codex.cliPathsByHost', 'text');
    expect(text).toBeDefined();

    // process.execPath exists and is a file, so validation passes.
    await (text?.props.changeHandler as (v: string) => Promise<void>)(process.execPath);

    const codexConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).codex;
    expect((codexConfig.cliPathsByHost as Record<string, string>)[getHostnameKey()]).toBe(
      process.execPath,
    );
    expect(codexConfig.cliPath ?? '').toBe('');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('round-trips hidden skills through the shared hidden-commands path', async () => {
    mounted = mountCodex();
    const { host, plugin } = mounted;

    const hidden = componentFor(host, 'hiddenProviderCommands.codex', 'textarea');
    await (hidden?.props.changeHandler as (v: string) => Promise<void>)('explain\n$fix\n');

    expect(
      (plugin.settings.hiddenProviderCommands as Record<string, string[]>).codex,
    ).toEqual(['explain', 'fix']);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
