import type { App } from 'obsidian';

import { PRIVATE_SETTINGS_RENDER_DELAY_MS } from '../core/constants';

/**
 * Feature-detecting wrappers for Obsidian's undocumented internal APIs.
 *
 * `app.setting` and `app.hotkeyManager` are private surfaces — they have no
 * type definitions and Obsidian can rename them without notice. Centralizing
 * access here keeps the casts in one place, narrows the shape we depend on to
 * the bare minimum, and lets every caller fall back gracefully when a build
 * of Obsidian drops the surface (return `null`/`false` instead of throwing).
 */

export type ObsidianHotkey = { modifiers: string[]; key: string };

interface PrivateHotkeyManager {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
}

interface PrivateSettingsTab {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
}

interface PrivateSettingsController {
  activeTab?: PrivateSettingsTab;
  open: () => void;
  openTabById: (id: string) => void;
}

interface AppWithPrivates {
  hotkeyManager?: PrivateHotkeyManager;
  setting?: PrivateSettingsController;
}

function asAppWithPrivates(app: App): AppWithPrivates {
  return app as unknown as AppWithPrivates;
}

export function getHotkeyManager(app: App): PrivateHotkeyManager | null {
  const manager = asAppWithPrivates(app).hotkeyManager;
  if (!manager || typeof manager !== 'object') {
    return null;
  }
  return manager;
}

export function getSettingsController(app: App): PrivateSettingsController | null {
  const controller = asAppWithPrivates(app).setting;
  if (
    !controller
    || typeof controller.open !== 'function'
    || typeof controller.openTabById !== 'function'
  ) {
    return null;
  }
  return controller;
}

/**
 * Returns the resolved hotkeys (custom override > built-in default) for a
 * command id, or `null` when the manager is unavailable or no binding is set.
 */
export function getHotkeysForCommand(app: App, commandId: string): ObsidianHotkey[] | null {
  const manager = getHotkeyManager(app);
  if (!manager) {
    return null;
  }
  const custom = manager.customKeys?.[commandId];
  const fallback = manager.defaultKeys?.[commandId];
  const hotkeys = custom && custom.length > 0 ? custom : fallback;
  return hotkeys && hotkeys.length > 0 ? hotkeys : null;
}

/**
 * Opens Obsidian's hotkeys settings tab and pre-fills the search filter.
 * Returns `false` when the private settings surface is unavailable.
 */
export function openHotkeySettingsWithFilter(app: App, filter: string): boolean {
  const setting = getSettingsController(app);
  if (!setting) {
    return false;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = filter;
    tab.updateHotkeyVisibility?.();
  }, PRIVATE_SETTINGS_RENDER_DELAY_MS);
  return true;
}

/**
 * Opens the settings dialog focused on the given plugin tab id.
 * Returns `false` when the private settings surface is unavailable.
 */
export function openPluginSettingsTab(app: App, pluginId: string): boolean {
  const setting = getSettingsController(app);
  if (!setting) {
    return false;
  }
  setting.open();
  setting.openTabById(pluginId);
  return true;
}
