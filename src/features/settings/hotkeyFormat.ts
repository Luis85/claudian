import type { App } from 'obsidian';
import { Platform } from 'obsidian';

import { getHotkeysForCommand, type ObsidianHotkey } from '../../utils/obsidianPrivateApi';

/**
 * Format a single hotkey object into a display string (e.g. "Ctrl+Shift+B").
 * macOS uses the symbol glyphs joined without separators; other platforms use
 * the spelled-out modifier names joined with "+".
 */
export function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

/**
 * Get the formatted hotkey binding string for a command from Obsidian's
 * hotkeyManager. Returns the joined display form, or `null` when no binding is
 * set.
 */
export function formatBoundHotkeys(app: App, commandId: string): string | null {
  const hotkeys = getHotkeysForCommand(app, commandId);
  return hotkeys ? hotkeys.map(formatHotkey).join(', ') : null;
}
