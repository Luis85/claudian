import type { App } from 'obsidian';
import { Platform } from 'obsidian';

import { getCommandHotkeys } from '@/core/commands/commandHotkeyRegistry';
import type { SettingsCtx } from '@/features/settings/registry/SettingsField';

export type ObsidianHotkey = { modifiers: string[]; key: string };
export type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
export type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
};

/**
 * Format a single hotkey object into a display string (e.g. "Ctrl+Shift+B")
 */
function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

/**
 * Get the formatted hotkey binding for a command from Obsidian's hotkeyManager
 */
function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

/**
 * Render the Hotkeys section with live bindings
 * @param ctx Settings context with plugin and event bus
 * @param host DOM element to render into
 * @param openHotkeySettingsFor Optional callback to open Obsidian hotkey settings for a command
 * @returns Cleanup function to unsubscribe from events
 */
export function renderHotkeysSection(
  ctx: SettingsCtx,
  host: HTMLElement,
  openHotkeySettingsFor?: (commandId: string) => void,
): () => void {
  // Default implementation opens Obsidian's hotkey settings
  const openSettings = openHotkeySettingsFor || ((commandId: string) => {
    const setting = (ctx.plugin.app as any).setting;
    if (!setting) {
      return;
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

      searchEl.value = commandId;
      tab.updateHotkeyVisibility?.();
    }, 100);
  });

  host.empty();
  const container = host.createDiv({ cls: 'hotkeys-section' });

  const hotkeys = getCommandHotkeys();

  for (const hotkey of hotkeys) {
    const row = container.createDiv({ cls: 'hotkey-row' });

    // Command label
    row.createSpan({ cls: 'hotkey-command-label', text: hotkey.label });

    // Binding display
    const bindingText = getHotkeyForCommand(ctx.plugin.app, hotkey.commandId) || 'Unbound';
    row.createSpan({
      cls: 'hotkey-binding-chip',
      text: bindingText,
    });

    // Edit button
    const editBtn = row.createEl('button', {
      cls: 'hotkey-edit-button',
      text: 'Edit',
    });
    editBtn.addEventListener('click', () => {
      openSettings(hotkey.commandId);
    });
  }

  // Subscribe to hotkey-changed event to re-render when bindings change
  const unsubscribe = ctx.plugin.events.on('hotkey-changed', (commandId: string) => {
    // Re-render the entire section when hotkeys change
    renderHotkeysSection(ctx, host, openHotkeySettingsFor);
  });

  // Return cleanup function
  return unsubscribe;
}
