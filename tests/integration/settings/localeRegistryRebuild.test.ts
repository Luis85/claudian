/**
 * @jest-environment jsdom
 */
/**
 * Locale changes must rebuild the settings registry: field labels and
 * descriptions are captured by `t()` at registration time, so a registry
 * built under the previous locale keeps rendering the old language until
 * plugin reload (Codex review on PR #82).
 */

import '../../setup/obsidianDom';

import { SpecoratorSettingTab } from '../../../src/features/settings/SpecoratorSettings';
import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../src/features/settings/registry';
import { setLocale } from '../../../src/i18n/i18n';
import {
  configureProviderRegistryMock,
  createStubPlugin,
} from './_portTestHelpers';

jest.mock('../../../src/core/providers/ProviderRegistry');

const OPTS = { tabId: 'general', tabContentIndex: 0 };

function mountTab() {
  configureProviderRegistryMock(OPTS);
  const plugin = createStubPlugin(OPTS);
  const tab = new SpecoratorSettingTab({} as never, plugin as never);
  (tab as unknown as { containerEl: HTMLElement }).containerEl =
    document.createElement('div');
  (
    tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }
  ).renderGeneralTab = jest.fn();
  return { plugin, tab };
}

function localeFieldLabel(settings: unknown): string | undefined {
  return getSettingsRegistry()
    .getFields('general', 'general', settings as never)
    .find((field) => field.id === 'locale')?.label;
}

describe('settings registry locale rebuild', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  afterEach(() => {
    // Locale is module-global within this test file; restore for hygiene.
    setLocale('en');
  });

  it('re-registers fields under the new locale on the next display()', () => {
    const { plugin, tab } = mountTab();
    plugin.settings.locale = 'en';

    tab.display();
    expect(localeFieldLabel(plugin.settings)).toBe('Language');

    plugin.settings.locale = 'de';
    tab.display();
    expect(localeFieldLabel(plugin.settings)).toBe('Sprache');

    // The registry tab re-rendered against the rebuilt registry (renderField
    // reads field.label at render time; the DOM polyfill doesn't materialize
    // Setting name text, so label content is asserted on the registry above).
    const containerEl = (tab as unknown as { containerEl: HTMLElement })
      .containerEl;
    expect(containerEl.querySelector('[data-field-id="locale"]')).not.toBeNull();
  });

  it('does not rebuild when the locale is unchanged', () => {
    const { plugin, tab } = mountTab();
    plugin.settings.locale = 'en';

    tab.display();
    const registryBefore = getSettingsRegistry();
    tab.display();
    // Same singleton: no reset happened between identical-locale renders.
    expect(getSettingsRegistry()).toBe(registryBefore);
  });
});
