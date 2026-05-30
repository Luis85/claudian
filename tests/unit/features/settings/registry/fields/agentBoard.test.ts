/**
 * @jest-environment jsdom
 */
import '../../../../../setup/obsidianDom';

jest.mock('../../../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getChatUIConfig: jest.fn(),
  },
}));

import { ProviderRegistry } from '../../../../../../src/core/providers/ProviderRegistry';
import { registerAgentBoardTabFields } from '../../../../../../src/features/settings/registry/fields/agentBoard';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';
import type { SettingsCtx, SettingsField } from '../../../../../../src/features/settings/registry/SettingsField';

const getChatUIConfig = ProviderRegistry.getChatUIConfig as jest.Mock;

describe('Agent Board tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
    getChatUIConfig.mockReset();
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

    it('0 enabled — renders disabled message without interactive control', () => {
      const field = getField();
      const { ctx } = makeCtx([]);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(host.querySelector('select')).toBeNull();
      const message = host.querySelector('p.setting-item-description');
      expect(message).not.toBeNull();
      expect(message?.textContent).toContain('Enable a provider');
    });

    it('1 enabled — renders read-only chip showing the locked provider name', () => {
      const field = getField();
      const { ctx, saveSettings } = makeCtx(['claude']);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(host.querySelector('select')).toBeNull();
      const chip = host.querySelector('.claudian-default-provider-chip');
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain('Claude');
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('>=2 enabled — renders editable dropdown with enabled providers as options and writes through on change', async () => {
      const field = getField();
      const { ctx, saveSettings, refresh } = makeCtx(['claude', 'codex'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      const select = host.querySelector('select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      const optionValues = Array.from(select!.options).map((o) => o.value);
      expect(optionValues).toEqual(['claude', 'codex']);
      expect(select!.value).toBe('claude');

      select!.value = 'codex';
      select!.dispatchEvent(new Event('change'));
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

      const select = host.querySelector('select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      expect(select!.value).toBe('codex');
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

    it('triggers refresh when task:board-config-changed fires', () => {
      const field = getField();
      const { ctx, onSpy, refresh } = makeCtx(['claude', 'codex']);
      const host = document.createElement('div');
      render(field, ctx, host);

      const handler = onSpy.mock.calls[0][1] as () => void;
      handler();
      expect(refresh).toHaveBeenCalledTimes(1);
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

    it('no provider resolvable — renders hint without interactive control', () => {
      const field = getField();
      const { ctx } = makeCtx([]);
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(host.querySelector('select')).toBeNull();
      const message = host.querySelector('p.setting-item-description');
      expect(message).not.toBeNull();
      expect(message?.textContent).toContain('provider');
      expect(getChatUIConfig).not.toHaveBeenCalled();
    });

    it('provider with 0 models — renders hint', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: () => false,
        getModelOptions: () => [],
      });
      const field = getField();
      const { ctx } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(host.querySelector('select')).toBeNull();
      const message = host.querySelector('p.setting-item-description');
      expect(message).not.toBeNull();
    });

    it('provider with 1 model — renders read-only chip locking the only valid model', () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: (m: string) => m === 'sonnet',
        getModelOptions: () => [{ value: 'sonnet', label: 'Sonnet' }],
      });
      const field = getField();
      const { ctx, saveSettings } = makeCtx(['claude'], 'claude');
      const host = document.createElement('div');
      render(field, ctx, host);

      expect(host.querySelector('select')).toBeNull();
      const chip = host.querySelector('.claudian-default-model-chip');
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain('Sonnet');
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('provider with >=2 models — renders editable dropdown and writes through on change', async () => {
      getChatUIConfig.mockReturnValue({
        ownsModel: (m: string) => m === 'haiku' || m === 'sonnet',
        getModelOptions: () => [
          { value: 'haiku', label: 'Haiku' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
      });
      const field = getField();
      const { ctx, saveSettings, refresh } = makeCtx(['claude'], 'claude', 'haiku');
      const host = document.createElement('div');
      render(field, ctx, host);

      const select = host.querySelector('select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      const optionValues = Array.from(select!.options).map((o) => o.value);
      expect(optionValues).toEqual(['haiku', 'sonnet']);
      expect(select!.value).toBe('haiku');

      select!.value = 'sonnet';
      select!.dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();
      expect((ctx.settings as any).agentBoardDefaultModel).toBe('sonnet');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
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

      const select = host.querySelector('select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      expect(select!.value).toBe('haiku');
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
  });
});
