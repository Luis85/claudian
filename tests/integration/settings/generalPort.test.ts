/**
 * @jest-environment jsdom
 */
/**
 * Parity test for the General tab registry port (settings-registry port
 * completion, Task 1). Renders the tab through the registry walker directly —
 * NOT through the `REGISTRY_TABS` flag — and asserts every Setting the legacy
 * `ClaudianSettings.renderGeneralTab` creates is present, custom widgets
 * actually mount (no `render: () => undefined` stubs), and a representative
 * simple field round-trips through SettingsCtx onto the real persisted path.
 */
import '../../setup/obsidianDom';

import { Setting } from 'obsidian';

import { ProviderRegistry } from '../../../src/core/providers/ProviderRegistry';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';
import {
  assertTabRendersRegistry,
  type MountedRegistryTab,
  mountRegistryTab,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'cursor'];

// Inventory of the legacy General tab, derived from
// `ClaudianSettings.renderGeneralTab` (the source of truth, per plan Task 1
// Step 1). Ids are the REAL persisted settings paths for value-backed fields.
const LEGACY_FIELD_IDS = [
  ...PROVIDER_IDS.map((id) => `providerConfigs.${id}.enabled`),
  'locale',
  'quickActionsFolder',
  'tabBarPosition',
  'maxChatTabs',
  'chatViewPlacement',
  'enableAutoScroll',
  'deferMathRenderingDuringStreaming',
  'enableAutoTitleGeneration',
  'titleGenerationModel',
  'userName',
  'systemPrompt',
  'excludedTags',
  'mediaFolder',
  'requireCommandOrControlEnterToSend',
  'keyboardNavigation',
  'general.hotkeys.list',
  'sharedEnvironmentVariables',
];

const LEGACY_SECTION_IDS = [
  'providers',
  'general',
  'display',
  'conversations',
  'content',
  'input',
  'hotkeys',
  'environment',
];

type MockComponent = { kind: string; props: Record<string, unknown> };
type MockSetting = { containerEl: HTMLElement; components: MockComponent[] };

function settingsForRow(row: Element | null): MockSetting[] {
  const instances = (Setting as unknown as { instances: MockSetting[] })
    .instances;
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

function mountGeneral(): MountedRegistryTab {
  return mountRegistryTab({
    tabId: 'general',
    tabContentIndex: 0,
    registeredProviderIds: PROVIDER_IDS,
    extraSettings: {
      firstRunDismissed: true,
      enableAutoTitleGeneration: true,
      enableAutoScroll: true,
      quickActionsFolder: 'Quick Actions',
      maxChatTabs: 3,
    },
  });
}

describe('general tab registry port', () => {
  let mounted: MountedRegistryTab | null = null;

  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    (Setting as unknown as { instances: unknown[] }).instances.length = 0;
  });

  afterEach(() => {
    mounted?.dispose();
    mounted = null;
  });

  it('renders every legacy general field through the registry walker', () => {
    mounted = mountGeneral();
    const { host, plugin } = mounted;

    for (const fieldId of LEGACY_FIELD_IDS) {
      const row = fieldRow(host, fieldId);
      if (!row) {
        throw new Error(`missing registry field row for "${fieldId}"`);
      }
    }

    const sectionIds = Array.from(host.querySelectorAll('[data-section-id]')).map(
      (el) => (el as HTMLElement).dataset.sectionId,
    );
    for (const sectionId of LEGACY_SECTION_IDS) {
      expect(sectionIds).toContain(sectionId);
    }

    assertTabRendersRegistry(host, plugin, 'general');
  });

  it('mounts custom widgets for real (not no-op stubs)', () => {
    mounted = mountGeneral();
    const { host } = mounted;

    // Shared environment section: snippet manager + keychain-backed secret
    // editor mount inside the field host (same code path as the legacy tab).
    const envRow = fieldRow(host, 'sharedEnvironmentVariables');
    expect(envRow?.querySelector('.claudian-env-snippets-container')).not.toBeNull();
    expect(envRow?.querySelector('.claudian-secret-env-vars')).not.toBeNull();

    // Quick actions folder: same renderQuickActionsSettingsTab the legacy
    // path uses, seeded with the persisted value.
    const quickActions = componentFor(host, 'quickActionsFolder', 'text');
    expect(quickActions?.props.value).toBe('Quick Actions');

    // Max chat tabs keeps the legacy slider semantics (limits 3..10).
    const slider = componentFor(host, 'maxChatTabs', 'slider');
    expect(slider?.props.limits).toEqual({ min: 3, max: 10, step: 1 });
    expect(slider?.props.value).toBe(3);

    // Keyboard navigation textarea is seeded from the structured setting.
    const nav = componentFor(host, 'keyboardNavigation', 'textarea');
    expect(nav?.props.value).toBe('map w scrollUp\nmap s scrollDown\nmap i focusInput');
  });

  it('round-trips a representative simple field through SettingsCtx', async () => {
    mounted = mountGeneral();
    const { host, plugin } = mounted;

    const toggle = componentFor(host, 'enableAutoScroll', 'toggle');
    expect(toggle).toBeDefined();
    expect(toggle?.props.value).toBe(true);

    await (toggle?.props.changeHandler as (v: boolean) => Promise<void>)(false);

    expect(plugin.settings.enableAutoScroll).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('routes provider enable toggles through the settings reconciler', async () => {
    mounted = mountGeneral();
    const { host, plugin } = mounted;

    const toggle = componentFor(host, 'providerConfigs.claude.enabled', 'toggle');
    expect(toggle).toBeDefined();

    await (toggle?.props.changeHandler as (v: boolean) => Promise<void>)(true);

    const reconciler = (
      ProviderRegistry.getSettingsReconciler as jest.Mock
    )('claude') as { setEnabled: jest.Mock };
    expect(reconciler.setEnabled).toHaveBeenCalledWith(expect.anything(), true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
