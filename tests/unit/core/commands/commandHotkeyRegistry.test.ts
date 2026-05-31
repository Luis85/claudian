import {
  getCommandHotkeys,
  registerCommandHotkey,
  resetCommandHotkeysForTests,
} from '../../../../src/core/commands/commandHotkeyRegistry';

describe('commandHotkeyRegistry', () => {
  beforeEach(() => {
    resetCommandHotkeysForTests();
  });

  it('registerCommandHotkey adds an entry', () => {
    registerCommandHotkey({
      commandId: 'test:cmd1',
      label: 'Test Command 1',
    });
    const hotkeys = getCommandHotkeys();
    expect(hotkeys).toHaveLength(1);
    expect(hotkeys[0].commandId).toBe('test:cmd1');
    expect(hotkeys[0].label).toBe('Test Command 1');
  });

  it('registerCommandHotkey accepts optional defaultBinding', () => {
    registerCommandHotkey({
      commandId: 'test:cmd2',
      label: 'Test Command 2',
      defaultBinding: { modifiers: ['Mod'], key: 'K' },
    });
    const hotkeys = getCommandHotkeys();
    expect(hotkeys[0].defaultBinding).toEqual({ modifiers: ['Mod'], key: 'K' });
  });

  it('getCommandHotkeys returns entries in insertion order', () => {
    registerCommandHotkey({
      commandId: 'test:first',
      label: 'First',
    });
    registerCommandHotkey({
      commandId: 'test:second',
      label: 'Second',
    });
    registerCommandHotkey({
      commandId: 'test:third',
      label: 'Third',
    });
    const hotkeys = getCommandHotkeys();
    expect(hotkeys.map((h) => h.commandId)).toEqual(['test:first', 'test:second', 'test:third']);
  });

  it('duplicate commandId throws error', () => {
    registerCommandHotkey({
      commandId: 'test:dup',
      label: 'Original',
    });
    expect(() =>
      registerCommandHotkey({
        commandId: 'test:dup',
        label: 'Duplicate',
      }),
    ).toThrow(/duplicate hotkey entry/i);
  });

  it('resetCommandHotkeysForTests clears entries', () => {
    registerCommandHotkey({
      commandId: 'test:will-reset',
      label: 'Will be reset',
    });
    expect(getCommandHotkeys()).toHaveLength(1);
    resetCommandHotkeysForTests();
    expect(getCommandHotkeys()).toHaveLength(0);
  });
});
