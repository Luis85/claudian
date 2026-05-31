interface KeyBinding {
  modifiers: string[];
  key: string;
}

export interface CommandHotkey {
  commandId: string;
  label: string;
  defaultBinding?: KeyBinding;
}

const commandHotkeys: CommandHotkey[] = [];

export function registerCommandHotkey(entry: CommandHotkey): void {
  // Check for duplicate commandId
  if (commandHotkeys.some((h) => h.commandId === entry.commandId)) {
    throw new Error(`Duplicate hotkey entry for command "${entry.commandId}"`);
  }
  commandHotkeys.push(entry);
}

export function getCommandHotkeys(): CommandHotkey[] {
  return [...commandHotkeys];
}

export function resetCommandHotkeysForTests(): void {
  commandHotkeys.length = 0;
}
