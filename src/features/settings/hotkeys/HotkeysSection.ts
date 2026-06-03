import type { App } from 'obsidian';
import { Platform } from 'obsidian';

import { getCommandHotkeys } from '@/core/commands/commandHotkeyRegistry';
import type { SettingsCtx } from '@/features/settings/registry/SettingsField';
import {
  getHotkeysForCommand,
  type ObsidianHotkey,
  openHotkeySettingsWithFilter,
} from '@/utils/obsidianPrivateApi';

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
 * Get the formatted hotkey binding string for a command from Obsidian's hotkeyManager.
 * Returns the joined display form, or `null` when no binding is set.
 */
function formatBoundHotkeys(app: App, commandId: string): string | null {
  const hotkeys = getHotkeysForCommand(app, commandId);
  return hotkeys ? hotkeys.map(formatHotkey).join(', ') : null;
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
  // Default implementation opens Obsidian's hotkey settings.
  const openSettings = openHotkeySettingsFor || ((commandId: string) => {
    openHotkeySettingsWithFilter(ctx.plugin.app, commandId);
  });

  host.empty();
  const container = host.createDiv({ cls: 'claudian-hotkeys-section' });

  const hotkeys = getCommandHotkeys();

  for (const hotkey of hotkeys) {
    const row = container.createDiv({ cls: 'claudian-hotkey-row' });

    // Command label
    row.createSpan({ cls: 'claudian-hotkey-command-label', text: hotkey.label });

    // Binding display
    const bindingText = formatBoundHotkeys(ctx.plugin.app, hotkey.commandId) || 'Unbound';
    const bindingEl = row.createSpan({
      cls: 'claudian-hotkey-binding-chip',
      text: bindingText,
    });
    if (bindingText === 'Unbound') {
      bindingEl.addClass('claudian-hotkey-binding-chip--unbound');
    }

    // Edit button
    const editBtn = row.createEl('button', {
      cls: 'claudian-hotkey-edit-button',
      text: 'Edit',
    });
    editBtn.addEventListener('click', () => {
      openSettings(hotkey.commandId);
    });
  }

  // Poll for hotkey changes — Obsidian doesn't emit a hotkey-changed event,
  // and the plugin's event bus is never wired to detect Obsidian-side hotkey
  // edits. Refresh bindings every 2s while the settings panel is open; the
  // cost is one map lookup per registered command. Self-cancels once the
  // host element is no longer connected to the DOM (settings panel closed
  // without re-render).
  const lastSeen = new Map<string, string>();
  for (const hotkey of hotkeys) {
    lastSeen.set(hotkey.commandId, formatBoundHotkeys(ctx.plugin.app, hotkey.commandId) ?? 'Unbound');
  }
  const intervalId = window.setInterval(() => {
    if (!host.isConnected) {
      window.clearInterval(intervalId);
      return;
    }
    let changed = false;
    for (const hotkey of hotkeys) {
      const current = formatBoundHotkeys(ctx.plugin.app, hotkey.commandId) ?? 'Unbound';
      if (lastSeen.get(hotkey.commandId) !== current) {
        changed = true;
        break;
      }
    }
    if (changed) {
      window.clearInterval(intervalId);
      renderHotkeysSection(ctx, host, openHotkeySettingsFor);
    }
  }, 2000);

  return () => {
    window.clearInterval(intervalId);
  };
}
