/**
 * @jest-environment jsdom
 */

import '../../../../setup/obsidianDom';

import {
  registerCommandHotkey,
  resetCommandHotkeysForTests,
} from '@/core/commands/commandHotkeyRegistry';
import type { SpecoratorSettings } from '@/core/types/settings';
import { renderHotkeysSection } from '@/features/settings/hotkeys/HotkeysSection';
import type { SettingsCtx } from '@/features/settings/registry/SettingsField';
import type SpecoratorPlugin from '@/main';

describe('HotkeysSection', () => {
  let host: HTMLElement;
  let ctx: SettingsCtx;
  let mockPlugin: SpecoratorPlugin;

  beforeEach(() => {
    resetCommandHotkeysForTests();

    host = document.createElement('div');
    document.body.appendChild(host);

    mockPlugin = {
      app: {
        hotkeyManager: {
          customKeys: {},
          defaultKeys: {},
        },
      },
      events: {
        on: jest.fn((eventName, handler) => {
          // Stub: tests verify subscription, not event handling
          return jest.fn();
        }),
      },
    } as unknown as SpecoratorPlugin;

    ctx = {
      settings: {} as SpecoratorSettings,
      saveSettings: jest.fn(),
      refresh: jest.fn(),
      plugin: mockPlugin,
    };
  });

  afterEach(() => {
    if (host.parentElement) {
      host.parentElement.removeChild(host);
    }
    resetCommandHotkeysForTests();
  });

  it('renders one row per registered command', () => {
    registerCommandHotkey({
      commandId: 'specorator:test-cmd1',
      label: 'Test Command 1',
    });
    registerCommandHotkey({
      commandId: 'specorator:test-cmd2',
      label: 'Test Command 2',
    });

    const dispose = renderHotkeysSection(ctx, host);

    const rows = host.querySelectorAll('.specorator-hotkey-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.specorator-hotkey-command-label')?.textContent).toContain('Test Command 1');
    expect(rows[1].querySelector('.specorator-hotkey-command-label')?.textContent).toContain('Test Command 2');
    dispose();
  });

  it('shows "Unbound" when no binding exists', () => {
    registerCommandHotkey({
      commandId: 'specorator:unbound-cmd',
      label: 'Unbound Command',
    });

    const dispose = renderHotkeysSection(ctx, host);

    const chip = host.querySelector('.specorator-hotkey-binding-chip');
    expect(chip?.textContent).toContain('Unbound');
    expect(chip?.classList.contains('specorator-hotkey-binding-chip--unbound')).toBe(true);
    dispose();
  });

  it('shows formatted hotkey when bound', () => {
    registerCommandHotkey({
      commandId: 'specorator:bound-cmd',
      label: 'Bound Command',
    });

    const mockAppWithHotkeys = {
      ...mockPlugin.app,
      hotkeyManager: {
        customKeys: {
          'specorator:bound-cmd': [{ modifiers: ['Ctrl'], key: 'K' }],
        },
        defaultKeys: {},
      },
    };
    mockPlugin.app = mockAppWithHotkeys as any;

    const dispose = renderHotkeysSection(ctx, host);

    const chip = host.querySelector('.specorator-hotkey-binding-chip');
    // Accept both Windows (Ctrl+K) and macOS (⌃K) formats depending on platform
    expect(chip?.textContent).toMatch(/Ctrl\+K|⌃K/);
    dispose();
  });

  it('calls openHotkeySettingsFor when edit button clicked', () => {
    registerCommandHotkey({
      commandId: 'specorator:edit-test',
      label: 'Edit Test Command',
    });

    const openHotkeySettingsFor = jest.fn();
    const dispose = renderHotkeysSection(ctx, host, openHotkeySettingsFor);

    const editBtn = host.querySelector('.specorator-hotkey-edit-button') as HTMLButtonElement;
    expect(editBtn).toBeTruthy();

    editBtn?.click();

    expect(openHotkeySettingsFor).toHaveBeenCalledWith('specorator:edit-test');
    dispose();
  });

  it('returns a disposer that clears the poll interval', () => {
    registerCommandHotkey({
      commandId: 'specorator:reactive-cmd',
      label: 'Reactive Command',
    });

    const clearSpy = jest.spyOn(window, 'clearInterval');
    const dispose = renderHotkeysSection(ctx, host);
    expect(typeof dispose).toBe('function');
    dispose();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
