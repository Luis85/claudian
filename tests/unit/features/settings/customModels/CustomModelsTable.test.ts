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

    const error = host.querySelector('.specorator-customModels-error');
    expect(error).not.toBeNull();
    expect(error?.textContent ?? '').toMatch(/already exists|duplicate/i);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    // The original single row should still be the only one.
    expect(ctx.settings.providerConfigs.claude?.customModels).toHaveLength(1);
  });

  it('removes a user row and saves when Delete is clicked', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'keeper', source: 'user' },
            { id: 'gone', source: 'user' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    const rowEls = host.querySelectorAll('[data-row]');
    expect(rowEls).toHaveLength(2);
    const goneRow = rowEls[1] as HTMLElement;
    const deleteBtn = goneRow.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    deleteBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.saveSettings).toHaveBeenCalledTimes(1);
    expect(ctx.settings.providerConfigs.claude?.customModels).toEqual([
      { id: 'keeper', source: 'user' },
    ]);
    const remainingRows = host.querySelectorAll('[data-row]');
    expect(remainingRows).toHaveLength(1);
  });

  it('runs commit hooks around the save: beforeSave sees the new rows pre-persist, afterSave runs post-persist', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: { customModels: [{ id: 'gone', source: 'user' }] },
      },
    });
    const order: string[] = [];
    const beforeSave = jest.fn(() => {
      order.push('beforeSave');
      // The row write has already landed, so reconciliation hooks can
      // validate the selection against the NEW list inside the same save.
      expect(ctx.settings.providerConfigs.claude?.customModels).toEqual([]);
      expect(ctx.saveSettings).not.toHaveBeenCalled();
    });
    const afterSave = jest.fn(() => {
      order.push('afterSave');
      expect(ctx.saveSettings).toHaveBeenCalledTimes(1);
    });
    new CustomModelsTable(host, 'claude', ctx, { beforeSave, afterSave }).render();

    const deleteBtn = host.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    deleteBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['beforeSave', 'afterSave']);
  });

  it('opens the editor pre-filled with the row id, label, and contextWindow when Edit is clicked', () => {
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

    const editBtn = host.querySelector('button[data-action="edit"]') as HTMLButtonElement;
    editBtn.click();

    const editor = host.querySelector('[data-role="editor"]') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.dataset.mode).toBe('edit');
    expect(editor.dataset.editId).toBe('my-model');
    const idInput = editor.querySelector('input[data-field="id"]') as HTMLInputElement;
    const labelInput = editor.querySelector('input[data-field="label"]') as HTMLInputElement;
    const ctxWindowInput = editor.querySelector(
      'input[data-field="contextWindow"]',
    ) as HTMLInputElement;
    expect(idInput.value).toBe('my-model');
    expect(labelInput.value).toBe('Mine');
    expect(ctxWindowInput.value).toBe('200000');
  });

  it('replaces the edited row in-place at its existing index and keeps source=user', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'first', source: 'user' },
            { id: 'target', label: 'Old', contextWindow: 100000, source: 'user' },
            { id: 'third', source: 'user' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    const rowEls = host.querySelectorAll('[data-row]');
    const targetRow = rowEls[1] as HTMLElement;
    const editBtn = targetRow.querySelector('button[data-action="edit"]') as HTMLButtonElement;
    editBtn.click();

    const editor = host.querySelector('[data-role="editor"]') as HTMLElement;
    const labelInput = editor.querySelector('input[data-field="label"]') as HTMLInputElement;
    const ctxWindowInput = editor.querySelector(
      'input[data-field="contextWindow"]',
    ) as HTMLInputElement;
    labelInput.value = 'New Label';
    ctxWindowInput.value = '250000';
    (editor.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.saveSettings).toHaveBeenCalledTimes(1);
    expect(ctx.settings.providerConfigs.claude?.customModels).toEqual([
      { id: 'first', source: 'user' },
      { id: 'target', label: 'New Label', contextWindow: 250000, source: 'user' },
      { id: 'third', source: 'user' },
    ]);
  });

  it('does not render Edit or Delete on env-sourced rows even when user rows are also present', () => {
    const host = document.createElement('div');
    const ctx = makeCtx({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'env-model', label: 'Env', contextWindow: 64000, source: 'env' },
            { id: 'user-model', source: 'user' },
          ],
        },
      },
    });
    new CustomModelsTable(host, 'claude', ctx).render();

    const envRow = host.querySelector('[data-row="0"]') as HTMLElement;
    expect(envRow.dataset.source).toBe('env');
    expect(envRow.querySelector('button[data-action="edit"]')).toBeNull();
    expect(envRow.querySelector('button[data-action="delete"]')).toBeNull();

    const userRow = host.querySelector('[data-row="1"]') as HTMLElement;
    expect(userRow.dataset.source).toBe('user');
    expect(userRow.querySelector('button[data-action="edit"]')).not.toBeNull();
    expect(userRow.querySelector('button[data-action="delete"]')).not.toBeNull();
  });
});
