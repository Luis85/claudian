import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { asSettingsBag, type ClaudianSettings } from '../../core/types/settings';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';
import {
  registerAllSettings,
  resetSettingsRegistry,
  useRegistryRenderer,
} from './registry';

// String id of a settings tab. The first three are fixed; the rest are
// enabled provider ids resolved at render time.
export type SettingsTabId = string;

// Fixed tabs that always lead the strip, in display order.
const FIXED_TAB_IDS: readonly SettingsTabId[] = ['general', 'agentBoard', 'diagnostics'];

/**
 * Resolve the ordered tab id list for the current settings: the three fixed
 * tabs followed by every enabled provider tab. Extracted so the strip ordering
 * lives in one place and `renderTabs` stays declarative.
 */
export function computeTabIds(settings: ClaudianSettings): SettingsTabId[] {
  const providerTabs = ProviderRegistry.getEnabledProviderIds(asSettingsBag(settings));
  return [...FIXED_TAB_IDS, ...providerTabs];
}

/**
 * Visible label for a tab. The fixed tabs use literal/i18n labels matching the
 * legacy switch; everything else is a provider id resolved to its display name.
 */
export function tabLabelFor(id: SettingsTabId): string {
  if (id === 'general') return t('settings.tabs.general' as TranslationKey);
  if (id === 'agentBoard') return 'Agent Board';
  if (id === 'diagnostics') return 'Diagnostics';
  return ProviderRegistry.getProviderDisplayName(id);
}

/**
 * Lazily (re)build the settings registry for the active locale and return the
 * locale the registry is now registered under.
 *
 * Field labels/descriptions are captured by `t()` at registration time, so a
 * registry built under the previous locale would keep rendering the old
 * language until plugin reload (PR #82 review). The caller runs `setLocale`
 * before this, so re-registration captures the new translations. The locale
 * guard also prevents `registerAllSettings` (which throws on duplicate
 * registration) from running twice.
 *
 * Returns `registryLocale` unchanged when no visible tab needs the registry or
 * the locale is unchanged, so the caller can store the result verbatim.
 */
export function ensureRegistryForLocale(
  tabIds: readonly SettingsTabId[],
  locale: string,
  registryLocale: string | null,
): string | null {
  if (!tabIds.some(useRegistryRenderer)) return registryLocale;
  if (registryLocale === locale) return registryLocale;
  if (registryLocale !== null) {
    resetSettingsRegistry();
  }
  registerAllSettings();
  return locale;
}

/**
 * Build the tab-bar buttons, wiring each button's click to flip the
 * active-tab modifier class across every button/content pair. Returns the
 * button and (empty) content maps; the content map is populated by
 * `buildTabContents`. Click handling toggles classes in place rather than
 * re-rendering, matching the legacy inline behavior exactly.
 */
export function buildTabBar(
  tabBar: HTMLElement,
  tabIds: readonly SettingsTabId[],
  activeTab: SettingsTabId,
  onActivate: (id: SettingsTabId) => void,
  tabButtons: Map<SettingsTabId, HTMLButtonElement>,
  tabContents: Map<SettingsTabId, HTMLDivElement>,
): void {
  for (const id of tabIds) {
    const button = tabBar.createEl('button', {
      cls: `claudian-settings-tab${id === activeTab ? ' claudian-settings-tab--active' : ''}`,
      attr: { 'data-tab-id': id },
      text: tabLabelFor(id),
    });
    button.addEventListener('click', () => {
      onActivate(id);
      for (const tabId of tabIds) {
        tabButtons.get(tabId)?.toggleClass('claudian-settings-tab--active', tabId === id);
        tabContents
          .get(tabId)
          ?.toggleClass('claudian-settings-tab-content--active', tabId === id);
      }
    });
    tabButtons.set(id, button);
  }
}

/**
 * Create the per-tab content host divs (one per tab id) under `containerEl`,
 * marking the active tab's content visible. Populates `tabContents`.
 */
export function buildTabContents(
  containerEl: HTMLElement,
  tabIds: readonly SettingsTabId[],
  activeTab: SettingsTabId,
  tabContents: Map<SettingsTabId, HTMLDivElement>,
): void {
  for (const id of tabIds) {
    const content = containerEl.createDiv({
      cls: `claudian-settings-tab-content${id === activeTab ? ' claudian-settings-tab-content--active' : ''}`,
    });
    tabContents.set(id, content);
  }
}
