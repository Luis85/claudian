/**
 * @jest-environment jsdom
 */
import '../../../../../setup/obsidianDom';

jest.mock('../../../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getChatUIConfig: jest.fn(),
    getRegisteredProviderIds: jest.fn().mockReturnValue(['claude', 'codex', 'opencode', 'cursor']),
    getProviderDisplayName: jest.fn().mockImplementation((id: string) =>
      ({ claude: 'Claude', codex: 'Codex', opencode: 'Opencode', cursor: 'Cursor' })[id] ?? id,
    ),
  },
}));

import { Setting } from 'obsidian';

import { ProviderRegistry } from '../../../../../../src/core/providers/ProviderRegistry';
import { registerAgentBoardTabFields } from '../../../../../../src/features/settings/registry/fields/agentBoard';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';
import type { SettingsCtx, SettingsField } from '../../../../../../src/features/settings/registry/SettingsField';

const getChatUIConfig = ProviderRegistry.getChatUIConfig as jest.Mock;

function lastSetting(): Setting {
  const instances = (Setting as any).instances as Setting[];
  return instances[instances.length - 1];
}

function lastDropdown(): { value: string; options: Array<{ value: string; label: string }>; changeHandler: (v: string) => void } | null {
  const components = (lastSetting() as any).components as Array<{ kind: string; props: any }>;
  for (let i = components.length - 1; i >= 0; i -= 1) {
    if (components[i].kind === 'dropdown') return components[i].props;
  }
  return null;
}

function lastText(): { value: string; disabled: boolean } | null {
  const components = (lastSetting() as any).components as Array<{ kind: string; props: any }>;
  for (let i = components.length - 1; i >= 0; i -= 1) {
    if (components[i].kind === 'text') return components[i].props;
  }
  return null;
}

function settingHasDropdown(): boolean {
  const components = (lastSetting() as any).components as Array<{ kind: string }>;
  return components.some((c) => c.kind === 'dropdown');
}

describe('Agent Board tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
    getChatUIConfig.mockReset();
    (Setting as any).instances = [];
  });

  it('registers the Agent Board tab as always visible', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: {} } as any);
    const tab = tabs.find((t) => t.id === 'agentBoard');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('Agent Board');
    expect(tab?.order).toBe(60);
  });

  it('registers 5 sections under Agent Board in spec order', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('agentBoard', { providerConfigs: {} } as any);
    expect(sections.map((s) => s.id)).toEqual([
      'folders',
      'defaults',
      'lanes',
      'templates',
      'archive',
    ]);
  });

  it('registers agentBoardWorkOrderFolder in folders section with correct default', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('agentBoard', 'folders', { providerConfigs: {} } as any);
    const workOrderFolder = fields.find((f) => f.id === 'agentBoardWorkOrderFolder');
    expect(workOrderFolder).toBeDefined();
    expect(workOrderFolder?.label).toBe('Work order folder');
    expect(workOrderFolder?.default).toBe('Agent Board/tasks');
    expect(workOrderFolder?.sectionId).toBe('folders');
    expect(workOrderFolder?.type.kind).toBe('folder');
  });

  it('registers agentBoardDefaultModel as always visible — the custom widget handles the no-provider state internally', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields(
      'agentBoard',
      'defaults',
      { providerConfigs: {}, agentBoardDefaultProvider: null } as any,
    );
    const model = fields.find((f) => f.id === 'agentBoardDefaultModel');
    expect(model).toBeDefined();
    expect(model?.type.kind).toBe('custom');
    expect(model?.default).toBeNull();
  });

  it('registers installCommonTemplatesButton in templates section as a button field', () => {
    registerAgentBoardTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('agentBoard', 'templates', { providerConfigs: {} } as any);
    const button = fields.find((f) => f.id === 'installCommonTemplatesButton');
    expect(button).toBeDefined();
    expect(button?.sectionId).toBe('templates');
    const type = button!.type;
    expect(type.kind).toBe('button');
    if (type.kind !== 'button') {
      throw new Error('installCommonTemplatesButton type must be button');
    }
    expect(type.label).toBe('Install common templates');
  });

  describe('agentBoardDefaultProvider custom field', () => {
    function makeCtx(
      enabled: string[],
      stored: string | null = null,
    ): {
      ctx: SettingsCtx;
      saveSettings: jest.Mock;
      refresh: jest.Mock;
      onSpy: jest.Mock;
      unsubscribe: jest.Mock;
    } {
      const saveSettings = jest.fn().mockResolvedValue(undefined);
      const refresh = jest.fn();
      const unsubscribe = jest.fn();
      const onSpy = jest.fn(() => unsubscribe);
      const providers = ['claude', 'codex', 'opencode', 'cursor'];
      const ctx: SettingsCtx = {
        settings: {
          agentBoardDefaultProvider: stored,
          providerConfigs: Object.fromEntries(
            providers.map((id) => [id, { enabled: enabled.includes(id) }]),
          ),
        } as any,
        saveSettings,
        refresh,
        plugin: { events: { on: onSpy } } as any,
      };
      return { ctx, saveSettings, refresh, onSpy, unsubscribe };
    }

    function getField(): SettingsField {
      registerAgentBoardTabFields();
      const r = getSettingsRegistry();
      const fields = r.getFields(
        'agentBoard',
        'defaults',
        { providerConfigs: {} } as any,
      );
      const field = fields.find((f) => f.id === 'agentBoardDefaultProvider');
      if (!field) {
        throw new Error('agentBoardDefaultProvider field is not registered');
      }
      return field;
    }

    function render(field: SettingsField, ctx: SettingsCtx, host: HTMLElement): void | (() => void) {
      if (field.type.kind !== 'custom') {
        throw new Error('expected custom-kind field');
      }
      return field.type.render(ctx, host);
    }

    it('is registered as a custom-kind field with default null', () => {
      const field = getField();
      expect(field.type.kind).toBe('custom');
      expect(field.default).toBeNull();
    });

    it('0 enabled — renders Setting row without interactive control', () => {
      const field = getField();
      const { ctx } = makeCtx([]);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(settingHasDropdown()).toBe(false);
      expect(lastText()).toBeNull();
      expect(lastSetting().setName).toHaveBeenCalledWith('Default provider');
    });

    it('1 enabled — renders disabled text input locking the only valid provider', () => {
      const field = getField();
      const { ctx, saveSettings } = makeCtx(['claude']);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(settingHasDropdown()).toBe(false);
      const text = lastText();
      expect(text).not.toBeNull();
      expect(text!.value).toBe('Claude');
      expect(text!.disabled).toBe(true);
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('>=2 enabled — renders dropdown with enabled providers as options and writes through on change', async () => {
      const field = getField();
      const { ctx, saveSettings, refresh } = makeCtx(['claude', 'codex'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      const dropdown = lastDropdown();
      expect(dropdown).not.toBeNull();
      const optionValues = dropdown!.options.map((o) => o.value);
      expect(optionValues).toEqual(['claude', 'codex']);
      expect(dropdown!.value).toBe('claude');

      dropdown!.changeHandler('codex');
      await Promise.resolve();
      await Promise.resolve();
      expect((ctx.settings as any).agentBoardDefaultProvider).toBe('codex');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('>=2 enabled — falls back to resolver pick when stored is null', () => {
      const field = getField();
      const { ctx } = makeCtx(['codex', 'opencode'], null);
      const host = document.createElement('div');
      render(field, ctx, host);

      const dropdown = lastDropdown();
      expect(dropdown).not.toBeNull();
      expect(dropdown!.value).toBe('codex');
    });

    it('subscribes to task:board-config-changed and returns the unsubscribe', () => {
      const field = getField();
      const { ctx, onSpy, unsubscribe } = makeCtx(['claude', 'codex']);
      const host = document.createElement('div');
      const cleanup = render(field, ctx, host);

      expect(onSpy).toHaveBeenCalledTimes(1);
      expect(onSpy.mock.calls[0][0]).toBe('task:board-config-changed');
      expect(typeof cleanup).toBe('function');
      (cleanup as () => void)();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('re-renders only its own host (does not call ctx.refresh) when task:board-config-changed fires', () => {
      const field = getField();
      const { ctx, onSpy, refresh } = makeCtx(['claude', 'codex']);
      // Attach host to the document so `host.isConnected` is true, matching
      // production where ClaudianSettings.display() always mounts hosts. The
      // production listener skips re-rendering when the host is detached, to
      // prevent wasted work on hosts that display() already discarded.
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        render(field, ctx, host);

        // Baseline: render produced one Setting row inside the host.
        const settingsBefore = (Setting as any).instances.length;

        const handler = onSpy.mock.calls[0][1] as () => void;
        handler();

        // Fix 2: full ctx.refresh() (i.e. ClaudianSettings.display()) wiped the lane
        // editor mid-event. The widget must only re-render its own host.
        expect(refresh).not.toHaveBeenCalled();
        expect((Setting as any).instances.length).toBeGreaterThan(settingsBefore);
      } finally {
        document.body.removeChild(host);
      }
    });

    it('skips re-rendering when the host has been detached (stale listener after display)', () => {
      // Regression guard for the `host.isConnected` defensive check: a listener
      // that fires from a snapshotted handler set after ClaudianSettings.display()
      // has detached the old host must not re-render into the dead DOM.
      const field = getField();
      const { ctx, onSpy } = makeCtx(['claude', 'codex']);
      const host = document.createElement('div');
      // Never attach `host` — simulates a host that display() already detached.
      render(field, ctx, host);
      const settingsBefore = (Setting as any).instances.length;

      const handler = onSpy.mock.calls[0][1] as () => void;
      handler();

      expect((Setting as any).instances.length).toBe(settingsBefore);
    });
  });

  describe('agentBoardDefaultModel custom field', () => {
    function makeCtx(
      enabled: string[],
      storedProvider: string | null = null,
      storedModel: string | null = null,
    ): {
      ctx: SettingsCtx;
      saveSettings: jest.Mock;
      refresh: jest.Mock;
      onSpy: jest.Mock;
      unsubscribe: jest.Mock;
    } {
      const saveSettings = jest.fn().mockResolvedValue(undefined);
      const refresh = jest.fn();
      const unsubscribe = jest.fn();
      const onSpy = jest.fn(() => unsubscribe);
      const providers = ['claude', 'codex', 'opencode', 'cursor'];
      const ctx: SettingsCtx = {
        settings: {
          agentBoardDefaultProvider: storedProvider,
          agentBoardDefaultModel: storedModel,
          providerConfigs: Object.fromEntries(
            providers.map((id) => [id, { enabled: enabled.includes(id) }]),
          ),
        } as any,
        saveSettings,
        refresh,
        plugin: { events: { on: onSpy } } as any,
      };
      return { ctx, saveSettings, refresh, onSpy, unsubscribe };
    }

    function getField(): SettingsField {
      registerAgentBoardTabFields();
      const r = getSettingsRegistry();
      const fields = r.getFields(
        'agentBoard',
        'defaults',
        { providerConfigs: {} } as any,
      );
      const field = fields.find((f) => f.id === 'agentBoardDefaultModel');
      if (!field) {
        throw new Error('agentBoardDefaultModel field is not registered');
      }
      return field;
    }

    function render(field: SettingsField, ctx: SettingsCtx, host: HTMLElement): void | (() => void) {
      if (field.type.kind !== 'custom') {
        throw new Error('expected custom-kind field');
      }
      return field.type.render(ctx, host);
    }

    it('is registered as a custom-kind field with default null', () => {
      const field = getField();
      expect(field.type.kind).toBe('custom');
      expect(field.default).toBeNull();
    });

    it('no provider resolvable — renders Setting row without interactive control', () => {
      const field = getField();
      const { ctx } = makeCtx([]);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(settingHasDropdown()).toBe(false);
      expect(lastText()).toBeNull();
      expect(lastSetting().setName).toHaveBeenCalledWith('Default model');
      expect(getChatUIConfig).not.toHaveBeenCalled();
    });

    it('provider with 0 models — renders Setting row without interactive control', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: () => false,
        getModelOptions: () => [],
      });
      const field = getField();
      const { ctx } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(settingHasDropdown()).toBe(false);
      expect(lastText()).toBeNull();
      expect(lastSetting().setName).toHaveBeenCalledWith('Default model');
    });

    it('provider with 1 model — renders disabled text input locking the only valid model', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: (m: string) => m === 'sonnet',
        getModelOptions: () => [{ value: 'sonnet', label: 'Sonnet' }],
      });
      const field = getField();
      const { ctx, saveSettings } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(settingHasDropdown()).toBe(false);
      const text = lastText();
      expect(text).not.toBeNull();
      expect(text!.value).toBe('Sonnet');
      expect(text!.disabled).toBe(true);
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('provider with >=2 models — renders dropdown and writes through on change', async () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: (m: string) => m === 'haiku' || m === 'sonnet',
        getModelOptions: () => [
          { value: 'haiku', label: 'Haiku' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
      });
      const field = getField();
      const { ctx, saveSettings } = makeCtx(['claude'], 'claude', 'haiku');
      const host = document.createElement('div');
      render(field, ctx, host);

      const dropdown = lastDropdown();
      expect(dropdown).not.toBeNull();
      const optionValues = dropdown!.options.map((o) => o.value);
      expect(optionValues).toEqual(['', 'haiku', 'sonnet']);
      expect(dropdown!.value).toBe('haiku');

      dropdown!.changeHandler('sonnet');
      await Promise.resolve();
      await Promise.resolve();
      expect((ctx.settings as any).agentBoardDefaultModel).toBe('sonnet');
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('provider with >=2 models — falls back to resolver-picked default when stored model is invalid', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: (m: string) => m === 'haiku' || m === 'sonnet',
        getModelOptions: () => [
          { value: 'haiku', label: 'Haiku' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
      });
      const field = getField();
      const { ctx } = makeCtx(['claude'], 'claude', 'gpt-4');
      const host = document.createElement('div');
      render(field, ctx, host);

      const dropdown = lastDropdown();
      expect(dropdown).not.toBeNull();
      // resolveAgentBoardDefaultModel falls back to the first available option
      // when the stored model is not in the provider's catalog.
      expect(dropdown!.value).toBe('haiku');
    });

    it('subscribes to task:board-config-changed and returns the unsubscribe', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: () => false,
        getModelOptions: () => [],
      });
      const field = getField();
      const { ctx, onSpy, unsubscribe } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      const cleanup = render(field, ctx, host);

      expect(onSpy).toHaveBeenCalledTimes(1);
      expect(onSpy.mock.calls[0][0]).toBe('task:board-config-changed');
      expect(typeof cleanup).toBe('function');
      (cleanup as () => void)();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('re-renders only its own host (does not call ctx.refresh) when task:board-config-changed fires', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: () => false,
        getModelOptions: () => [],
      });
      const field = getField();
      const { ctx, onSpy, refresh } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        render(field, ctx, host);

        const settingsBefore = (Setting as any).instances.length;
        const handler = onSpy.mock.calls[0][1] as () => void;
        handler();

        expect(refresh).not.toHaveBeenCalled();
        expect((Setting as any).instances.length).toBeGreaterThan(settingsBefore);
      } finally {
        document.body.removeChild(host);
      }
    });

    it('skips re-rendering when the host has been detached (stale listener after display)', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: () => false,
        getModelOptions: () => [],
      });
      const field = getField();
      const { ctx, onSpy } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);
      const settingsBefore = (Setting as any).instances.length;

      const handler = onSpy.mock.calls[0][1] as () => void;
      handler();

      expect((Setting as any).instances.length).toBe(settingsBefore);
    });
  });
});

describe('agentBoard.ts boundary', () => {
  it('does not export hardcoded PROVIDER_IDS or PROVIDER_LABELS', async () => {
    const agentBoardFields = await import(
      '../../../../../../src/features/settings/registry/fields/agentBoard'
    );
    expect((agentBoardFields as Record<string, unknown>).PROVIDER_IDS).toBeUndefined();
    expect((agentBoardFields as Record<string, unknown>).PROVIDER_LABELS).toBeUndefined();
  });
});
