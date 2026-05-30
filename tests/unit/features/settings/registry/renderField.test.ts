import { Setting } from 'obsidian';

import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { renderField } from '../../../../../src/features/settings/registry/renderField';
import type {
  SettingsCtx,
  SettingsField,
} from '../../../../../src/features/settings/registry/SettingsField';

function makeCtx(initial: Record<string, unknown> = {}): {
  ctx: SettingsCtx;
  saveSettings: jest.Mock;
  refresh: jest.Mock;
} {
  const saveSettings = jest.fn().mockResolvedValue(undefined);
  const refresh = jest.fn();
  const ctx: SettingsCtx = {
    settings: { ...initial } as unknown as ClaudianSettings,
    saveSettings,
    refresh,
  };
  return { ctx, saveSettings, refresh };
}

function makeHost(): HTMLElement {
  return {} as HTMLElement;
}

beforeEach(() => {
  (Setting as unknown as { instances: Setting[] }).instances = [];
});

describe('renderField', () => {
  describe('toggle', () => {
    it('renders initial value from settings and writes through on change', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ flags: { feature: true } });
      const field: SettingsField<boolean> = {
        id: 'flags.feature',
        tabId: 'general',
        sectionId: 's',
        label: 'Feature',
        type: { kind: 'toggle' },
        default: false,
      };
      const host = makeHost();

      renderField(host, field, ctx);

      const setting = (Setting as unknown as { instances: any[] }).instances[0];
      const comp = setting.components[0];
      expect(comp.kind).toBe('toggle');
      expect(comp.props.value).toBe(true);

      await comp.props.changeHandler(false);
      expect((ctx.settings as any).flags.feature).toBe(false);
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('falls back to field.default when path is missing', () => {
      const { ctx } = makeCtx({});
      const field: SettingsField<boolean> = {
        id: 'flags.missing',
        tabId: 'general',
        sectionId: 's',
        label: 'Feature',
        type: { kind: 'toggle' },
        default: true,
      };
      renderField(makeHost(), field, ctx);
      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.props.value).toBe(true);
    });
  });

  describe('text', () => {
    it('renders initial value, applies placeholder, writes through without refresh', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ user: { name: 'alice' } });
      const field: SettingsField<string> = {
        id: 'user.name',
        tabId: 'general',
        sectionId: 's',
        label: 'Name',
        type: { kind: 'text', placeholder: 'enter name' },
        default: '',
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('text');
      expect(comp.props.value).toBe('alice');
      expect(comp.props.placeholder).toBe('enter name');

      await comp.props.changeHandler('bob');
      expect((ctx.settings as any).user.name).toBe('bob');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('textarea', () => {
    it('renders initial value and writes through without refresh', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ user: { bio: 'hi' } });
      const field: SettingsField<string> = {
        id: 'user.bio',
        tabId: 'general',
        sectionId: 's',
        label: 'Bio',
        type: { kind: 'textarea', placeholder: 'about you', rows: 4 },
        default: '',
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('textarea');
      expect(comp.props.value).toBe('hi');
      expect(comp.props.placeholder).toBe('about you');

      await comp.props.changeHandler('hello there');
      expect((ctx.settings as any).user.bio).toBe('hello there');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('number', () => {
    it('parses numeric input and writes through without refresh', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ perf: { timeout: 30 } });
      const field: SettingsField<number> = {
        id: 'perf.timeout',
        tabId: 'general',
        sectionId: 's',
        label: 'Timeout',
        type: { kind: 'number', min: 0, max: 100 },
        default: 0,
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('text');
      expect(comp.props.value).toBe('30');

      await comp.props.changeHandler('42');
      expect((ctx.settings as any).perf.timeout).toBe(42);
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('ignores NaN input without overwriting or saving', async () => {
      const { ctx, saveSettings } = makeCtx({ perf: { timeout: 30 } });
      const field: SettingsField<number> = {
        id: 'perf.timeout',
        tabId: 'general',
        sectionId: 's',
        label: 'Timeout',
        type: { kind: 'number' },
        default: 0,
      };
      renderField(makeHost(), field, ctx);
      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];

      await comp.props.changeHandler('not-a-number');
      expect((ctx.settings as any).perf.timeout).toBe(30);
      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  describe('dropdown', () => {
    it('populates options, renders initial value, writes through and refreshes', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ ui: { theme: 'dark' } });
      const field: SettingsField<string> = {
        id: 'ui.theme',
        tabId: 'general',
        sectionId: 's',
        label: 'Theme',
        type: {
          kind: 'dropdown',
          options: () => [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        },
        default: 'light',
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('dropdown');
      expect(comp.props.options).toEqual([
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]);
      expect(comp.props.value).toBe('dark');

      await comp.props.changeHandler('light');
      expect((ctx.settings as any).ui.theme).toBe('light');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('folder', () => {
    it('renders initial value, applies placeholder, writes through without refresh', async () => {
      const { ctx, saveSettings, refresh } = makeCtx({ paths: { workspace: '/tmp' } });
      const field: SettingsField<string> = {
        id: 'paths.workspace',
        tabId: 'general',
        sectionId: 's',
        label: 'Workspace',
        type: { kind: 'folder', placeholder: 'select folder' },
        default: '',
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('text');
      expect(comp.props.value).toBe('/tmp');
      expect(comp.props.placeholder).toBe('select folder');

      await comp.props.changeHandler('/home');
      expect((ctx.settings as any).paths.workspace).toBe('/home');
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('button', () => {
    it('invokes onClick with ctx, awaiting any returned promise', async () => {
      const { ctx } = makeCtx({});
      const onClick = jest.fn().mockResolvedValue(undefined);
      const field: SettingsField<undefined> = {
        id: 'actions.reset',
        tabId: 'general',
        sectionId: 's',
        label: 'Reset',
        type: { kind: 'button', label: 'Reset all', onClick },
        default: undefined,
      };
      renderField(makeHost(), field, ctx);

      const comp = (Setting as unknown as { instances: any[] }).instances[0].components[0];
      expect(comp.kind).toBe('button');
      expect(comp.props.buttonText).toBe('Reset all');

      await comp.props.clickHandler();
      expect(onClick).toHaveBeenCalledWith(ctx);
    });
  });

  describe('custom', () => {
    it('forwards to field.type.render with (ctx, host)', () => {
      const { ctx } = makeCtx({});
      const render = jest.fn();
      const field: SettingsField<undefined> = {
        id: 'custom.thing',
        tabId: 'general',
        sectionId: 's',
        label: 'Custom',
        type: { kind: 'custom', render },
        default: undefined,
      };
      const host = makeHost();
      renderField(host, field, ctx);

      expect(render).toHaveBeenCalledWith(ctx, host);
    });
  });

  describe('label and description', () => {
    it('sets the label via setName and description via setDesc when provided', () => {
      const { ctx } = makeCtx({});
      const field: SettingsField<boolean> = {
        id: 'flags.x',
        tabId: 'general',
        sectionId: 's',
        label: 'My label',
        description: 'My description',
        type: { kind: 'toggle' },
        default: false,
      };
      renderField(makeHost(), field, ctx);
      const setting = (Setting as unknown as { instances: any[] }).instances[0];
      expect(setting.setName).toHaveBeenCalledWith('My label');
      expect(setting.setDesc).toHaveBeenCalledWith('My description');
    });

    it('skips setDesc when description is absent', () => {
      const { ctx } = makeCtx({});
      const field: SettingsField<boolean> = {
        id: 'flags.x',
        tabId: 'general',
        sectionId: 's',
        label: 'My label',
        type: { kind: 'toggle' },
        default: false,
      };
      renderField(makeHost(), field, ctx);
      const setting = (Setting as unknown as { instances: any[] }).instances[0];
      expect(setting.setName).toHaveBeenCalledWith('My label');
      expect(setting.setDesc).not.toHaveBeenCalled();
    });
  });
});
