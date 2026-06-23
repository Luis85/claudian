/**
 * Shared test plumbing for the per-tab registry port integration tests.
 *
 * Each port test verifies that `SpecoratorSettings.display()` mounts the
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
import { SpecoratorSettingTab } from '../../../src/features/settings/SpecoratorSettings';
import {
  getSettingsRegistry,
  registerAllSettings,
  renderTab,
  type SettingsCtx,
} from '../../../src/features/settings/registry';

export interface PortTestOptions {
  tabId: string;
  /**
   * For provider tabs, mark the provider as enabled in plugin.settings and in
   * the `ProviderRegistry.getEnabledProviderIds` mock. Non-provider tabs
   * (agentBoard, diagnostics) leave this false.
   */
  providerEnabled?: boolean;
  /**
   * Provider ids `ProviderRegistry.getRegisteredProviderIds` should report.
   * Non-provider tabs that register per-provider fields (e.g. the General
   * tab's enable toggles) need registered providers without enabling any.
   * Defaults to the providerEnabled-derived list.
   */
  registeredProviderIds?: string[];
  /**
   * The index of `.specorator-settings-tab-content` that this tab's content
   * should land at. Mirrors the shell's `tabIds` ordering:
   *   0: general
   *   1: agentBoard
     *   3: diagnostics
   *   4+: enabled providers (claude/codex/opencode/cursor)
   */
  tabContentIndex: number;
  /** Extra entries to merge into plugin.settings (e.g. provider config). */
  extraSettings?: Record<string, unknown>;
}

interface StubPlugin {
  settings: Record<string, unknown>;
  // Minimal Obsidian `app` surface. Widgets feature-detect the private
  // hotkeyManager / secretStorage surfaces; provider trust widgets read
  // `app.vault.adapter.basePath`, so the vault bag must exist.
  app: Record<string, unknown>;
  saveSettings: jest.Mock;
  getAllViews: jest.Mock;
  getView: jest.Mock;
  getActiveEnvironmentVariables: jest.Mock;
  getResolvedEnvironmentVariables: jest.Mock;
  getEnvironmentVariablesForScope: jest.Mock;
  applyEnvironmentVariables: jest.Mock;
  applySecretEnvVars: jest.Mock;
  // Provider-tab widget hooks (Claude model-variant toggles, MCP manager,
  // Cursor model discovery).
  normalizeModelVariantSettings: jest.Mock;
  warnMissingMcpSecrets: jest.Mock;
  getResolvedProviderCliPath: jest.Mock;
  secretStore: { clear: jest.Mock; get: jest.Mock };
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
      // General-shape defaults read synchronously by shared widgets (env
      // snippet manager, nav-mapping textarea, content fields). Mirrors
      // DEFAULT_SPECORATOR_SETTINGS so render-time reads never explode.
      userName: '',
      systemPrompt: '',
      excludedTags: [],
      mediaFolder: '',
      envSnippets: [],
      secretEnvVars: [],
      keyboardNavigation: {
        scrollUpKey: 'w',
        scrollDownKey: 's',
        focusInputKey: 'i',
      },
      ...(opts.extraSettings ?? {}),
    },
    app: { vault: { adapter: {} } },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getView: jest.fn().mockReturnValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    getResolvedEnvironmentVariables: jest.fn().mockReturnValue({}),
    getEnvironmentVariablesForScope: jest.fn().mockReturnValue(''),
    applyEnvironmentVariables: jest.fn().mockResolvedValue(undefined),
    applySecretEnvVars: jest.fn().mockResolvedValue(undefined),
    normalizeModelVariantSettings: jest.fn().mockReturnValue(false),
    warnMissingMcpSecrets: jest.fn(),
    // Null keeps the Cursor picker's best-effort warm discovery a no-op.
    getResolvedProviderCliPath: jest.fn().mockReturnValue(null),
    secretStore: { clear: jest.fn(), get: jest.fn().mockReturnValue(null) },
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
    getSettingsReconciler: jest.Mock;
  };
  reg.getEnabledProviderIds.mockReturnValue(providers);
  reg.getRegisteredProviderIds.mockReturnValue(
    opts.registeredProviderIds ?? providers,
  );
  reg.getProviderDisplayName.mockImplementation((id: string) => id);
  reg.isEnabled.mockReturnValue(Boolean(opts.providerEnabled));
  // F5d: the agent-board default-model widget calls getChatUIConfig(provider)
  // for the resolved provider when one is enabled. Return a minimal stub so
  // the widget can render without throwing. `getCustomModelIds` backs the
  // shared custom-context-limits widget mounted by environment sections.
  reg.getChatUIConfig.mockReturnValue({
    ownsModel: () => false,
    getModelOptions: () => [],
    getCustomModelIds: () => [],
  });
  // General-tab provider enable toggles route through the reconciler exactly
  // like the legacy renderer. A stable object lets tests assert on the
  // `setEnabled` spy via `ProviderRegistry.getSettingsReconciler(id)`.
  reg.getSettingsReconciler.mockReturnValue({ setEnabled: jest.fn() });
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
 * Mounts `SpecoratorSettings.display()` and returns the relevant tab content
 * host. Also asserts the host exists so each caller doesn't need to repeat the
 * `expect(tabContent).toBeDefined()` boilerplate.
 */
export function mountSettingsShell(opts: PortTestOptions): MountedShell {
  configureProviderRegistryMock(opts);

  const plugin = createStubPlugin(opts);
  const tab = new SpecoratorSettingTab({} as never, plugin as never);
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
    '.specorator-settings-tab-content',
  );
  const tabContent = tabContents[opts.tabContentIndex] as
    | HTMLElement
    | undefined;
  expect(tabContent).toBeDefined();

  return { plugin, containerEl, tabContent: tabContent as HTMLElement };
}

export interface MountedRegistryTab {
  plugin: StubPlugin;
  /** Host element `renderTab` rendered the tab into. */
  host: HTMLElement;
  /** The SettingsCtx handed to the registry renderer. */
  ctx: SettingsCtx;
  /** Field-level disposer chain returned by `renderTab`. Call in afterEach. */
  dispose: () => void;
}

/**
 * Renders one tab through the registry walker (`renderTab`) directly,
 * independent of the `REGISTRY_TABS` feature flag. Port parity tests use this
 * BEFORE the coordinator flips the tab, so the gate (parity test green) can
 * precede the flip instead of depending on it.
 */
export function mountRegistryTab(opts: PortTestOptions): MountedRegistryTab {
  configureProviderRegistryMock(opts);

  const plugin = createStubPlugin(opts);
  const registry = getSettingsRegistry();
  if (registry.getAllFields().length === 0) {
    registerAllSettings();
  }

  const ctx = {
    settings: plugin.settings,
    saveSettings: () => plugin.saveSettings() as Promise<void>,
    refresh: () => undefined,
    plugin,
  } as unknown as SettingsCtx;

  const host = document.createElement('div');
  const dispose = renderTab(host, opts.tabId, ctx, registry);
  return { plugin, host, ctx, dispose };
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
