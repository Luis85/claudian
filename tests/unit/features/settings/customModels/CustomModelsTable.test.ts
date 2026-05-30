/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { CustomModelsTable } from '../../../../../src/features/settings/customModels/CustomModelsTable';
import type { SettingsCtx } from '../../../../../src/features/settings/registry/SettingsField';

interface TestCtx extends SettingsCtx {
  saved: any[];
}

function makeCtx(initial?: any): TestCtx {
  let settings: any =
    initial ?? {
      providerConfigs: {},
    };
  const saved: any[] = [];
  const ctx: any = {
    get settings() {
      return settings;
    },
    set settings(s: any) {
      settings = s;
    },
    saveSettings: jest.fn(async () => {
      saved.push(JSON.parse(JSON.stringify(settings)));
    }),
    refresh: jest.fn(),
    plugin: {} as SettingsCtx['plugin'],
    saved,
  };
  return ctx as TestCtx;
}

describe('CustomModelsTable', () => {
  it('renders empty-state copy and an add button when no custom models are configured', () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    new CustomModelsTable(host, 'claude', ctx).render();

    expect(host.textContent ?? '').toContain('No custom models configured');
    const addBtn = host.querySelector('button[data-action="add"]') as HTMLButtonElement | null;
    expect(addBtn).not.toBeNull();
    expect(addBtn?.textContent).toContain('Add custom model');
  });

  it('renders env-sourced rows as read-only (no edit or delete controls)', () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'gpt-pro', label: 'GPT Pro', contextWindow: 128000, source: 'env' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    const row = host.querySelector('[data-row="0"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.dataset.source).toBe('env');
    expect(row?.querySelector('button[data-action="edit"]')).toBeNull();
    expect(row?.querySelector('button[data-action="delete"]')).toBeNull();
  });

  it('renders user-sourced rows with edit and delete controls', () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'my-model', label: 'Mine', contextWindow: 200000, source: 'user' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    const row = host.querySelector('[data-row="0"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.dataset.source).toBe('user');
    expect(row?.querySelector('button[data-action="edit"]')).not.toBeNull();
    expect(row?.querySelector('button[data-action="delete"]')).not.toBeNull();
  });

  it('renders an editor row with empty inputs when the add button is clicked', () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    new CustomModelsTable(host, 'claude', ctx).render();

    const addBtn = host.querySelector('button[data-action="add"]') as HTMLButtonElement;
    addBtn.click();

    const editor = host.querySelector('[data-role="editor"]') as HTMLElement | null;
    expect(editor).not.toBeNull();
    const idInput = editor?.querySelector('input[data-field="id"]') as HTMLInputElement | null;
    const labelInput = editor?.querySelector('input[data-field="label"]') as HTMLInputElement | null;
    const ctxWindowInput = editor?.querySelector(
      'input[data-field="contextWindow"]',
    ) as HTMLInputElement | null;
    expect(idInput?.value).toBe('');
    expect(labelInput?.value).toBe('');
    expect(ctxWindowInput?.value).toBe('');
    expect(editor?.querySelector('button[data-action="save"]')).not.toBeNull();
    expect(editor?.querySelector('button[data-action="cancel"]')).not.toBeNull();
  });

  it('shows an inline error and does not save when the new id duplicates an existing one (case-insensitive)', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'My-Model', label: 'Mine', contextWindow: 200000, source: 'user' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    (host.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    const editor = host.querySelector('[data-role="editor"]') as HTMLElement;
    const idInput = editor.querySelector('input[data-field="id"]') as HTMLInputElement;
    idInput.value = 'my-model';
    (editor.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    // Let any microtasks resolve before asserting.
    await Promise.resolve();
    await Promise.resolve();

    const error = host.querySelector('.claudian-customModels-error');
    expect(error).not.toBeNull();
    expect(error?.textContent ?? '').toMatch(/already exists|duplicate/i);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    // The original single row should still be the only one.
    expect(ctx.settings.providerConfigs.claude?.customModels).toHaveLength(1);
  });
});
