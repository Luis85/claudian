/**
 * @jest-environment jsdom
 */
/**
 * Parity test for the Claude tab registry port (settings-registry port
 * completion, Task 2). Renders the tab through the registry walker directly —
 * NOT through the `REGISTRY_TABS` flag — and asserts every Setting the legacy
 * `claudeSettingsTabRenderer` creates is present, the provider-owned widgets
 * actually mount through the `widgets` seam (no no-op stubs), and
 * representative fields round-trip onto the real persisted paths
 * (`cliPathsByHost`, not the dead flat `cliPath` — plan Decision 1).
 */
import '../../setup/obsidianDom';

import { Setting } from 'obsidian';

import { ProviderWorkspaceRegistry } from '../../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceServices } from '../../../src/core/providers/types';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';
import { claudeSettingsTabRenderer } from '../../../src/providers/claude/ui/ClaudeSettingsTab';
import { getHostnameKey } from '../../../src/utils/env';
import {
  assertTabRendersRegistry,
  type MountedRegistryTab,
  mountRegistryTab,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

// The MCP widget pulls in McpTester, whose @modelcontextprotocol/sdk imports
// are ESM-only; stub them the same way the MCP suites do.
jest.mock('@modelcontextprotocol/sdk/client', () => ({ Client: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/stdio', () => ({ StdioClientTransport: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/sse', () => ({ SSEClientTransport: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

// Inventory of the legacy Claude tab, derived from `claudeSettingsTabRenderer`
// (the source of truth, per plan Task 2 Step 1). Ids are the REAL persisted
// settings paths for value-backed fields.
const LEGACY_FIELD_IDS = [
  'providerConfigs.claude.cliPathsByHost',
  'providerConfigs.claude.safeMode',
  'providerConfigs.claude.loadUserSettings',
  'claude.trustVault',
  'providerConfigs.claude.enableOpus1M',
  'providerConfigs.claude.enableSonnet1M',
  'providerConfigs.claude.customModels',
  'claude.slashCommands',
  'hiddenProviderCommands.claude',
  'claude.subagents',
  'claude.mcpServers',
  'claude.plugins',
  'providerConfigs.claude.environmentVariables',
  'providerConfigs.claude.enableChrome',
  'providerConfigs.claude.enableBangBash',
];

const LEGACY_SECTION_IDS = [
  'setup',
  'safety',
  'models',
  'commands',
  'subagents',
  'mcp',
  'plugins',
  'environment',
  'experimental',
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

function installClaudeWorkspaceStub(): void {
  const services = {
    commandCatalog: {
      listVaultEntries: jest.fn().mockResolvedValue([]),
      saveVaultEntry: jest.fn().mockResolvedValue(undefined),
      deleteVaultEntry: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    },
    agentManager: {
      loadAgents: jest.fn().mockResolvedValue(undefined),
      getAvailableAgents: jest.fn().mockReturnValue([]),
    },
    agentStorage: {
      load: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    mcpStorage: {
      load: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    },
    pluginManager: {
      loadPlugins: jest.fn().mockResolvedValue(undefined),
      getPlugins: jest.fn().mockReturnValue([]),
      togglePlugin: jest.fn().mockResolvedValue(undefined),
    },
    cliResolver: { reset: jest.fn() },
    // The REAL renderer: registry custom fields must reach the REAL widget
    // mounts through `ProviderWorkspaceRegistry.getSettingsTabRenderer`.
    settingsTabRenderer: claudeSettingsTabRenderer,
  } as unknown as ProviderWorkspaceServices;
  ProviderWorkspaceRegistry.setServices('claude', services);
}

function mountClaude(): MountedRegistryTab {
  return mountRegistryTab({
    tabId: 'claude',
    providerEnabled: true,
    tabContentIndex: 4,
    extraSettings: {
      providerConfigs: { claude: { enabled: true } },
      hiddenProviderCommands: { claude: ['commit'] },
    },
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('claude tab registry port', () => {
  let mounted: MountedRegistryTab | null = null;

  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    (Setting as unknown as { instances: unknown[] }).instances.length = 0;
    installClaudeWorkspaceStub();
  });

  afterEach(() => {
    mounted?.dispose();
    mounted = null;
    ProviderWorkspaceRegistry.setServices('claude', undefined);
  });

  it('renders every legacy claude field through the registry walker', () => {
    mounted = mountClaude();
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
    expect(fieldRow(host, 'providerConfigs.claude.cliPath')).toBeNull();

    assertTabRendersRegistry(host, plugin, 'claude');
  });

  it('mounts the provider-owned widgets for real (not no-op stubs)', async () => {
    mounted = mountClaude();
    const { host } = mounted;
    await flush();

    // CLI path: same validation element + seeded text input the legacy tab has.
    const cliRow = fieldRow(host, 'providerConfigs.claude.cliPathsByHost');
    expect(cliRow?.querySelector('.specorator-cli-path-validation')).not.toBeNull();
    expect(componentFor(host, 'providerConfigs.claude.cliPathsByHost', 'text')).toBeDefined();

    // Slash commands / subagents / MCP / plugins: the same containers the
    // legacy tab renders, populated by the same component classes.
    const slashRow = fieldRow(host, 'claude.slashCommands');
    const slashContainer = slashRow?.querySelector('.specorator-slash-commands-container');
    expect(slashContainer).not.toBeNull();
    expect(slashContainer?.childElementCount ?? 0).toBeGreaterThan(0);

    const agentsRow = fieldRow(host, 'claude.subagents');
    expect(agentsRow?.querySelector('.specorator-agents-container .specorator-sp-header')).not.toBeNull();

    const mcpRow = fieldRow(host, 'claude.mcpServers');
    const mcpContainer = mcpRow?.querySelector('.specorator-mcp-container');
    expect(mcpContainer).not.toBeNull();
    expect(mcpContainer?.childElementCount ?? 0).toBeGreaterThan(0);

    const pluginsRow = fieldRow(host, 'claude.plugins');
    const pluginsContainer = pluginsRow?.querySelector('.specorator-plugins-container');
    expect(pluginsContainer).not.toBeNull();
    expect(pluginsContainer?.childElementCount ?? 0).toBeGreaterThan(0);

    // Environment: shared snippet manager + keychain-backed secret editor.
    const envRow = fieldRow(host, 'providerConfigs.claude.environmentVariables');
    expect(envRow?.querySelector('.specorator-env-snippets-container')).not.toBeNull();
    expect(envRow?.querySelector('.specorator-secret-env-vars')).not.toBeNull();

    // Hidden commands textarea is seeded from the persisted list.
    const hidden = componentFor(host, 'hiddenProviderCommands.claude', 'textarea');
    expect(hidden?.props.value).toBe('commit');

    // Bang-bash keeps its validation element.
    const bangRow = fieldRow(host, 'providerConfigs.claude.enableBangBash');
    expect(bangRow?.querySelector('.specorator-bang-bash-validation')).not.toBeNull();
  });

  it('round-trips a native toggle through SettingsCtx onto the persisted path', async () => {
    mounted = mountClaude();
    const { host, plugin } = mounted;

    const toggle = componentFor(host, 'providerConfigs.claude.loadUserSettings', 'toggle');
    expect(toggle).toBeDefined();
    expect(toggle?.props.value).toBe(true);

    await (toggle?.props.changeHandler as (v: boolean) => Promise<void>)(false);

    const claudeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).claude;
    expect(claudeConfig.loadUserSettings).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('round-trips the Opus 1M widget with the legacy side effects', async () => {
    mounted = mountClaude();
    const { host, plugin } = mounted;

    const toggle = componentFor(host, 'providerConfigs.claude.enableOpus1M', 'toggle');
    expect(toggle).toBeDefined();

    await (toggle?.props.changeHandler as (v: boolean) => Promise<void>)(true);

    const claudeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).claude;
    expect(claudeConfig.enableOpus1M).toBe(true);
    expect(plugin.normalizeModelVariantSettings).toHaveBeenCalled();
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('persists the CLI path into the hostname-keyed map (not flat cliPath)', async () => {
    mounted = mountClaude();
    const { host, plugin } = mounted;

    const text = componentFor(host, 'providerConfigs.claude.cliPathsByHost', 'text');
    expect(text).toBeDefined();

    // process.execPath exists and is a file, so validation passes.
    await (text?.props.changeHandler as (v: string) => Promise<void>)(process.execPath);

    const claudeConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).claude;
    expect((claudeConfig.cliPathsByHost as Record<string, string>)[getHostnameKey()]).toBe(
      process.execPath,
    );
    expect(claudeConfig.cliPath ?? '').toBe('');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
