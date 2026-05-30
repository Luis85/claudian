/**
 * Shared test plumbing for the per-tab registry port integration tests.
 *
 * Each port test verifies that `ClaudianSettings.display()` mounts the
 * registry-driven section/field DOM for one tab. The mocks and stubs needed to
 * do that are nearly identical across all tabs, so they live here. Per-test
 * differences (which tab, whether it is provider-gated, the tab-content index)
 * are passed in as options.
 *
 * NOTE: This helper is imported by each port test *after* that test's
 * `jest.mock(...)` factories are declared. Because `jest.mock` is hoisted and
 * applies to the entire module graph of the test file, the imports below
 * resolve through the per-test mocks.
 */
import { ProviderRegistry } from '../../../src/core/providers/ProviderRegistry';
import { ClaudianSettingTab } from '../../../src/features/settings/ClaudianSettings';
import {
  getSettingsRegistry,
  registerAllSettings,
} from '../../../src/features/settings/registry';

export interface PortTestOptions {
  tabId: string;
  /**
   * For provider tabs, mark the provider as enabled in plugin.settings and in
   * the `ProviderRegistry.getEnabledProviderIds` mock. Non-provider tabs
   * (agentBoard, orchestrator, diagnostics) leave this false.
   */
  providerEnabled?: boolean;
  /**
   * The index of `.claudian-settings-tab-content` that this tab's content
   * should land at. Mirrors the shell's `tabIds` ordering:
   *   0: general
   *   1: agentBoard
   *   2: orchestrator
   *   3: diagnostics
   *   4+: enabled providers (claude/codex/opencode/cursor)
   */
  tabContentIndex: number;
  /** Extra entries to merge into plugin.settings (e.g. provider config). */
  extraSettings?: Record<string, unknown>;
}

interface StubPlugin {
  settings: Record<string, unknown>;
  saveSettings: jest.Mock;
  getAllViews: jest.Mock;
  getView: jest.Mock;
  getActiveEnvironmentVariables: jest.Mock;
  // Minimum events surface required by registry custom widgets (F4 default-
  // provider chip subscribes to `task:board-config-changed`).
  events: { on: jest.Mock; emit: jest.Mock };
}

export function createStubPlugin(opts: PortTestOptions): StubPlugin {
  const providerConfigs: Record<string, unknown> = {};
  if (opts.providerEnabled) {
    providerConfigs[opts.tabId] = { enabled: true };
  }
  return {
    settings: {
      locale: 'en',
      providerConfigs,
      ...(opts.extraSettings ?? {}),
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getView: jest.fn().mockReturnValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    events: {
      on: jest.fn(() => () => undefined),
      emit: jest.fn(),
    },
  };
}

/**
 * Configures the `ProviderRegistry` mock for this test. Caller must have
 * declared `jest.mock('.../ProviderRegistry', ...)` already.
 */
export function configureProviderRegistryMock(opts: PortTestOptions): void {
  const providers = opts.providerEnabled ? [opts.tabId] : [];
  const reg = ProviderRegistry as unknown as {
    getEnabledProviderIds: jest.Mock;
    getRegisteredProviderIds: jest.Mock;
    getProviderDisplayName: jest.Mock;
    isEnabled: jest.Mock;
    getChatUIConfig: jest.Mock;
  };
  reg.getEnabledProviderIds.mockReturnValue(providers);
  reg.getRegisteredProviderIds.mockReturnValue(providers);
  reg.getProviderDisplayName.mockImplementation((id: string) => id);
  reg.isEnabled.mockReturnValue(Boolean(opts.providerEnabled));
  // F5d: the agent-board default-model widget calls getChatUIConfig(provider)
  // for the resolved provider when one is enabled. Return a minimal stub so
  // the widget can render without throwing.
  reg.getChatUIConfig.mockReturnValue({
    ownsModel: () => false,
    getModelOptions: () => [],
  });
}

export interface MountedShell {
  /** The plugin stub the shell was constructed with. */
  plugin: StubPlugin;
  /** The container the shell rendered into. */
  containerEl: HTMLElement;
  /** The specific tab content host this test cares about. */
  tabContent: HTMLElement;
}

/**
 * Mounts `ClaudianSettings.display()` and returns the relevant tab content
 * host. Also asserts the host exists so each caller doesn't need to repeat the
 * `expect(tabContent).toBeDefined()` boilerplate.
 */
export function mountSettingsShell(opts: PortTestOptions): MountedShell {
  configureProviderRegistryMock(opts);

  const plugin = createStubPlugin(opts);
  const tab = new ClaudianSettingTab({} as never, plugin as never);
  (tab as unknown as { containerEl: HTMLElement }).containerEl =
    document.createElement('div');
  // The general tab's legacy private renderer is not the subject of these
  // tests; stub it to keep the shell focused on registry-driven branches.
  (
    tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }
  ).renderGeneralTab = jest.fn();

  tab.display();

  const containerEl = (tab as unknown as { containerEl: HTMLElement })
    .containerEl;
  const tabContents = containerEl.querySelectorAll(
    '.claudian-settings-tab-content',
  );
  const tabContent = tabContents[opts.tabContentIndex] as
    | HTMLElement
    | undefined;
  expect(tabContent).toBeDefined();

  return { plugin, containerEl, tabContent: tabContent as HTMLElement };
}

/**
 * Runs the standard "every registered field/section is mounted" assertion for
 * one tab. Honors `visible()` predicates on fields.
 */
export function assertTabRendersRegistry(
  tabContent: HTMLElement,
  plugin: StubPlugin,
  tabId: string,
): void {
  const registry = getSettingsRegistry();
  if (registry.getAllFields().length === 0) {
    registerAllSettings();
  }

  const fields = registry.getAllFields().filter((f) => f.tabId === tabId);
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    if (field.visible && !field.visible(plugin.settings as never)) continue;
    const row = tabContent.querySelector(`[data-field-id="${field.id}"]`);
    expect(row).not.toBeNull();
  }

  const sectionIds = Array.from(
    tabContent.querySelectorAll('[data-section-id]'),
  ).map((el) => (el as HTMLElement).dataset.sectionId);
  // renderTab skips sections with zero visible fields, so only assert sections
  // that actually carry at least one field for this tab.
  const declaredSectionIds = registry
    .getSections(tabId, plugin.settings as never)
    .filter(
      (s) =>
        registry.getFields(tabId, s.id, plugin.settings as never).length > 0,
    )
    .map((s) => s.id);
  expect(declaredSectionIds.length).toBeGreaterThan(0);
  for (const declared of declaredSectionIds) {
    expect(sectionIds).toContain(declared);
  }
}
