import { Setting } from 'obsidian';

import { readPath, writePathInPlace } from './path';
import type { SettingsCtx, SettingsField } from './SettingsField';

// All input handlers mutate `ctx.settings` in place via `writePathInPlace`.
// The original code reassigned `ctx.settings = writePath(...)` which created
// a new object that `ctx.saveSettings()` never serialized — the plugin still
// owned the old reference, so user edits silently vanished on save. Mutating
// the live object (passed by reference from `plugin.settings`) keeps the
// persisted state in sync.
function writeAndSave(ctx: SettingsCtx, id: string, value: unknown): Promise<void> {
  writePathInPlace(ctx.settings as object, id, value);
  return ctx.saveSettings();
}

// Returns the custom-field disposer when the field is `kind: 'custom'` and its
// render function returned one. F4/F5 widgets subscribe to the event bus and
// return an unsubscribe handle here; renderTab is responsible for invoking it
// before the next re-render so listeners don't accumulate exponentially.
export function renderField(
  host: HTMLElement,
  field: SettingsField,
  ctx: SettingsCtx,
): (() => void) | undefined {
  const fieldType = field.type;

  if (fieldType.kind === 'custom') {
    const result = fieldType.render(ctx, host);
    return typeof result === 'function' ? result : undefined;
  }

  const current = readPath(ctx.settings, field.id) ?? field.default;
  const setting = new Setting(host).setName(field.label);
  if (field.description) setting.setDesc(field.description);

  switch (fieldType.kind) {
    case 'toggle':
      setting.addToggle((t) =>
        t.setValue(Boolean(current)).onChange(async (v: boolean) => {
          await writeAndSave(ctx, field.id, v);
          ctx.refresh();
        }),
      );
      return undefined;

    case 'text':
    case 'folder': {
      // Both kinds render the same Setting.addText input; only the placeholder
      // shape is shared, so widen the discriminant before reading it.
      const placeholder = (fieldType as { placeholder?: string }).placeholder;
      setting.addText((t) => {
        t.setValue(String(current ?? ''));
        if (placeholder) t.setPlaceholder(placeholder);
        t.onChange(async (v: string) => {
          await writeAndSave(ctx, field.id, v);
        });
      });
      return undefined;
    }

    case 'textarea': {
      const placeholder = fieldType.placeholder;
      setting.addTextArea((t) => {
        t.setValue(String(current ?? ''));
        if (placeholder) t.setPlaceholder(placeholder);
        t.onChange(async (v: string) => {
          await writeAndSave(ctx, field.id, v);
        });
      });
      return undefined;
    }

    case 'number': {
      const { min, max, step } = fieldType;
      setting.addText((t) => {
        t.inputEl.type = 'number';
        if (min !== undefined) t.inputEl.min = String(min);
        if (max !== undefined) t.inputEl.max = String(max);
        if (step !== undefined) t.inputEl.step = String(step);
        t.setValue(String(current ?? '')).onChange(async (v: string) => {
          if (v === '') {
            await writeAndSave(ctx, field.id, undefined);
            return;
          }
          const n = Number(v);
          if (Number.isNaN(n)) return;
          if (min !== undefined && n < min) return;
          if (max !== undefined && n > max) return;
          await writeAndSave(ctx, field.id, n);
        });
      });
      return undefined;
    }

    case 'dropdown': {
      const opts = fieldType.options(ctx.settings);
      setting.addDropdown((d) => {
        opts.forEach((o) => d.addOption(o.value, o.label));
        d.setValue(String(current ?? ''));
        d.onChange(async (v: string) => {
          await writeAndSave(ctx, field.id, v);
          ctx.refresh();
        });
      });
      return undefined;
    }

    case 'button': {
      const { label, onClick } = fieldType;
      setting.addButton((b) =>
        b.setButtonText(label).onClick(async () => {
          await onClick(ctx);
        }),
      );
      return undefined;
    }
  }

  return undefined;
}
