import type { ProviderId } from '../../../core/providers/types';
import type { ProviderCustomModel } from '../../../core/types/settings';
import { writePathInPlace } from '../registry/path';
import type { SettingsCtx } from '../registry/SettingsField';

// Model-list edits can invalidate the active chat/title model selection, so
// commits expose two seams: `beforeSave` runs after the row write but inside
// the same save (reconcile selections by mutating settings), `afterSave` runs
// once persisted (refresh model selectors). Mirrors the legacy tab's
// commit-then-reconcile-then-refresh order.
export interface CustomModelsCommitHooks {
  beforeSave?: () => void;
  afterSave?: () => void;
}

// Editor state is intentionally separate from the persisted row list — env-sourced
// rows come from snippet parsing and stay read-only, while user rows are appended
// through the editor below the table.
export class CustomModelsTable {
  constructor(
    private readonly host: HTMLElement,
    private readonly providerId: ProviderId,
    private readonly ctx: SettingsCtx,
    private readonly hooks: CustomModelsCommitHooks = {},
  ) {}

  private async commitRows(updated: ProviderCustomModel[]): Promise<void> {
    writePathInPlace(
      this.ctx.settings as object,
      `providerConfigs.${this.providerId}.customModels`,
      updated,
    );
    this.hooks.beforeSave?.();
    await this.ctx.saveSettings();
    this.hooks.afterSave?.();
  }

  render(): void {
    this.host.empty();
    const rows = this.readRows();
    if (rows.length === 0) {
      this.host.createEl('p', {
        text: 'No custom models configured. Add one to set a context window or alias.',
      });
    } else {
      this.renderTable(rows);
    }
    const addBtn = this.host.createEl('button', { text: 'Add custom model' });
    addBtn.dataset.action = 'add';
    addBtn.onclick = () => this.openEditorRow();
  }

  private readRows(): ProviderCustomModel[] {
    const configs = (this.ctx.settings as Record<string, unknown>).providerConfigs as
      | Record<string, Record<string, unknown> | undefined>
      | undefined;
    const bag = configs?.[this.providerId];
    const list = bag?.customModels;
    if (!Array.isArray(list)) return [];
    return list as ProviderCustomModel[];
  }

  private renderTable(rows: ProviderCustomModel[]): void {
    const table = this.host.createDiv({ cls: 'claudian-customModels-table' });
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowEl = table.createDiv({ cls: 'claudian-customModels-row' });
      rowEl.dataset.row = String(i);
      rowEl.dataset.source = row.source;
      rowEl.createEl('span', { cls: 'claudian-customModels-id', text: row.id });
      rowEl.createEl('span', {
        cls: 'claudian-customModels-label',
        text: row.label ?? '',
      });
      rowEl.createEl('span', {
        cls: 'claudian-customModels-ctxWindow',
        text: row.contextWindow !== undefined ? String(row.contextWindow) : '',
      });
      rowEl.createEl('span', {
        cls: 'claudian-customModels-source',
        text: row.source === 'env' ? 'env' : 'user',
      });
      if (row.source === 'user') {
        const editBtn = rowEl.createEl('button', { text: 'Edit' });
        editBtn.dataset.action = 'edit';
        editBtn.onclick = () => this.openEditorRow(row);
        const deleteBtn = rowEl.createEl('button', { text: 'Delete' });
        deleteBtn.dataset.action = 'delete';
        deleteBtn.onclick = () => {
          void this.deleteRow(row.id);
        };
      }
    }
  }

  private async deleteRow(id: string): Promise<void> {
    const rows = this.readRows();
    const target = id.toLowerCase();
    const updated = rows.filter((row) => row.id.toLowerCase() !== target);
    if (updated.length === rows.length) {
      return;
    }
    await this.commitRows(updated);
    this.render();
  }

  private openEditorRow(prefill?: ProviderCustomModel): void {
    // Env-sourced rows are read-only — id/alias come from snippet parsing.
    if (prefill?.source === 'env') return;
    // Replace any existing editor to keep the surface single-open.
    const existing = this.host.querySelector('[data-role="editor"]');
    if (existing) existing.remove();

    const editor = this.host.createDiv({ cls: 'claudian-customModels-editor' });
    editor.dataset.role = 'editor';
    if (prefill) {
      editor.dataset.mode = 'edit';
      editor.dataset.editId = prefill.id;
    }

    const idInput = editor.createEl('input', {
      attr: { type: 'text', placeholder: 'Model ID (required)' },
    }) as HTMLInputElement;
    idInput.dataset.field = 'id';
    if (prefill) idInput.value = prefill.id;

    const labelInput = editor.createEl('input', {
      attr: { type: 'text', placeholder: 'Label (optional)' },
    }) as HTMLInputElement;
    labelInput.dataset.field = 'label';
    if (prefill?.label) labelInput.value = prefill.label;

    const ctxWindowInput = editor.createEl('input', {
      attr: { type: 'number', placeholder: 'Context window' },
    }) as HTMLInputElement;
    ctxWindowInput.dataset.field = 'contextWindow';
    if (prefill?.contextWindow !== undefined) {
      ctxWindowInput.value = String(prefill.contextWindow);
    }

    const saveBtn = editor.createEl('button', { text: 'Save' });
    saveBtn.dataset.action = 'save';
    saveBtn.onclick = () => {
      void this.validateAndSave(idInput, labelInput, ctxWindowInput, prefill);
    };

    const cancelBtn = editor.createEl('button', { text: 'Cancel' });
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.onclick = () => {
      editor.remove();
      const errorEl = this.host.querySelector('.claudian-customModels-error');
      if (errorEl) errorEl.remove();
    };
  }

  private async validateAndSave(
    idInput: HTMLInputElement,
    labelInput: HTMLInputElement,
    ctxWindowInput: HTMLInputElement,
    prefill?: ProviderCustomModel,
  ): Promise<void> {
    const existingError = this.host.querySelector('.claudian-customModels-error');
    if (existingError) existingError.remove();

    const id = idInput.value.trim();
    const label = labelInput.value.trim();
    const ctxWindowRaw = ctxWindowInput.value.trim();

    if (id.length === 0) {
      this.showError(idInput, 'Model id is required.');
      return;
    }

    const rows = this.readRows();
    const idLower = id.toLowerCase();
    const prefillIdLower = prefill?.id.toLowerCase();
    if (rows.some((row) => row.id.toLowerCase() === idLower && row.id.toLowerCase() !== prefillIdLower)) {
      this.showError(idInput, `A model with id "${id}" already exists.`);
      return;
    }

    const contextWindow = ctxWindowRaw.length > 0 ? Number(ctxWindowRaw) : undefined;
    if (contextWindow !== undefined && Number.isNaN(contextWindow)) {
      this.showError(idInput, 'Context window must be a number.');
      return;
    }

    const next: ProviderCustomModel = {
      id,
      source: 'user',
      ...(label.length > 0 ? { label } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    };

    let updated: ProviderCustomModel[];
    if (prefill) {
      // Edit in place — replace at the row's existing index, preserving order.
      const index = rows.findIndex((row) => row.id.toLowerCase() === prefillIdLower);
      if (index === -1) {
        updated = [...rows, next];
      } else {
        updated = [...rows];
        updated[index] = next;
      }
    } else {
      updated = [...rows, next];
    }

    await this.commitRows(updated);
    this.render();
  }

  private showError(anchor: HTMLElement, message: string): void {
    const parent = anchor.parentElement;
    if (!parent) return;
    const errorEl = parent.ownerDocument.createElement('p');
    errorEl.className = 'claudian-customModels-error';
    errorEl.textContent = message;
    parent.appendChild(errorEl);
  }
}
