/**
 * @jest-environment jsdom
 */
/**
 * Parity test for the Opencode tab registry port (settings-registry port
 * completion, Task 4). Renders the tab through the registry walker directly —
 * NOT through the `REGISTRY_TABS` flag — and asserts every Setting the legacy
 * `opencodeSettingsTabRenderer` creates is present, the provider-owned
 * widgets actually mount through the `widgets` seam (no `render: () =>
 * undefined` stubs), and representative fields round-trip onto the real
 * persisted paths (`cliPathsByHost`, not the dead flat `cliPath` — plan
 * Decision 1).
 */
import '../../setup/obsidianDom';

import { Setting } from 'obsidian';

import { ProviderWorkspaceRegistry } from '../../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceServices } from '../../../src/core/providers/types';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';
import { opencodeSettingsTabRenderer } from '../../../src/providers/opencode/ui/OpencodeSettingsTab';
import { getHostnameKey } from '../../../src/utils/env';
import {
  assertTabRendersRegistry,
  type MountedRegistryTab,
  mountRegistryTab,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

// Inventory of the legacy Opencode tab, derived from
// `opencodeSettingsTabRenderer` (the source of truth, per plan Task 4). Ids
// are the REAL persisted settings paths for value-backed fields. The provider
// `enabled` toggle lives on the General tab.
const LEGACY_FIELD_IDS = [
  'providerConfigs.opencode.cliPathsByHost',
  'providerConfigs.opencode.selectedMode',
  'providerConfigs.opencode.visibleModels',
  'providerConfigs.opencode.modelAliases',
  'providerConfigs.opencode.customModels',
  'hiddenProviderCommands.opencode',
  'opencode.subagents',
  'providerConfigs.opencode.environmentVariables',
];

const LEGACY_SECTION_IDS = ['setup', 'models', 'commands', 'subagents', 'environment'];

const DISCOVERED_MODELS = [
  { rawId: 'anthropic/claude-opus-4-5', label: 'Anthropic/Claude Opus 4.5' },
  { rawId: 'openai/gpt-5.5', label: 'OpenAI/GPT 5.5' },
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

function installOpencodeWorkspaceStub(): void {
  const services = {
    agentStorage: {
      loadAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    cliResolver: { reset: jest.fn() },
    refreshAgentMentions: jest.fn().mockResolvedValue(undefined),
    // The REAL renderer: registry custom fields must reach the REAL widget
    // mounts through `ProviderWorkspaceRegistry.getSettingsTabRenderer`.
    settingsTabRenderer: opencodeSettingsTabRenderer,
  } as unknown as ProviderWorkspaceServices;
  ProviderWorkspaceRegistry.setServices('opencode', services);
}

function mountOpencode(): MountedRegistryTab {
  return mountRegistryTab({
    tabId: 'opencode',
    providerEnabled: true,
    tabContentIndex: 4,
    extraSettings: {
      providerConfigs: {
        opencode: {
          enabled: true,
          // Legacy config seeding path: getOpencodeProviderSettings copies
          // these into the in-memory discovery state on first read.
          discoveredModels: DISCOVERED_MODELS,
          visibleModels: ['anthropic/claude-opus-4-5'],
          modelAliases: { 'anthropic/claude-opus-4-5': 'Opus' },
        },
      },
      hiddenProviderCommands: { opencode: ['compact'] },
    },
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('opencode tab registry port', () => {
  let mounted: MountedRegistryTab | null = null;

  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    (Setting as unknown as { instances: unknown[] }).instances.length = 0;
    installOpencodeWorkspaceStub();
  });

  afterEach(() => {
    mounted?.dispose();
    mounted = null;
    ProviderWorkspaceRegistry.setServices('opencode', undefined);
  });

  it('renders every legacy opencode field through the registry walker', () => {
    mounted = mountOpencode();
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

    // The flat cliPath text field is gone — Decision 1 replaced it with the
    // hostname-keyed widget so persisted vault data keeps working.
    expect(fieldRow(host, 'providerConfigs.opencode.cliPath')).toBeNull();

    assertTabRendersRegistry(host, plugin, 'opencode');
  });

  it('mounts the provider-owned widgets for real (not no-op stubs)', async () => {
    mounted = mountOpencode();
    const { host } = mounted;
    await flush();

    // CLI path: same validation element + text input the legacy tab has.
    const cliRow = fieldRow(host, 'providerConfigs.opencode.cliPathsByHost');
    expect(cliRow?.querySelector('.claudian-cli-path-validation')).not.toBeNull();
    expect(componentFor(host, 'providerConfigs.opencode.cliPathsByHost', 'text')).toBeDefined();

    // Visible-models picker: one checkbox per catalog model.
    const pickerRow = fieldRow(host, 'providerConfigs.opencode.visibleModels');
    const checkboxes = pickerRow?.querySelectorAll(
      '.claudian-opencode-model-picker-list input[type="checkbox"]',
    );
    expect(checkboxes?.length).toBe(DISCOVERED_MODELS.length);
    expect(
      pickerRow?.querySelector('.claudian-opencode-model-picker-summary')?.textContent,
    ).toContain('Visible: 1');

    // Alias editor: one row per selected model, seeded with the saved alias.
    const aliasRow = fieldRow(host, 'providerConfigs.opencode.modelAliases');
    const aliasInputs = aliasRow?.querySelectorAll<HTMLInputElement>(
      '.claudian-opencode-model-picker-selected-alias',
    );
    expect(aliasInputs?.length).toBe(1);
    expect(aliasInputs?.[0]?.value).toBe('Opus');

    // Hidden commands textarea is seeded from the persisted list.
    const hidden = componentFor(host, 'hiddenProviderCommands.opencode', 'textarea');
    expect(hidden?.props.value).toBe('compact');

    // Subagents: same container + manager header the legacy tab renders.
    const subagentsRow = fieldRow(host, 'opencode.subagents');
    expect(
      subagentsRow?.querySelector('.claudian-slash-commands-container .claudian-sp-header'),
    ).not.toBeNull();

    // Environment: shared snippet manager + keychain-backed secret editor.
    const envRow = fieldRow(host, 'providerConfigs.opencode.environmentVariables');
    expect(envRow?.querySelector('.claudian-env-snippets-container')).not.toBeNull();
    expect(envRow?.querySelector('.claudian-secret-env-vars')).not.toBeNull();
  });

  it('unchecking a catalog model persists visibleModels and refreshes the alias editor', async () => {
    mounted = mountOpencode();
    const { host, plugin } = mounted;

    const pickerRow = fieldRow(host, 'providerConfigs.opencode.visibleModels');
    // Rows are sorted by provider label, so Anthropic (the selected model)
    // comes first.
    const checkbox = pickerRow?.querySelector<HTMLInputElement>(
      '.claudian-opencode-model-picker-row--selected input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);

    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));
    await flush();

    const opencodeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).opencode;
    expect(opencodeConfig.visibleModels).toEqual([]);
    expect(plugin.saveSettings).toHaveBeenCalled();

    // Cross-widget sync: the alias editor re-rendered to its empty state.
    const aliasRow = fieldRow(host, 'providerConfigs.opencode.modelAliases');
    expect(
      aliasRow?.querySelectorAll('.claudian-opencode-model-picker-selected-alias').length,
    ).toBe(0);
  });

  it('round-trips the selectedMode dropdown through SettingsCtx onto the persisted path', async () => {
    mounted = mountOpencode();
    const { host, plugin } = mounted;

    const dropdown = componentFor(host, 'providerConfigs.opencode.selectedMode', 'dropdown');
    expect(dropdown).toBeDefined();

    await (dropdown?.props.changeHandler as (v: string) => Promise<void>)('plan');

    const opencodeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).opencode;
    expect(opencodeConfig.selectedMode).toBe('plan');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('persists the CLI path into the hostname-keyed map (not flat cliPath)', async () => {
    mounted = mountOpencode();
    const { host, plugin } = mounted;

    const text = componentFor(host, 'providerConfigs.opencode.cliPathsByHost', 'text');
    expect(text).toBeDefined();

    // process.execPath exists and is a file, so validation passes.
    await (text?.props.changeHandler as (v: string) => Promise<void>)(process.execPath);

    const opencodeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).opencode;
    expect((opencodeConfig.cliPathsByHost as Record<string, string>)[getHostnameKey()]).toBe(
      process.execPath,
    );
    expect(opencodeConfig.cliPath ?? '').toBe('');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
