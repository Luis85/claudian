import { Setting } from 'obsidian';

import { readPath, writePath } from './path';
import type { SettingsCtx, SettingsField } from './SettingsField';

export function renderField(host: HTMLElement, field: SettingsField, ctx: SettingsCtx): void {
  const fieldType = field.type;

  if (fieldType.kind === 'custom') {
    fieldType.render(ctx, host);
    return;
  }

  const current = readPath(ctx.settings, field.id) ?? field.default;
  const setting = new Setting(host).setName(field.label);
  if (field.description) setting.setDesc(field.description);

  switch (fieldType.kind) {
    case 'toggle':
      setting.addToggle((t) =>
        t.setValue(Boolean(current)).onChange(async (v: boolean) => {
          ctx.settings = writePath(ctx.settings, field.id, v);
          await ctx.saveSettings();
          ctx.refresh();
        }),
      );
      return;

    case 'text': {
      const placeholder = fieldType.placeholder;
      setting.addText((t) => {
        t.setValue(String(current ?? ''));
        if (placeholder) t.setPlaceholder(placeholder);
        t.onChange(async (v: string) => {
          ctx.settings = writePath(ctx.settings, field.id, v);
          await ctx.saveSettings();
        });
      });
      return;
    }

    case 'folder': {
      const placeholder = fieldType.placeholder;
      setting.addText((t) => {
        t.setValue(String(current ?? ''));
        if (placeholder) t.setPlaceholder(placeholder);
        t.onChange(async (v: string) => {
          ctx.settings = writePath(ctx.settings, field.id, v);
          await ctx.saveSettings();
        });
      });
      return;
    }

    case 'textarea': {
      const placeholder = fieldType.placeholder;
      setting.addTextArea((t) => {
        t.setValue(String(current ?? ''));
        if (placeholder) t.setPlaceholder(placeholder);
        t.onChange(async (v: string) => {
          ctx.settings = writePath(ctx.settings, field.id, v);
          await ctx.saveSettings();
        });
      });
      return;
    }

    case 'number':
      setting.addText((t) =>
        t.setValue(String(current ?? '')).onChange(async (v: string) => {
          const n = Number(v);
          if (Number.isNaN(n)) return;
          ctx.settings = writePath(ctx.settings, field.id, n);
          await ctx.saveSettings();
        }),
      );
      return;

    case 'dropdown': {
      const opts = fieldType.options(ctx.settings);
      setting.addDropdown((d) => {
        opts.forEach((o) => d.addOption(o.value, o.label));
        d.setValue(String(current ?? ''));
        d.onChange(async (v: string) => {
          ctx.settings = writePath(ctx.settings, field.id, v);
          await ctx.saveSettings();
          ctx.refresh();
        });
      });
      return;
    }

    case 'button': {
      const { label, onClick } = fieldType;
      setting.addButton((b) =>
        b.setButtonText(label).onClick(async () => {
          await onClick(ctx);
        }),
      );
      return;
    }
  }
}
