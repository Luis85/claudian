/**
 * @jest-environment jsdom
 */
/**
 * Parity test for the Cursor tab registry port (settings-registry port
 * completion, Task 5). Renders the tab through the registry walker directly —
 * NOT through the `REGISTRY_TABS` flag — and asserts every Setting the legacy
 * `cursorSettingsTabRenderer` creates is present, the family-grouped picker
 * actually mounts through the `widgets` seam (search + count badge, no
 * `render: () => undefined` stub), and representative fields round-trip onto
 * the real persisted paths (`cliPathsByHost` / `enabledModelsByHost`, not the
 * dead flat stubs — plan Decision 1).
 */
import '../../setup/obsidianDom';

import { Setting } from 'obsidian';

import { ProviderWorkspaceRegistry } from '../../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceServices } from '../../../src/core/providers/types';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';
import {
  resetCursorModelCatalog,
  seedCursorModelCatalogForTest,
} from '../../../src/providers/cursor/runtime/cursorModelCatalog';
import { cursorSettingsTabRenderer } from '../../../src/providers/cursor/ui/CursorSettingsTab';
import { getHostnameKey } from '../../../src/utils/env';
import {
  assertTabRendersRegistry,
  type MountedRegistryTab,
  mountRegistryTab,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

// Inventory of the legacy Cursor tab, derived from `cursorSettingsTabRenderer`
// (the source of truth, per plan Task 5). Ids are the REAL persisted settings
// paths for value-backed fields. The provider `enabled` toggle lives on the
// General tab; Cursor has no modelAliases setting (the old registry stub
// pointed at a path nothing reads).
const LEGACY_FIELD_IDS = [
  'providerConfigs.cursor.enabledModelsByHost',
  'providerConfigs.cursor.customModels',
  'providerConfigs.cursor.cliPathsByHost',
  'providerConfigs.cursor.environmentVariables',
];

const LEGACY_SECTION_IDS = ['models', 'environment'];

// Two families from three raw ids: `gpt-5.5` (standard + high modes) and
// `claude-sonnet-4-5`. `auto` is always excluded from the picker.
const CATALOG_IDS = ['auto', 'gpt-5.5', 'gpt-5.5-high', 'claude-sonnet-4-5'];

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

function mountCursor(): MountedRegistryTab {
  return mountRegistryTab({
    tabId: 'cursor',
    providerEnabled: true,
    tabContentIndex: 4,
    extraSettings: {
      providerConfigs: {
        cursor: {
          enabled: true,
          enabledModelsByHost: { [getHostnameKey()]: ['gpt-5.5-high'] },
        },
      },
    },
  });
}

function pickerRow(host: HTMLElement): Element | null {
  return fieldRow(host, 'providerConfigs.cursor.enabledModelsByHost');
}

function pickerRows(host: HTMLElement): HTMLElement[] {
  return Array.from(
    pickerRow(host)?.querySelectorAll<HTMLElement>('.claudian-cursor-model-picker-row') ?? [],
  );
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('cursor tab registry port', () => {
  let mounted: MountedRegistryTab | null = null;

  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    (Setting as unknown as { instances: unknown[] }).instances.length = 0;
    seedCursorModelCatalogForTest(CATALOG_IDS);
    ProviderWorkspaceRegistry.setServices('cursor', {
      cliResolver: { resolveFromSettings: jest.fn().mockReturnValue(null), reset: jest.fn() },
      // The REAL renderer: registry custom fields must reach the REAL widget
      // mounts through `ProviderWorkspaceRegistry.getSettingsTabRenderer`.
      settingsTabRenderer: cursorSettingsTabRenderer,
    } as unknown as ProviderWorkspaceServices);
  });

  afterEach(() => {
    mounted?.dispose();
    mounted = null;
    ProviderWorkspaceRegistry.setServices('cursor', undefined);
    resetCursorModelCatalog();
  });

  it('renders every legacy cursor field through the registry walker', () => {
    mounted = mountCursor();
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

    // Decision 1: the flat stubs are gone; only real persisted paths remain.
    expect(fieldRow(host, 'providerConfigs.cursor.cliPath')).toBeNull();
    expect(fieldRow(host, 'providerConfigs.cursor.enabledModels')).toBeNull();
    expect(fieldRow(host, 'providerConfigs.cursor.modelAliases')).toBeNull();

    assertTabRendersRegistry(host, plugin, 'cursor');
  });

  it('mounts the family-grouped picker for real (checkboxes, count badge, search)', () => {
    mounted = mountCursor();
    const { host } = mounted;

    // One checkbox per family (vendor-sorted: Anthropic before OpenAI), with
    // the mode count surfaced as the row hint.
    const rows = pickerRows(host);
    expect(rows.length).toBe(2);
    expect(rows[0]?.title).toBe('claude-sonnet-4-5');
    expect(rows[1]?.title).toBe('gpt-5.5');
    expect(
      rows[1]?.querySelector('.claudian-cursor-model-picker-row-id')?.textContent,
    ).toContain('2 modes');

    // gpt-5.5 is enabled through its `gpt-5.5-high` member.
    const checkboxes = rows.map((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[1]?.checked).toBe(true);

    // Count badge reflects family-level selection.
    expect(
      pickerRow(host)?.querySelector('.claudian-cursor-model-picker-count')?.textContent,
    ).toBe('1 of 2 families selected');

    // Search filters the family list.
    const searchInput = pickerRow(host)?.querySelector<HTMLInputElement>(
      '.claudian-cursor-model-picker-search',
    );
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'claude';
    searchInput!.dispatchEvent(new Event('input'));
    expect(pickerRows(host).length).toBe(1);
    expect(pickerRows(host)[0]?.title).toBe('claude-sonnet-4-5');

    // The refresh-models button is part of the picker widget.
    expect(componentFor(host, 'providerConfigs.cursor.enabledModelsByHost', 'button')).toBeDefined();
  });

  it('toggling a family persists its member ids into enabledModelsByHost', async () => {
    mounted = mountCursor();
    const { host, plugin } = mounted;

    const claudeCheckbox = pickerRows(host)[0]?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(claudeCheckbox?.checked).toBe(false);

    claudeCheckbox!.checked = true;
    claudeCheckbox!.dispatchEvent(new Event('change'));
    await flush();

    const cursorConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).cursor;
    const enabledByHost = cursorConfig.enabledModelsByHost as Record<string, string[]>;
    expect(enabledByHost[getHostnameKey()]).toEqual(
      expect.arrayContaining(['gpt-5.5-high', 'claude-sonnet-4-5']),
    );
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('persists the CLI path into the hostname-keyed map (not flat cliPath)', async () => {
    mounted = mountCursor();
    const { host, plugin } = mounted;

    const cliRow = fieldRow(host, 'providerConfigs.cursor.cliPathsByHost');
    expect(cliRow?.querySelector('.claudian-cli-path-validation')).not.toBeNull();

    const text = componentFor(host, 'providerConfigs.cursor.cliPathsByHost', 'text');
    expect(text).toBeDefined();

    // process.execPath exists and is a file, so validation passes.
    await (text?.props.changeHandler as (v: string) => Promise<void>)(process.execPath);

    const cursorConfig = (plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).cursor;
    expect((cursorConfig.cliPathsByHost as Record<string, string>)[getHostnameKey()]).toBe(
      process.execPath,
    );
    expect(cursorConfig.cliPath ?? '').toBe('');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('mounts the shared environment section (snippets + secret editor)', () => {
    mounted = mountCursor();
    const { host } = mounted;

    const envRow = fieldRow(host, 'providerConfigs.cursor.environmentVariables');
    expect(envRow?.querySelector('.claudian-env-snippets-container')).not.toBeNull();
    expect(envRow?.querySelector('.claudian-secret-env-vars')).not.toBeNull();
  });
});
